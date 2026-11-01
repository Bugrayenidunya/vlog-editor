#!/usr/bin/env node
// Analyze collected media into a style dossier: pacing, look, palette, sound, hooks, metadata.
//
//   node analyze.mjs --brand brands/<slug> [--concurrency 2] [--transcribe --language tr] [--force]
//
// Reads  <brand>/research/manifest.json (from collect.mjs)
// Writes <brand>/research/analysis/<source>/<id>/{analysis.json, hook.jpg, overview.jpg, thumb.jpg}
//        <brand>/research/dossier.json   (machine-readable aggregate)
//        <brand>/research/dossier.md     (human-readable summary + the pictures worth looking at)
//        <brand>/research/sheets/*       (palette swatches, first-frame grids per group)
import fsp from "node:fs/promises";
import path from "node:path";
import { parseArgs, log, die, exists, readJson, writeJson, ensureDir, run, runBuffer, runHf, warmHf, pool, median, round, rgbToHex, parseJsonLoose } from "./lib/util.mjs";

const args = parseArgs();
if (!args.brand) die("usage: analyze.mjs --brand brands/<slug> [--concurrency 2] [--transcribe --language xx] [--force]");
const brandDir = path.resolve(args.brand);
const researchDir = path.join(brandDir, "research");
const manifest = await readJson(path.join(researchDir, "manifest.json"));
const concurrency = Number(args.concurrency || 2);
const force = Boolean(args.force);
const transcribe = Boolean(args.transcribe);
const language = args.language || null;
const workDir = await ensureDir(path.join(researchDir, ".work"));
const rel = (p) => path.relative(brandDir, p);

// ---------- palette (deterministic k-means) ----------
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted k-means over RGB points: points = [[r,g,b,w], ...] */
function kmeans(points, k, iters = 14, seed = 7) {
  if (!points.length) return [];
  k = Math.min(k, points.length);
  const rand = rng(seed);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers = [points[Math.floor(rand() * points.length)].slice(0, 3)];
  while (centers.length < k) {
    const dist = points.map((p) => Math.min(...centers.map((c) => d2(p, c))) * (p[3] ?? 1));
    const total = dist.reduce((a, b) => a + b, 0);
    if (!total) break;
    let r = rand() * total;
    let idx = 0;
    while (r > dist[idx] && idx < dist.length - 1) r -= dist[idx++];
    centers.push(points[idx].slice(0, 3));
  }
  let assign = new Array(points.length).fill(0);
  for (let it = 0; it < iters; it++) {
    assign = points.map((p) => {
      let best = 0;
      let bd = Infinity;
      centers.forEach((c, ci) => {
        const d = d2(p, c);
        if (d < bd) {
          bd = d;
          best = ci;
        }
      });
      return best;
    });
    const sums = centers.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      const w = p[3] ?? 1;
      const s = sums[assign[i]];
      s[0] += p[0] * w;
      s[1] += p[1] * w;
      s[2] += p[2] * w;
      s[3] += w;
    });
    sums.forEach((s, ci) => {
      if (s[3]) centers[ci] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  const weights = centers.map(() => 0);
  points.forEach((p, i) => (weights[assign[i]] += p[3] ?? 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return centers
    .map((c, i) => ({ hex: rgbToHex(c), rgb: c.map(Math.round), share: round(weights[i] / total, 3), ...hsv(c) }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

function hsv([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h = Math.round(h * 60 < 0 ? h * 60 + 360 : h * 60);
  }
  return { hue: h, sat: round(max ? d / max : 0, 2), val: round(max, 2) };
}

async function samplePixels(file, isImage) {
  const vf = isImage ? "scale=64:-2" : "fps=1,scale=48:-2";
  const r = await runBuffer("ffmpeg", ["-v", "error", "-i", file, "-vf", vf, "-frames:v", isImage ? "1" : "90", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { timeoutMs: 120000 });
  const buf = r.buffer;
  const pts = [];
  const step = Math.max(1, Math.floor(buf.length / 3 / 12000));
  for (let i = 0; i + 2 < buf.length; i += 3 * step) pts.push([buf[i], buf[i + 1], buf[i + 2], 1]);
  return pts;
}

const isVivid = (c) => c.sat >= 0.45 && c.val >= 0.35;
// Every thumbnail is letterboxed into the same 540×960 box so grids tile cleanly.
const THUMB_VF = "scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:-1:-1:color=black,setsar=1";

// ---------- per-item measures ----------
async function probe(file) {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeoutMs: 60000 });
  const j = parseJsonLoose(r.stdout) || {};
  const v = (j.streams || []).find((s) => s.codec_type === "video") || {};
  const a = (j.streams || []).find((s) => s.codec_type === "audio");
  const [n, d] = String(v.r_frame_rate || "0/1").split("/").map(Number);
  const rot = Number(v.tags?.rotate || v.side_data_list?.find((s) => s.rotation != null)?.rotation || 0);
  const swap = Math.abs(rot) === 90 || Math.abs(rot) === 270;
  return { width: swap ? v.height : v.width, height: swap ? v.width : v.height, fps: d ? round(n / d, 3) : null, duration: round(Number(j.format?.duration) || 0, 3), hasAudio: Boolean(a) };
}

async function sheets(file, outDir, duration) {
  const hook = path.join(outDir, "hook.jpg");
  const overview = path.join(outDir, "overview.jpg");
  const thumb = path.join(outDir, "thumb.jpg");
  const every = duration > 48 ? Math.ceil(duration / 24) : 2;
  const rows = Math.max(1, Math.min(4, Math.ceil(Math.min(24, Math.ceil(duration / every)) / 6)));
  await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-frames:v", "1", "-vf", THUMB_VF, "-q:v", "3", thumb], { timeoutMs: 60000 });
  await run("ffmpeg", ["-v", "error", "-y", "-t", "3", "-i", file, "-vf", "fps=2,scale=220:-2,tile=6x1:padding=4:color=white", "-frames:v", "1", "-q:v", "3", hook], { timeoutMs: 60000 });
  await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `fps=1/${every},scale=170:-2,tile=6x${rows}:padding=4:color=white`, "-frames:v", "1", "-q:v", "4", overview], { timeoutMs: 120000 });
  return { thumb: rel(thumb), hook: rel(hook), overview: rel(overview), overviewEverySeconds: every };
}

function hashtags(text) {
  return [...String(text || "").matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => "#" + m[1].toLowerCase());
}

async function transcribeHead(file, outDir) {
  const proj = await ensureDir(path.join(outDir, "transcript"));
  const model = language && language !== "en" ? "small" : "small.en";
  const r = await runHf(["transcribe", file, "--dir", proj, "--json", "--model", model, ...(language ? ["--language", language] : []), "--optional"], { cwd: proj, timeoutMs: 600000, workspace: brandDir });
  const res = parseJsonLoose(r.stdout) || {};
  const p = [res.transcriptPath, path.join(proj, "transcript.json"), path.join(proj, "assets", "transcript.json")].find((x) => typeof x === "string" && exists(path.resolve(proj, x)));
  const words = p ? await readJson(path.resolve(proj, p), []) : [];
  const list = Array.isArray(words) ? words : words.words || [];
  const text = list.map((w) => w.text).join(" ").replace(/\s+([,.!?])/g, "$1");
  const hookText = list.filter((w) => w.start < 3.5).map((w) => w.text).join(" ");
  const wps = list.length && list.at(-1).end ? round(list.length / list.at(-1).end, 2) : null;
  return { words: list.length, wordsPerSecond: wps, hookText, text: text.slice(0, 1200) };
}

async function analyzeItem(item) {
  const file = path.resolve(brandDir, item.file);
  const outDir = await ensureDir(path.join(researchDir, "analysis", item.sourceKey, item.id));
  const outFile = path.join(outDir, "analysis.json");
  if (!force && exists(outFile)) return readJson(outFile);
  const res = { key: item.key, sourceKey: item.sourceKey, role: item.role, platform: item.platform, handle: item.handle, type: item.type, file: item.file, url: item.url, rank: item.rank ?? null, metrics: item.metrics || {}, errors: [] };
  const step = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      res.errors.push(`${name}: ${e.message}`);
      return null;
    }
  };

  if (item.type === "image" || item.type === "photo") {
    res.palette = await step("palette", async () => kmeans(await samplePixels(file, true), 6));
    await run("ffmpeg", ["-v", "error", "-y", "-i", file, "-frames:v", "1", "-vf", THUMB_VF, "-q:v", "3", path.join(outDir, "thumb.jpg")]);
    res.sheets = { thumb: rel(path.join(outDir, "thumb.jpg")), hook: rel(path.join(outDir, "thumb.jpg")) };
    // A photo post (TikTok slideshow) still has a sound worth measuring.
    if (item.type === "photo" && item.audio) {
      const audioFile = path.resolve(brandDir, item.audio);
      res.sound = await step("audio", async () => {
        const r = await runHf(["audio", audioFile, "--only", "kind,loudness,bpm,silence", "--json"], { cwd: workDir, timeoutMs: 300000, workspace: brandDir });
        const it = parseJsonLoose(r.stdout)?.items?.[0];
        if (!it) throw new Error("audio analysis failed");
        return { kind: it.kind?.value ?? null, kindConfidence: it.kind?.confidence ?? null, lufs: it.loudness?.lufsIntegrated ?? null, truePeak: it.loudness?.truePeakDb ?? null, bpm: it.bpm?.value ?? null };
      });
    }
    res.hashtags = hashtags(res.metrics.description || res.metrics.title);
    await writeJson(outFile, res);
    return res;
  }

  res.probe = await step("probe", () => probe(file));
  const dur = res.probe?.duration || res.metrics.duration || 0;
  res.pace = await step("cuts", async () => {
    const r = await runHf(["measure", "cuts", file], { cwd: workDir, timeoutMs: 300000, workspace: brandDir });
    const j = parseJsonLoose(r.stdout);
    if (!j?.ok) throw new Error((r.stderr || r.stdout).split("\n").filter(Boolean).slice(-1)[0] || "measure cuts failed");
    const cuts = j.cuts || [];
    const shots = (j.shots || []).map((s) => s.seconds);
    return {
      cuts: cuts.length,
      shots: shots.length,
      medianShot: round(median(shots), 2),
      longestShot: round(Math.max(0, ...shots), 2),
      firstCut: cuts[0]?.t ?? null,
      cutsFirst3s: cuts.filter((c) => c.t < 3).length,
      cutsPerMinute: dur ? round((cuts.length / dur) * 60, 1) : null,
    };
  });
  res.look = await step("look", async () => {
    const r = await runHf(["measure", "look", file], { cwd: workDir, timeoutMs: 300000, workspace: brandDir });
    const j = parseJsonLoose(r.stdout);
    if (!j?.ok) throw new Error("measure look failed");
    return { luma: j.luma, contrast: j.contrast, saturation: j.saturation, warmth: j.warmth, bwShare: j.bw_share };
  });
  if (res.probe?.hasAudio) {
    res.sound = await step("audio", async () => {
      const r = await runHf(["audio", file, "--only", "kind,loudness,bpm,silence", "--json"], { cwd: workDir, timeoutMs: 300000, workspace: brandDir });
      const j = parseJsonLoose(r.stdout);
      const it = j?.items?.[0];
      if (!it) throw new Error("audio analysis failed");
      return { kind: it.kind?.value ?? null, kindConfidence: it.kind?.confidence ?? null, lufs: it.loudness?.lufsIntegrated ?? null, truePeak: it.loudness?.truePeakDb ?? null, bpm: it.bpm?.value ?? null, silenceSeconds: round((it.silence || []).reduce((a, s) => a + (s.end - s.start), 0), 2) };
    });
  } else res.sound = { kind: "silent" };
  res.palette = await step("palette", async () => kmeans(await samplePixels(file, false), 6));
  res.sheets = await step("sheets", () => sheets(file, outDir, dur));
  res.hashtags = hashtags(res.metrics.description || res.metrics.title);
  if (transcribe && res.probe?.hasAudio) res.transcript = await step("transcribe", () => transcribeHead(file, outDir));
  await writeJson(outFile, res);
  return res;
}

// ---------- aggregation ----------
function groupStats(list) {
  const vids = list.filter((r) => r.type === "video");
  const pick = (fn) => vids.map(fn).filter((x) => x != null);
  const kinds = {};
  list.filter((r) => r.type !== "image").forEach((v) => {
    const k = v.sound?.kind || "unknown";
    kinds[k] = (kinds[k] || 0) + 1;
  });
  const tagCount = {};
  list.forEach((r) => (r.hashtags || []).forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1)));
  const trackCount = {};
  vids.forEach((v) => {
    const t = v.metrics?.track;
    if (t) trackCount[t] = (trackCount[t] || 0) + 1;
  });
  const palettePoints = list.flatMap((r) => (r.palette || []).map((c) => [...c.rgb, c.share]));
  const palette = kmeans(palettePoints, 8, 20, 11);
  const vivid = kmeans(palettePoints.filter((p) => isVivid(hsv(p))), 5, 20, 13);
  const stats = {
    videos: vids.length,
    photoPosts: list.filter((r) => r.type === "photo").length,
    images: list.filter((r) => r.type === "image").length,
    duration: { median: round(median(pick((v) => v.probe?.duration))), min: round(Math.min(...pick((v) => v.probe?.duration))), max: round(Math.max(...pick((v) => v.probe?.duration))) },
    pace: {
      medianShot: round(median(pick((v) => v.pace?.medianShot))),
      firstCut: round(median(pick((v) => v.pace?.firstCut))),
      cutsFirst3s: round(median(pick((v) => v.pace?.cutsFirst3s))),
      cutsPerMinute: round(median(pick((v) => v.pace?.cutsPerMinute)), 1),
    },
    look: {
      luma: round(median(pick((v) => v.look?.luma)), 1),
      contrast: round(median(pick((v) => v.look?.contrast)), 1),
      saturation: round(median(pick((v) => v.look?.saturation)), 3),
      warmth: round(median(pick((v) => v.look?.warmth)), 1),
    },
    sound: { kinds, lufs: round(median(pick((v) => v.sound?.lufs)), 1), bpm: round(median(pick((v) => v.sound?.bpm)), 0) },
    speech: { wordsPerSecond: round(median(pick((v) => v.transcript?.wordsPerSecond)), 2) },
    engagement: { likes: median(pick((v) => v.metrics?.likes)), views: median(pick((v) => v.metrics?.views)), rate: round(median(pick((v) => v.metrics?.engagementRate)), 4) },
    hashtags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, n]) => ({ tag: t, n })),
    tracks: Object.entries(trackCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => ({ track: t, n })),
    palette: palette.map(({ hex, share, hue, sat, val }) => ({ hex, share, hue, sat, val })),
    vivid: vivid.map(({ hex, share, hue, sat, val }) => ({ hex, share, hue, sat, val })),
  };
  // Leaders vs the rest (by likes, else views): does the top half do anything differently?
  const scored = vids.filter((v) => (v.metrics?.likes ?? v.metrics?.views) != null).sort((a, b) => (b.metrics.likes ?? b.metrics.views) - (a.metrics.likes ?? a.metrics.views));
  if (scored.length >= 6) {
    const half = Math.floor(scored.length / 2);
    const sub = (arr) => ({ medianShot: round(median(arr.map((v) => v.pace?.medianShot))), firstCut: round(median(arr.map((v) => v.pace?.firstCut))), duration: round(median(arr.map((v) => v.probe?.duration))), saturation: round(median(arr.map((v) => v.look?.saturation)), 3), luma: round(median(arr.map((v) => v.look?.luma)), 1) });
    stats.leadersVsRest = { leaders: sub(scored.slice(0, half)), rest: sub(scored.slice(half)), n: scored.length };
  }
  return stats;
}

async function swatch(colors, file) {
  if (!colors.length) return null;
  const w = 140;
  const h = 140;
  const buf = Buffer.alloc(colors.length * w * h * 3);
  for (let y = 0; y < h; y++)
    colors.forEach((c, ci) => {
      for (let x = 0; x < w; x++) {
        const o = (y * colors.length * w + ci * w + x) * 3;
        buf[o] = c.rgb[0];
        buf[o + 1] = c.rgb[1];
        buf[o + 2] = c.rgb[2];
      }
    });
  const ppm = file.replace(/\.png$/, ".ppm");
  await fsp.writeFile(ppm, Buffer.concat([Buffer.from(`P6\n${colors.length * w} ${h}\n255\n`), buf]));
  await run("ffmpeg", ["-v", "error", "-y", "-i", ppm, file]);
  await fsp.rm(ppm, { force: true });
  return rel(file);
}

async function firstFrameGrid(list, file) {
  const thumbs = list.map((r) => r.sheets?.thumb && path.resolve(brandDir, r.sheets.thumb)).filter((p) => p && exists(p));
  if (!thumbs.length) return null;
  const tmp = await ensureDir(path.join(workDir, "grid-" + path.basename(file, ".jpg")));
  await Promise.all(thumbs.map((t, i) => fsp.copyFile(t, path.join(tmp, String(i).padStart(3, "0") + ".jpg"))));
  const cols = Math.min(6, thumbs.length);
  const rows = Math.ceil(thumbs.length / cols);
  // Thumbs are uniform 540×960 (THUMB_VF), so the sequence never re-initialises the filter graph.
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(tmp, "%03d.jpg"), "-vf", `scale=240:426,tile=${cols}x${rows}:padding=4:color=white`, "-frames:v", "1", "-q:v", "3", file]);
  await fsp.rm(tmp, { recursive: true, force: true });
  return exists(file) ? rel(file) : null;
}

const fmt = (n) => (n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));

function dossierMd(d) {
  const L = [];
  L.push(`# Style dossier`, ``, `Generated ${d.generatedAt}. Numbers are measured; read them with the pictures.`, ``);
  L.push(`## Sources`, ``, `| Source | Role | Followers | Videos | Median likes | Median views | Note |`, `| --- | --- | --- | --- | --- | --- | --- |`);
  for (const s of d.sources) L.push(`| ${s.handle || s.key} | ${s.role} | ${fmt(s.followers)} | ${s.stats?.videos ?? 0} | ${fmt(s.stats?.engagement.likes)} | ${fmt(s.stats?.engagement.views)} | ${s.error ? `⚠ ${s.error.code}` : s.note || ""} |`);
  L.push(``, `## Groups`, ``);
  const groups = Object.entries(d.groups);
  if (groups.length) {
    L.push(`| Measure | ${groups.map(([g]) => g).join(" | ")} |`, `| --- | ${groups.map(() => "---").join(" | ")} |`);
    const row = (label, fn) => L.push(`| ${label} | ${groups.map(([, s]) => fn(s) ?? "–").join(" | ")} |`);
    row("videos", (s) => s.videos);
    row("photo posts", (s) => s.photoPosts);
    row("duration median (s)", (s) => s.duration.median);
    row("median shot (s)", (s) => s.pace.medianShot);
    row("first cut (s)", (s) => s.pace.firstCut);
    row("cuts in first 3 s", (s) => s.pace.cutsFirst3s);
    row("cuts / minute", (s) => s.pace.cutsPerMinute);
    row("luma (0–255)", (s) => s.look.luma);
    row("contrast", (s) => s.look.contrast);
    row("saturation (0–1)", (s) => s.look.saturation);
    row("warmth (+warm / −cool)", (s) => s.look.warmth);
    row("sound kinds", (s) => Object.entries(s.sound.kinds).map(([k, n]) => `${k} ${n}`).join(", "));
    row("loudness (LUFS)", (s) => s.sound.lufs);
    row("speech words/s", (s) => s.speech.wordsPerSecond);
    row("engagement rate", (s) => s.engagement.rate);
    row("palette", (s) => s.palette.slice(0, 6).map((c) => c.hex).join(" "));
    row("vivid accents", (s) => s.vivid.map((c) => c.hex).join(" "));
    row("top hashtags", (s) => s.hashtags.slice(0, 6).map((t) => t.tag).join(" "));
    for (const [g, s] of groups) if (s.leadersVsRest) L.push(``, `**${g}: top half by likes vs the rest** (n=${s.leadersVsRest.n}): shot ${s.leadersVsRest.leaders.medianShot}s vs ${s.leadersVsRest.rest.medianShot}s · first cut ${s.leadersVsRest.leaders.firstCut}s vs ${s.leadersVsRest.rest.firstCut}s · duration ${s.leadersVsRest.leaders.duration}s vs ${s.leadersVsRest.rest.duration}s · saturation ${s.leadersVsRest.leaders.saturation} vs ${s.leadersVsRest.rest.saturation}`);
  }
  L.push(``, `## Pictures to look at`, ``);
  for (const [g, p] of Object.entries(d.pictures)) L.push(`- ${g}: \`${p}\``);
  L.push(``, `## Videos`, ``, `| # | Source | Likes | Views | Dur | Shot | 1st cut | Sound | LUFS | Hook sheet | Hook words |`, `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  d.items.filter((r) => r.type === "video" || r.type === "photo").forEach((r, i) => L.push(`| ${i + 1} | ${r.handle || r.sourceKey} | ${fmt(r.metrics?.likes)} | ${fmt(r.metrics?.views)} | ${round(r.probe?.duration, 1) ?? "–"} | ${r.pace?.medianShot ?? "–"} | ${r.pace?.firstCut ?? "–"} | ${r.sound?.kind ?? "–"} | ${r.sound?.lufs ?? "–"} | \`${r.sheets?.hook ?? "–"}\` | ${(r.transcript?.hookText || "").slice(0, 70) || "–"} |`));
  const errs = d.items.filter((r) => r.errors?.length);
  if (errs.length) L.push(``, `## Errors`, ``, ...errs.map((r) => `- ${r.key}: ${r.errors.join("; ")}`));
  return L.join("\n") + "\n";
}

// ---------- main ----------
const items = (manifest.items || []).filter((it) => exists(path.resolve(brandDir, it.file)));
if (!items.length) die("manifest has no media on disk — run collect.mjs first");
await warmHf(brandDir);
log(`analyzing ${items.length} item(s), ${concurrency} at a time${transcribe ? ", with transcripts" : ""}…`);
let done = 0;
const results = await pool(items, concurrency, async (it) => {
  const r = await analyzeItem(it);
  log(`  [${++done}/${items.length}] ${it.key}${r.errors?.length ? ` (${r.errors.length} error)` : ""}`);
  return r;
});

const groupOf = (r) => (r.role === "self" ? "self" : "references");
const groups = {};
for (const g of ["self", "references"]) {
  const list = results.filter((r) => groupOf(r) === g);
  if (list.length) groups[g] = groupStats(list);
}
const sheetsDir = await ensureDir(path.join(researchDir, "sheets"));
const pictures = {};
for (const [g, s] of Object.entries(groups)) {
  const pal = await swatch(s.palette.map((c) => ({ rgb: hexRgb(c.hex) })), path.join(sheetsDir, `palette-${g}.png`));
  if (pal) pictures[`${g} palette`] = pal;
  const viv = await swatch(s.vivid.map((c) => ({ rgb: hexRgb(c.hex) })), path.join(sheetsDir, `vivid-${g}.png`));
  if (viv) pictures[`${g} vivid accents`] = viv;
  const grid = await firstFrameGrid(results.filter((r) => groupOf(r) === g), path.join(sheetsDir, `first-frames-${g}.jpg`));
  if (grid) pictures[`${g} first frames (thumbnails)`] = grid;
}
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const sources = (manifest.sources || []).map((s) => {
  const list = results.filter((r) => r.sourceKey === s.key);
  return { ...s, stats: list.length ? groupStats(list) : null };
});
const dossier = { generatedAt: new Date().toISOString(), groups, sources, pictures, items: results };
await writeJson(path.join(researchDir, "dossier.json"), dossier);
await fsp.writeFile(path.join(researchDir, "dossier.md"), dossierMd(dossier));
process.stdout.write(JSON.stringify({ ok: true, items: results.length, errors: results.filter((r) => r.errors?.length).length, dossier: rel(path.join(researchDir, "dossier.md")), pictures }, null, 2) + "\n");
