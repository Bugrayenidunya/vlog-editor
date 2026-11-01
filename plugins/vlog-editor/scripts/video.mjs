#!/usr/bin/env node
// Videos: one edit (a timeline of clip segments + overlays), rendered as several outputs and formats —
// a long YouTube vlog in 16:9 and any number of 9:16 reels cut from it, all in the brand's style.
//
//   node video.mjs init    --brand brands/<b> --title "…" [--slug …]
//   node video.mjs add     --project videos/<v> --file <clip> [--role a-roll|decks|face|b-roll] [--append|--no-append]
//   node video.mjs ingest  --project videos/<v> [--transcribe] [--language en] [--force]
//   node video.mjs plan    --project videos/<v>                         (resolved timeline, outputs, chapters)
//   node video.mjs draft   --project videos/<v> [--output youtube|reel|all]
//   node video.mjs check   --project videos/<v> [--output …]
//   node video.mjs render  --project videos/<v> [--output …|all] [--quality draft|looks|delivery]
//   node video.mjs undo    --project videos/<v>
//
// Layout of videos/<v>/:
//   video.json            the edit (schema vlog-editor/video@2) — the only file you need to change
//   source/               original clips            assets/media/  H.264 working copies (shared by outputs)
//   outputs/<name>/       one HyperFrames project per output (index.html, compositions/, assets/ hard links)
//   renders/              MP4s (+ chapters.txt and captions.srt for 16:9 outputs)
//   edit.json             style fingerprint per output (for the performance loop)
//   .vlog/                sheets, transcripts, frames, versions (undo), audio programs
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, log, die, exists, ensureDir, readJson, writeJson, run, runHf, warmHf, parseJsonLoose, slugify, round, escapeHtml } from "./lib/util.mjs";
import { withDefaults, FORMATS, layoutFor } from "./lib/brand.mjs";
import { applyBrand } from "./apply-brand.mjs";

const SCHEMA = "vlog-editor/video@2";
const fx = (n) => Number(Number(n).toFixed(3));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ======================= load / save / migrate =======================
export async function loadVideo(projectDir) {
  let v = await readJson(path.join(projectDir, "video.json"), null);
  if (!v) throw new Error(`no video.json in ${projectDir}`);
  if (v.schema !== SCHEMA) {
    v = await migrateV1(projectDir, v);
    await saveVideo(projectDir, v);
  }
  return v;
}

export async function saveVideo(projectDir, v) {
  v.updatedAt = new Date().toISOString();
  await writeJson(path.join(projectDir, "video.json"), v);
  return v;
}

/** v1 (one main clip + face opener, vertical only) → v2 (timeline + overlays + outputs). */
async function migrateV1(projectDir, v1) {
  const clips = (v1.clips || []).map((c) => ({ ...c, role: c.role === "main" ? "decks" : c.role }));
  const main = clips.find((c) => c.role === "decks") || clips[0];
  const face = clips.find((c) => c.role === "face");
  const timeline = main ? [{ id: "s1", clip: main.id, in: main.in || 0, out: main.out ?? main.info?.duration ?? null, audio: "clip", focusX: main.focusX ?? 0.5, label: v1.title || "Main" }] : [];
  const overlays = [];
  if (face && main) overlays.push({ id: "face", type: "cutaway", clip: face.id, in: face.in || 0, at: { seg: "s1", t: 0 }, dur: v1.faceSeconds ?? 2.5, focusX: face.focusX ?? 0.5 });
  if (v1.recipe && main) overlays.push({ id: "recipe", type: "recipe", at: { seg: "s1", t: v1.blendAt ?? v1.plan?.recipeAt ?? 10 }, dur: 4.5, recipe: v1.recipe });
  if (v1.lowerThird?.title && main) overlays.push({ id: "lt", type: "lower-third", at: { seg: "s1", t: v1.lowerThird.at ?? 4 }, dur: 3, title: v1.lowerThird.title, subtitle: v1.lowerThird.subtitle || "" });
  (v1.captions || []).forEach((c, i) => main && overlays.push({ id: `text${i + 1}`, type: "text", at: { seg: "s1", t: c.start }, dur: Math.max(0.5, (c.end ?? c.start + 2) - c.start), text: c.text }));
  // Move the old root-level HyperFrames project out of the way (nothing is deleted).
  const legacy = path.join(projectDir, ".vlog", "legacy-v1");
  for (const f of ["index.html", "compositions", "DESIGN.md", "brand.lock.json", "hyperframes.json", "meta.json", "package.json", "AGENTS.md", "CLAUDE.md"]) {
    const p = path.join(projectDir, f);
    if (exists(p)) {
      await ensureDir(legacy);
      await fsp.rename(p, path.join(legacy, f)).catch(() => {});
    }
  }
  return {
    schema: SCHEMA,
    slug: v1.slug,
    title: v1.title,
    brand: v1.brand,
    createdAt: v1.createdAt,
    clips,
    timeline,
    overlays,
    hook: v1.hook || { text: "", emphasis: "" },
    endCard: v1.endCard || { cta: "", seconds: 2.5 },
    audio: { lufs: v1.audio?.lufs ?? -14 },
    outputs: defaultOutputs({ maxSeconds: v1.maxSeconds }),
    chat: v1.chat || [],
    claude: v1.claude || { session: null },
    renders: v1.renders || [],
    migratedFrom: "vlog-editor/video@1",
  };
}

function defaultOutputs({ maxSeconds } = {}) {
  return [
    { name: "youtube", format: "horizontal", enabled: true, range: null, hook: true, hookSeconds: 4, endSeconds: 8, captions: "srt" },
    { name: "reel", format: "vertical", enabled: true, range: null, maxSeconds: maxSeconds || 60, hook: true, hookSeconds: 3.2, endSeconds: 2.5, captions: "burn" },
  ];
}

// ======================= init / add =======================
export async function initVideo({ brandDir, title, slug, workspace = process.cwd() }) {
  brandDir = path.resolve(brandDir);
  const brand = await readJson(path.join(brandDir, "brand.json"), null);
  if (!brand) throw new Error(`no brand.json in ${brandDir} — build the brand kit first`);
  const date = new Date().toISOString().slice(0, 10);
  slug = slug || `${date}-${slugify(title || "video") || "video"}`;
  const projectDir = path.resolve(workspace, "videos", slug);
  if (exists(path.join(projectDir, "video.json"))) throw new Error(`videos/${slug} already exists`);
  await ensureDir(path.join(projectDir, "source"));
  const b = withDefaults(brand);
  const v = {
    schema: SCHEMA,
    slug,
    title: title || slug,
    brand: path.basename(brandDir),
    createdAt: new Date().toISOString(),
    clips: [],
    timeline: [],
    overlays: [],
    hook: { text: b.samples.hook, emphasis: b.samples.hookEmphasis || "" },
    endCard: { cta: b.samples.cta || "", seconds: 2.5 },
    audio: { lufs: b.sound?.music?.lufs ?? -14 },
    outputs: defaultOutputs(),
    chat: [],
    claude: { session: null },
    renders: [],
  };
  await saveVideo(projectDir, v);
  return { project: projectDir, video: v };
}

export async function addClip(projectDir, file, role = "a-roll", { append } = {}) {
  const v = await loadVideo(projectDir);
  const name = path.basename(file).replace(/[^\w.\- ]+/g, "_");
  const dst = path.join(projectDir, "source", name);
  if (path.resolve(file) !== dst) {
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(path.resolve(file), dst);
  }
  const base = slugify(name.replace(/\.[^.]+$/, "")) || "clip";
  const taken = new Set(v.clips.filter((c) => c.file !== `source/${name}`).map((c) => c.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  v.clips = v.clips.filter((c) => c.file !== `source/${name}`);
  v.clips.push({ id, file: `source/${name}`, role, focusX: 0.5, focusY: 0.5 });
  const shouldAppend = append ?? ["a-roll", "decks", "main"].includes(role);
  if (shouldAppend) {
    let n = v.timeline.length + 1;
    while (v.timeline.some((s) => s.id === `s${n}`)) n++;
    v.timeline.push({ id: `s${n}`, clip: id, in: 0, out: null, audio: "clip", label: id });
  }
  await saveVideo(projectDir, v);
  return v;
}

// ======================= ingest =======================
async function probe(file) {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeoutMs: 60000 });
  const j = parseJsonLoose(r.stdout) || {};
  const vs = (j.streams || []).find((s) => s.codec_type === "video") || {};
  const as = (j.streams || []).find((s) => s.codec_type === "audio");
  const rot = Number(vs.tags?.rotate || vs.side_data_list?.find((s) => s.rotation != null)?.rotation || 0);
  const swap = Math.abs(rot) === 90 || Math.abs(rot) === 270;
  const [n, d] = String(vs.r_frame_rate || "30/1").split("/").map(Number);
  return { width: swap ? vs.height : vs.width, height: swap ? vs.width : vs.height, codec: vs.codec_name, fps: d ? round(n / d, 3) : 30, duration: round(Number(j.format?.duration) || 0, 3), hasAudio: Boolean(as) };
}

async function loudnessOf(file) {
  const r = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { timeoutMs: 3600000 });
  const m = r.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

const mmss = (t) => {
  const s = Math.max(0, Math.round(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

async function transcribeClip(projectDir, c, language) {
  const tdir = await ensureDir(path.join(projectDir, ".vlog", "transcripts", `${c.id}.work`));
  const model = language && language !== "en" ? "small" : "small.en";
  const r = await runHf(["transcribe", path.join(projectDir, c.work), "--dir", tdir, "--json", "--model", model, ...(language ? ["--language", language] : []), "--optional"], { cwd: tdir, timeoutMs: 3600000, workspace: projectDir });
  const j = parseJsonLoose(r.stdout) || {};
  const src = [j.transcriptPath, path.join(tdir, "transcript.json")].find((p) => p && exists(p));
  if (!src) return null;
  const words = (await readJson(src, [])).filter((w) => w && w.text && !/^[♪�]+$/.test(w.text));
  const out = path.join(projectDir, ".vlog", "transcripts", `${c.id}.json`);
  await writeJson(out, words);
  // A readable version for choosing cuts: one line per phrase, broken at punctuation or a 0.6 s pause.
  const lines = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const nx = words[i + 1];
    if (!nx || /[.!?]$/.test(w.text) || nx.start - w.end > 0.6 || cur.length > 18) {
      lines.push(`[${mmss(cur[0].start)} ${cur[0].start.toFixed(1)}–${w.end.toFixed(1)}] ${cur.map((x) => x.text).join(" ")}`);
      cur = [];
    }
  });
  await fsp.writeFile(path.join(projectDir, ".vlog", "transcripts", `${c.id}.txt`), lines.join("\n") + "\n");
  await fsp.rm(tdir, { recursive: true, force: true });
  return { words: words.length, file: path.relative(projectDir, out), text: path.relative(projectDir, out.replace(/\.json$/, ".txt")) };
}

export async function ingest(projectDir, { force = false, transcribe = false, language = null } = {}) {
  const v = await loadVideo(projectDir);
  if (!v.clips.length) throw new Error("add at least one clip first");
  const mediaDir = await ensureDir(path.join(projectDir, "assets", "media"));
  const sheetDir = await ensureDir(path.join(projectDir, ".vlog", "sheets"));
  for (const c of v.clips) {
    const src = path.join(projectDir, c.file);
    if (!exists(src)) throw new Error(`missing ${c.file}`);
    const st = await fsp.stat(src);
    const srcHash = `${st.size}-${Math.round(st.mtimeMs)}`;
    const work = path.join(mediaDir, `${c.id}.mp4`);
    const fresh = force || c.srcHash !== srcHash || !exists(work);
    if (fresh) {
      log(`→ ${c.id}: H.264 working copy`);
      const info = await probe(src);
      const scale = info.width >= info.height ? "scale=-2:1080" : "scale=1080:-2";
      const r = await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `${scale},fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", work], { timeoutMs: 6 * 3600000 });
      if (r.code !== 0) throw new Error(`transcode failed for ${c.id}: ${r.stderr.trim().split("\n").pop()}`);
      c.info = await probe(work);
      c.work = path.relative(projectDir, work);
      c.srcHash = srcHash;
      c.transcript = null;
    }
    if (fresh || !c.sheets?.length) {
      for (const f of await fsp.readdir(sheetDir)) if (f.startsWith(`${c.id}-p`) || f === `${c.id}.thumb.jpg`) await fsp.rm(path.join(sheetDir, f));
      // Paged contact sheets: 24 frames per page; denser for short clips.
      const d = c.info.duration;
      const every = d <= 60 ? 2 : d <= 600 ? 5 : d <= 1800 ? 10 : 20;
      await run("ffmpeg", ["-v", "error", "-y", "-i", work, "-vf", `fps=1/${every},scale=240:-2,tile=6x4:padding=4:color=white`, "-q:v", "4", path.join(sheetDir, `${c.id}-p%02d.jpg`)], { timeoutMs: 3600000 });
      await run("ffmpeg", ["-v", "error", "-y", "-i", work, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", path.join(sheetDir, `${c.id}.thumb.jpg`)], { timeoutMs: 60000 });
      c.sheets = (await fsp.readdir(sheetDir)).filter((f) => f.startsWith(`${c.id}-p`)).sort().map((f) => path.relative(projectDir, path.join(sheetDir, f)));
      c.sheetEvery = every;
      c.sheetNote = `page N covers ${every * 24} s starting at (N-1)×${every * 24} s; 6 frames per row, one every ${every} s`;
      c.thumb = path.relative(projectDir, path.join(sheetDir, `${c.id}.thumb.jpg`));
    }
    // Speech lives on a-roll and face clips; music-only footage (decks, b-roll) makes Whisper invent words.
    if (transcribe && c.info?.hasAudio && !c.transcript && ["a-roll", "face"].includes(c.role)) {
      log(`→ ${c.id}: transcribing`);
      c.transcript = await transcribeClip(projectDir, c, language || v.language || null);
    }
  }
  await saveVideo(projectDir, v);
  return v;
}

// ======================= resolve the edit =======================
/** Timeline seconds of an anchor: { seg, t } (relative to a segment) or a plain number (absolute). */
function anchorTime(R, at) {
  if (typeof at === "number") return at;
  if (at && typeof at === "object") {
    const s = R.byId.get(at.seg);
    if (!s) throw new Error(`anchor refers to unknown or empty segment "${at.seg}"`);
    return fx(s.start + clamp(at.t || 0, 0, s.dur));
  }
  return 0;
}

export function resolve(v) {
  const clips = new Map(v.clips.map((c) => [c.id, c]));
  const segs = [];
  let t = 0;
  for (const s of v.timeline || []) {
    const c = clips.get(s.clip);
    if (!c) throw new Error(`segment ${s.id} uses unknown clip "${s.clip}"`);
    if (!c.info) throw new Error(`clip ${c.id} is not ingested yet — run ingest`);
    const inn = clamp(s.in || 0, 0, c.info.duration);
    const out = clamp(s.out ?? c.info.duration, inn, c.info.duration);
    const dur = fx(out - inn);
    if (dur < 0.1) continue;
    segs.push({ ...s, clipInfo: c, in: inn, out, dur, start: fx(t), end: fx(t + dur) });
    t += dur;
  }
  const R = { segs, total: fx(t), byId: new Map(segs.map((s) => [s.id, s])) };
  R.overlays = (v.overlays || []).map((o) => {
    const start = anchorTime(R, o.at);
    return { ...o, start, end: fx(start + (o.dur ?? 3)) };
  });
  R.chapters = segs.filter((s) => s.chapter).map((s) => ({ title: s.chapter, start: s.start }));
  return R;
}

/** The window [A, B) of the timeline that an output shows. */
export function windowFor(o, R) {
  if (o.range) {
    const A = clamp(anchorTime(R, o.range.from ?? 0), 0, R.total);
    const B = clamp(o.range.to == null ? R.total : anchorTime(R, o.range.to), A, R.total);
    return { A, B: fx(Math.min(B, A + (o.maxSeconds || Infinity))) };
  }
  if (o.format === "vertical" || o.maxSeconds) {
    const max = o.maxSeconds || 60;
    if (R.total <= max) return { A: 0, B: R.total };
    // Auto: centre the cut on the first recipe card (the payoff), starting a few seconds before it.
    const pay = R.overlays.find((x) => x.type === "recipe");
    const A = clamp(pay ? pay.start - 8 : 0, 0, Math.max(0, R.total - max));
    return { A: fx(A), B: fx(A + max) };
  }
  return { A: 0, B: R.total };
}

// ======================= outputs =======================
const outputDir = (projectDir, o) => path.join(projectDir, "outputs", o.name);
const isPortrait = (c) => (c.info?.height || 0) > (c.info?.width || 0);

async function linkOrCopy(src, dst) {
  await ensureDir(path.dirname(dst));
  await fsp.rm(dst, { force: true });
  try {
    await fsp.link(src, dst);
  } catch {
    await fsp.copyFile(src, dst);
  }
}

/** A blurred, darkened full-frame copy of a clip, for placing footage whole in a frame of another shape. */
async function fillFor(projectDir, c, W, H) {
  const rel = `assets/media/${c.id}.fill-${W}x${H}.mp4`;
  const file = path.join(projectDir, rel);
  if (exists(file) && (await fsp.stat(file)).mtimeMs >= (await fsp.stat(path.join(projectDir, c.work))).mtimeMs) return rel;
  log(`→ ${c.id}: blurred fill for ${W}×${H}`);
  const w4 = Math.round(W / 4);
  const h4 = Math.round(H / 4);
  const r = await run("ffmpeg", ["-v", "error", "-y", "-i", path.join(projectDir, c.work), "-an", "-vf", `scale=${w4}:${h4}:force_original_aspect_ratio=increase,crop=${w4}:${h4},boxblur=12:2,eq=brightness=-0.14:saturation=0.85,scale=${W}:${H},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-g", "30", file], { timeoutMs: 6 * 3600000 });
  if (r.code !== 0) throw new Error(`fill failed for ${c.id}: ${r.stderr.trim().split("\n").pop()}`);
  return rel;
}

/** cover (crop to fill) or contain (whole, over a blurred fill). Auto: never crop a portrait clip into 16:9/1:1. */
function fitMode(item, c, format) {
  if (item.fit === "cover" || item.fit === "contain") return item.fit;
  if (format !== "vertical" && isPortrait(c)) return "contain";
  return "cover";
}

/** Mastered audio for one output: segments' sound in order, cut to the window, normalised to the brand LUFS. */
async function buildProgramAudio(projectDir, v, R, A, B, outName) {
  const pieces = [];
  for (const s of R.segs) {
    const a = Math.max(s.start, A);
    const b = Math.min(s.end, B);
    if (b - a < 0.02) continue;
    pieces.push({ s, from: fx(s.in + (a - s.start)), dur: fx(b - a) });
  }
  if (!pieces.length) throw new Error("the output window has no footage");
  const inputs = [];
  const idx = new Map();
  const audible = (p) => p.s.audio !== "mute" && p.s.clipInfo.info.hasAudio;
  for (const p of pieces) {
    const c = p.s.clipInfo;
    if (audible(p) && !idx.has(c.id)) {
      idx.set(c.id, inputs.length);
      inputs.push(path.join(projectDir, c.work));
    }
  }
  const uses = new Map();
  for (const p of pieces) if (audible(p)) uses.set(p.s.clipInfo.id, (uses.get(p.s.clipInfo.id) || 0) + 1);
  const chains = [];
  for (const [id, n] of uses) chains.push(`[${idx.get(id)}:a]aresample=48000,aformat=channel_layouts=stereo,asplit=${n}${Array.from({ length: n }, (_, i) => `[src${idx.get(id)}_${i}]`).join("")}`);
  const taken = new Map();
  const labels = pieces.map((p, i) => {
    if (!audible(p)) {
      chains.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${p.dur}[p${i}]`);
    } else {
      const id = p.s.clipInfo.id;
      const k = taken.get(id) || 0;
      taken.set(id, k + 1);
      chains.push(`[src${idx.get(id)}_${k}]atrim=start=${p.from}:duration=${p.dur},asetpts=PTS-STARTPTS${p.s.volume != null ? `,volume=${p.s.volume}` : ""}[p${i}]`);
    }
    return `[p${i}]`;
  });
  const total = fx(B - A);
  chains.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1,afade=t=in:d=${A > 0 ? 0.25 : 0.02},afade=t=out:st=${Math.max(0, total - 1.2)}:d=1.2[prog]`);
  const work = await ensureDir(path.join(projectDir, ".vlog", "audio"));
  const raw = path.join(work, `${outName}.raw.wav`);
  let r = await run("ffmpeg", ["-v", "error", "-y", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", chains.join(";"), "-map", "[prog]", "-c:a", "pcm_s16le", raw], { timeoutMs: 6 * 3600000 });
  if (r.code !== 0) throw new Error(`audio assembly failed: ${r.stderr.trim().split("\n").slice(-2).join(" ")}`);
  const target = v.audio?.lufs ?? -14;
  const m = await loudnessOf(raw);
  const lin = m && Number.isFinite(+m.input_i) ? `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true` : "";
  const outRel = "assets/audio/program.m4a";
  const out = path.join(outputDir(projectDir, { name: outName }), outRel);
  await ensureDir(path.dirname(out));
  r = await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", `loudnorm=I=${target}:TP=-1:LRA=11${lin},aresample=48000`, "-c:a", "aac", "-b:a", "256k", out], { timeoutMs: 6 * 3600000 });
  await fsp.rm(raw, { force: true });
  if (r.code !== 0) throw new Error(`audio mastering failed: ${r.stderr.trim().split("\n").pop()}`);
  return { file: outRel, sourceLufs: m ? +m.input_i : null };
}

/** Copy a brand component as a uniquely named composition for one overlay. */
async function overlayComponent(dir, kind, oid, transform) {
  const src = path.join(dir, "compositions", "brand", `${kind}.html`);
  if (!exists(src)) throw new Error(`brand component ${kind} missing — rebuild the brand kit`);
  let html = (await fsp.readFile(src, "utf8")).replaceAll(`"${kind}"`, `"${oid}"`);
  if (transform) html = transform(html);
  const rel = `compositions/overlays/${oid}.html`;
  await ensureDir(path.join(dir, "compositions", "overlays"));
  await fsp.writeFile(path.join(dir, rel), html);
  return rel;
}

const replaceMarker = (html, start, end, replacement) => html.replace(new RegExp(`(// ${start}[^\\n]*\\n)[\\s\\S]*?(\\n\\s*// ${end})`), (m, a, b) => `${a}      ${replacement}${b}`);

/** Spoken words (from transcripts) that land inside [A, B), in output seconds. */
function spokenWords(projectDir, R, A, B) {
  const words = [];
  for (const s of R.segs) {
    if (s.audio === "mute" || !s.clipInfo.transcript?.file) continue;
    const list = JSON.parse(fs.readFileSync(path.join(projectDir, s.clipInfo.transcript.file), "utf8"));
    for (const w of list) {
      if (w.start < s.in || w.end > s.out) continue;
      const t0 = s.start + (w.start - s.in);
      const t1 = s.start + (w.end - s.in);
      if (t0 >= A && t1 <= B) words.push({ text: w.text, start: fx(t0 - A), end: fx(t1 - A) });
    }
  }
  return words;
}

const endSecondsOf = (o, T) => Math.min(o.endSeconds ?? (o.format === "horizontal" ? 8 : 2.5), T / 3);

export async function draftOutput(projectDir, v, o, R, b) {
  const F = FORMATS[o.format];
  if (!F) throw new Error(`unknown format "${o.format}" for output ${o.name}`);
  const { W, H } = F;
  const L = layoutFor(b, o.format);
  const dir = outputDir(projectDir, o);
  const workspace = path.resolve(projectDir, "..", "..");
  if (!exists(path.join(dir, "hyperframes.json"))) {
    const r = await runHf(["init", dir, "--resolution", F.resolution, "--non-interactive", "--skip-skills"], { cwd: workspace, timeoutMs: 300000, workspace });
    if (!exists(path.join(dir, "hyperframes.json"))) throw new Error(`hyperframes init failed for ${o.name}: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
  }
  await applyBrand(path.join(workspace, "brands", v.brand), dir, { force: true, format: o.format });
  await fsp.rm(path.join(dir, "compositions", "overlays"), { recursive: true, force: true });

  const { A, B } = windowFor(o, R);
  const T = fx(B - A);
  if (T < 1) throw new Error(`output ${o.name} is shorter than a second`);
  const endSec = endSecondsOf(o, T);
  // Media: hard links into this project (HyperFrames serves the project's assets/ only).
  for (const id of new Set([...R.segs.map((s) => s.clip), ...R.overlays.filter((x) => x.clip).map((x) => x.clip)])) {
    const c = v.clips.find((x) => x.id === id);
    if (c?.work) await linkOrCopy(path.join(projectDir, c.work), path.join(dir, c.work));
  }
  const audio = await buildProgramAudio(projectDir, v, R, A, B, o.name);

  const els = [];
  const pos = (it, c) => `object-position:${Math.round((it.focusX ?? c.focusX ?? 0.5) * 100)}% ${Math.round((it.focusY ?? c.focusY ?? 0.5) * 100)}%`;
  const clipEl = async (id, c, start, dur, mediaStart, it, z) => {
    const mode = fitMode(it, c, o.format);
    if (mode === "contain") {
      const fill = await fillFor(projectDir, c, W, H);
      await linkOrCopy(path.join(projectDir, fill), path.join(dir, fill));
      els.push(`<video id="${id}-fill" class="clip" src="${fill}" data-start="${start}" data-duration="${dur}" data-media-start="${mediaStart}" data-track-index="${z}" muted playsinline style="z-index:${z};object-fit:cover"></video>`);
    }
    els.push(`<video id="${id}" class="clip" src="${c.work}" data-start="${start}" data-duration="${dur}" data-media-start="${mediaStart}" data-track-index="${z}" muted playsinline style="z-index:${z};object-fit:${mode};${pos(it, c)}"></video>`);
  };
  for (const s of R.segs) {
    const a = Math.max(s.start, A);
    const e = Math.min(s.end, B);
    if (e - a < 0.02) continue;
    await clipEl(`seg-${s.id}`, s.clipInfo, fx(a - A), fx(e - a), fx(s.in + (a - s.start)), s, 1);
  }
  const hosts = [];
  const host = (id, src, start, dur, z, values, kind = "graphics") =>
    hosts.push(`<div id="${id}" data-composition-id="${id}" data-composition-src="${src}" data-start="${fx(start)}" data-duration="${fx(dur)}" data-track-index="${z}" data-track-kind="${kind}" data-width="${W}" data-height="${H}" style="z-index:${z}"${values ? ` data-variable-values='${JSON.stringify(values).replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'` : ""}></div>`);
  const within = (x) => x.end > A + 0.05 && x.start < B - endSec - 0.05;
  const local = (x) => ({ start: fx(Math.max(0, x.start - A)), dur: fx(Math.min(x.end, B - endSec) - Math.max(x.start, A)) });
  const texts = [];
  for (const ov of R.overlays.filter(within)) {
    const { start, dur } = local(ov);
    if (dur < 0.3) continue;
    const oid = `ov-${slugify(ov.id) || "x"}`;
    const c = ov.clip ? v.clips.find((x) => x.id === ov.clip) : null;
    if ((ov.type === "cutaway" || ov.type === "broll") && c?.info) {
      await clipEl(oid, c, start, dur, fx((ov.in || 0) + Math.max(0, A - ov.start)), ov, 2);
    } else if (ov.type === "pip" && c?.info) {
      const p = L.pip;
      const portrait = isPortrait(c);
      const long = Math.max(p.width, p.height);
      const short = Math.min(p.width, p.height);
      const [w, h] = portrait ? [short, long] : [long, short];
      const place = p.top != null ? `top:${p.top}px` : `bottom:${p.bottom}px`;
      els.push(`<video id="${oid}" class="clip pip" src="${c.work}" data-start="${start}" data-duration="${dur}" data-media-start="${fx((ov.in || 0) + Math.max(0, A - ov.start))}" data-track-index="3" muted playsinline style="z-index:3;inset:auto;${place};right:${p.right}px;width:${w}px;height:${h}px;object-fit:cover;${pos(ov, c)}"></video>`);
    } else if (ov.type === "recipe") {
      const src = await overlayComponent(dir, "brand-recipe-card", oid, (h) => replaceMarker(h, "@recipe-start", "@recipe-end", `var RECIPE = ${JSON.stringify(ov.recipe || {})};`));
      host(oid, src, start, dur, 6, ov.top ? { top: ov.top } : null);
    } else if (ov.type === "lower-third") {
      const src = await overlayComponent(dir, "brand-lower-third", oid);
      host(oid, src, start, dur, 5, { title: ov.title || "", subtitle: ov.subtitle || "" });
    } else if (ov.type === "text") {
      const ws = String(ov.text || "").split(/\s+/).filter(Boolean);
      ws.forEach((w, i) => texts.push({ text: w, start: fx(start + (i * dur) / ws.length), end: fx(start + ((i + 1) * dur) / ws.length - 0.02) }));
    }
  }
  // Captions: text beats, plus spoken words when this output burns captions in.
  const words = [...texts, ...(o.captions === "burn" ? spokenWords(projectDir, R, A, B - endSec) : [])].sort((a, b2) => a.start - b2.start);
  if (words.length) {
    const src = await overlayComponent(dir, "brand-captions", "captions", (h) => replaceMarker(h, "@words-start", "@words-end", `var WORDS = ${JSON.stringify(words)};`));
    host("captions", src, 0, T - endSec, 7, null, "captions");
  }
  // Hook at frame 0. true = the video's shared hook; an object = this output's own; false = none.
  const hook = o.hook === false ? null : typeof o.hook === "object" && o.hook ? o.hook : v.hook;
  if (hook?.text) {
    const src = await overlayComponent(dir, "brand-hook", "hook");
    host("hook", src, 0, Math.min(o.hookSeconds ?? 3.2, T - endSec), 8, { hook: hook.text, emphasis: hook.emphasis || "" });
  }
  const handle = b.handles?.tiktok || b.handles?.instagram || b.handles?.youtube || "";
  const endSrc = await overlayComponent(dir, "brand-end-card", "endcard");
  host("endcard", endSrc, T - endSec, endSec, 9, { cta: o.cta || v.endCard?.cta || "", handle });

  const html = `<!doctype html>
<html lang="${escapeHtml((b.languages || ["en"])[0])}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <!-- Generated by vlog-editor from ../../video.json (output "${o.name}", ${o.format}). Change video.json and redraft. -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${b.colors.ground}; }
      #root video { position: absolute; inset: 0; width: 100%; height: 100%; }
      #root video.pip { border-radius: 26px; box-shadow: 0 18px 50px rgba(0,0,0,.45); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${T}" data-width="${W}" data-height="${H}">
      ${els.join("\n      ")}
      <audio id="program" src="${audio.file}" data-start="0" data-duration="${T}"></audio>
      ${hosts.join("\n      ")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
  await fsp.writeFile(path.join(dir, "index.html"), html);
  const chapters = R.chapters.filter((c) => c.start >= A && c.start < B).map((c) => ({ title: c.title, start: fx(c.start - A) }));
  return { name: o.name, format: o.format, window: { A, B }, seconds: T, endSeconds: fx(endSec), overlays: R.overlays.filter(within).map((x) => x.id), captionWords: words.length, chapters, sourceLufs: audio.sourceLufs, dir: path.relative(projectDir, dir) };
}

function pickOutputs(v, which) {
  const all = (v.outputs || []).filter((o) => o.enabled !== false);
  if (!which || which === "all") return all;
  const list = String(which).split(",");
  const out = all.filter((o) => list.includes(o.name));
  if (!out.length) throw new Error(`no output named ${which} (have: ${all.map((o) => o.name).join(", ")})`);
  return out;
}

// ======================= versions (undo) =======================
export async function snapshotVersion(projectDir, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = await ensureDir(path.join(projectDir, ".vlog", "versions", stamp));
  if (exists(path.join(projectDir, "video.json"))) await fsp.copyFile(path.join(projectDir, "video.json"), path.join(dir, "video.json"));
  await writeJson(path.join(dir, "reason.json"), { reason, at: new Date().toISOString() });
  const root = path.join(projectDir, ".vlog", "versions");
  const all = (await fsp.readdir(root)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 40))) await fsp.rm(path.join(root, old), { recursive: true, force: true });
  return stamp;
}

export async function undo(projectDir) {
  const root = path.join(projectDir, ".vlog", "versions");
  const last = (await fsp.readdir(root).catch(() => [])).sort().at(-1);
  if (!last) throw new Error("nothing to undo");
  await fsp.copyFile(path.join(root, last, "video.json"), path.join(projectDir, "video.json"));
  const reason = await readJson(path.join(root, last, "reason.json"), {});
  await fsp.rm(path.join(root, last), { recursive: true, force: true });
  return { restored: last, reason: reason.reason || null, note: "video.json restored — run draft to rebuild the outputs" };
}

// ======================= draft / check / render =======================
export async function draft(projectDir, { output = "all" } = {}) {
  const v = await loadVideo(projectDir);
  if (!v.timeline?.length) throw new Error("the timeline is empty — add a clip with --append, or write segments into video.json");
  const R = resolve(v);
  await snapshotVersion(projectDir, `draft ${output}`);
  const brand = await readJson(path.join(projectDir, "..", "..", "brands", v.brand, "brand.json"), null);
  if (!brand) throw new Error(`brand ${v.brand} not found`);
  const b = withDefaults(brand);
  const results = [];
  for (const o of pickOutputs(v, output)) {
    log(`→ draft ${o.name} (${o.format})`);
    results.push(await draftOutput(projectDir, v, o, R, b));
  }
  v.plan = { total: R.total, segments: R.segs.length, overlays: R.overlays.length, chapters: R.chapters, outputs: { ...(v.plan?.outputs || {}), ...Object.fromEntries(results.map((r) => [r.name, { format: r.format, from: r.window.A, to: r.window.B, seconds: r.seconds }])) } };
  await saveVideo(projectDir, v);
  return { total: R.total, outputs: results };
}

export async function check(projectDir, { output = "all" } = {}) {
  const v = await loadVideo(projectDir);
  const R = resolve(v);
  const res = {};
  for (const o of pickOutputs(v, output)) {
    const dir = outputDir(projectDir, o);
    if (!exists(path.join(dir, "index.html"))) {
      res[o.name] = { ok: false, error: "not drafted yet" };
      continue;
    }
    const r = await runHf(["check", dir, "--json"], { cwd: dir, timeoutMs: 1800000, workspace: dir });
    const j = parseJsonLoose(r.stdout);
    const findings = [];
    const walk = (x) => {
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) return x.forEach(walk);
      if ((x.severity || x.level) && (x.message || x.code)) findings.push({ level: x.severity || x.level, code: x.code || x.rule || null, message: String(x.message || "").slice(0, 300) });
      Object.values(x).forEach(walk);
    };
    walk(j);
    // Key frames: frame 0, every overlay, chapter starts, a few points across, the end card.
    const { A, B } = windowFor(o, R);
    const T = B - A;
    const endSec = endSecondsOf(o, T);
    const moments = [0.3, ...R.overlays.filter((x) => x.end > A && x.start < B - endSec).map((x) => Math.max(0, x.start - A) + Math.min(1.2, (x.dur ?? 3) / 2)), ...R.chapters.filter((c) => c.start > A && c.start < B).map((c) => c.start - A + 1), T * 0.33, T * 0.66, T - endSec + 1.2];
    const times = [...new Set(moments.map((t) => fx(clamp(t, 0, T - 0.05))))].sort((a, b) => a - b).slice(0, 12);
    const fdir = path.join(projectDir, ".vlog", "frames", o.name);
    await fsp.rm(fdir, { recursive: true, force: true });
    await runHf(["snapshot", dir, "--at", times.join(","), "--no-end", "-o", fdir, "--json"], { cwd: dir, timeoutMs: 1800000, workspace: dir });
    const frames = (await fsp.readdir(fdir).catch(() => [])).filter((f) => f.endsWith(".png")).sort().map((f) => path.relative(projectDir, path.join(fdir, f)));
    res[o.name] = { ok: !findings.some((f) => /error/i.test(f.level)) && j?.ok !== false, errors: findings.filter((f) => /error/i.test(f.level)).slice(0, 20), warnings: findings.filter((f) => /warn/i.test(f.level)).slice(0, 20), frames, times };
  }
  v.lastCheck = { at: new Date().toISOString(), outputs: res };
  await saveVideo(projectDir, v);
  return res;
}

const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
};

function srtFrom(words) {
  const cues = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const nx = words[i + 1];
    if (!nx || cur.length >= 8 || /[.!?]$/.test(w.text) || nx.start - w.end > 0.5) {
      cues.push({ start: cur[0].start, end: w.end, text: cur.map((x) => x.text).join(" ") });
      cur = [];
    }
  });
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

export async function render(projectDir, { output = "all", quality } = {}) {
  const v = await loadVideo(projectDir);
  const R = resolve(v);
  const results = [];
  const fp = (await readJson(path.join(projectDir, "edit.json"), null)) || {};
  if (fp.schema !== "vlog-editor/edit@2") Object.assign(fp, { schema: "vlog-editor/edit@2", video: v.slug, outputs: {} });
  for (const o of pickOutputs(v, output)) {
    const dir = outputDir(projectDir, o);
    if (!exists(path.join(dir, "index.html"))) throw new Error(`output ${o.name} is not drafted — run draft first`);
    const lock = await readJson(path.join(dir, "brand.lock.json"), {});
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const out = path.join(projectDir, "renders", `${v.slug}__${o.name}_${stamp}.mp4`);
    await ensureDir(path.dirname(out));
    const { A, B } = windowFor(o, R);
    log(`→ render ${o.name} (${o.format}, ${mmss(B - A)})`);
    const r = await runHf(["render", dir, "-o", out, "--quiet", ...(quality ? ["--quality", quality] : [])], { cwd: dir, timeoutMs: 12 * 3600000, workspace: dir });
    if (!exists(out)) throw new Error(`render ${o.name} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`);
    const info = await probe(out);
    // The renderer's mix sits about 2 dB under the mastered program; re-master the delivered audio track
    // (video stream copied untouched) whenever it misses the brand target by more than 0.5 LU.
    const target = v.audio?.lufs ?? -14;
    let ln = await loudnessOf(out);
    if (ln && Number.isFinite(+ln.input_i) && Math.abs(+ln.input_i - target) > 0.5) {
      const tmp = out.replace(/\.mp4$/, ".remaster.mp4");
      const lin = `:measured_I=${ln.input_i}:measured_TP=${ln.input_tp}:measured_LRA=${ln.input_lra}:measured_thresh=${ln.input_thresh}:offset=${ln.target_offset}:linear=true`;
      const fixr = await run("ffmpeg", ["-v", "error", "-y", "-i", out, "-c:v", "copy", "-af", `loudnorm=I=${target}:TP=-1:LRA=11${lin},aresample=48000`, "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", tmp], { timeoutMs: 6 * 3600000 });
      if (fixr.code === 0 && exists(tmp)) {
        await fsp.rename(tmp, out);
        log(`   loudness ${(+ln.input_i).toFixed(1)} → ${target} LUFS`);
        ln = await loudnessOf(out);
      } else await fsp.rm(tmp, { force: true });
    }
    const extras = {};
    if (o.format === "horizontal") {
      const ch = R.chapters.filter((c) => c.start >= A && c.start < B).map((c) => ({ ...c, start: c.start - A }));
      if (ch.length) {
        if (ch[0].start > 0.5) ch.unshift({ title: "Intro", start: 0 });
        const f = out.replace(/\.mp4$/, ".chapters.txt");
        await fsp.writeFile(f, ch.map((c) => `${mmss(c.start)} ${c.title}`).join("\n") + "\n");
        extras.chapters = path.relative(projectDir, f);
        if (ch.length < 3 || ch.some((c, i) => i && c.start - ch[i - 1].start < 10)) extras.chaptersNote = "YouTube needs ≥ 3 chapters, the first at 0:00, each ≥ 10 s";
      }
      const words = spokenWords(projectDir, R, A, B);
      if (words.length) {
        const f = out.replace(/\.mp4$/, ".captions.srt");
        await fsp.writeFile(f, srtFrom(words));
        extras.captions = path.relative(projectDir, f);
      }
    }
    const firstSeg = R.segs.find((s) => s.end > A);
    const entry = {
      file: path.relative(projectDir, out),
      renderedAt: new Date().toISOString(),
      format: o.format,
      seconds: info.duration,
      lufs: ln ? +ln.input_i : null,
      window: { from: A, to: B },
      brand: { slug: v.brand, version: lock.version ?? null, hash: lock.hash ?? null },
      hook: o.hook === false ? null : typeof o.hook === "object" && o.hook ? o.hook : v.hook,
      segments: R.segs.filter((s) => s.end > A && s.start < B).map((s) => ({ id: s.id, clip: s.clip, role: s.clipInfo.role, seconds: fx(Math.min(s.end, B) - Math.max(s.start, A)) })),
      cutsPerMinute: fx((R.segs.filter((s) => s.start > A && s.start < B).length / Math.max(1, B - A)) * 60),
      overlays: R.overlays.filter((x) => x.end > A && x.start < B).map((x) => ({ type: x.type, at: fx(x.start - A), dur: x.dur ?? null })),
      faceAtFrame0: R.overlays.some((x) => ["cutaway", "pip"].includes(x.type) && v.clips.find((c) => c.id === x.clip)?.role === "face" && x.start <= A + 0.1 && x.end > A) || firstSeg?.clipInfo.role === "face",
      captions: o.captions || "none",
      ...extras,
    };
    fp.outputs[o.name] = entry;
    v.renders = [...(v.renders || []), { output: o.name, file: entry.file, at: entry.renderedAt, seconds: entry.seconds, lufs: entry.lufs }];
    results.push({ output: o.name, ...entry });
  }
  fp.updatedAt = new Date().toISOString();
  await writeJson(path.join(projectDir, "edit.json"), fp);
  await saveVideo(projectDir, v);
  return results;
}

/** Human summary of the resolved edit (for choosing cuts and checking anchors). */
export async function planSummary(projectDir) {
  const v = await loadVideo(projectDir);
  const R = resolve(v);
  return {
    total: R.total,
    totalText: mmss(R.total),
    segments: R.segs.map((s) => ({ id: s.id, clip: s.clip, role: s.clipInfo.role, in: s.in, out: s.out, start: s.start, end: s.end, at: mmss(s.start), label: s.label || null, chapter: s.chapter || null })),
    overlays: R.overlays.map((o) => ({ id: o.id, type: o.type, start: o.start, end: o.end, at: mmss(o.start) })),
    outputs: (v.outputs || []).map((o) => ({ name: o.name, format: o.format, enabled: o.enabled !== false, ...windowFor(o, R) })),
    chapters: R.chapters.map((c) => ({ ...c, at: mmss(c.start) })),
  };
}

// Kept for the studio (optional UI): check + frames for every output.
export const checkAndFrames = (projectDir) => check(projectDir, { output: "all" });

// ======================= cli =======================
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const cmd = args._[0];
  const project = args.project ? path.resolve(args.project) : null;
  const need = () => project || die("--project videos/<slug> is required");
  let out;
  try {
    if (cmd === "init") {
      if (!args.brand) die('usage: video.mjs init --brand brands/<slug> --title "…" [--slug …]');
      const r = await initVideo({ brandDir: args.brand, title: args.title, slug: args.slug });
      out = { project: path.relative(process.cwd(), r.project), slug: r.video.slug };
    } else if (cmd === "add") {
      if (!args.file) die("usage: video.mjs add --project videos/<slug> --file <clip> [--role a-roll|decks|face|b-roll] [--append|--no-append]");
      const v = await addClip(need(), args.file, args.role || "a-roll", { append: args["no-append"] ? false : args.append ? true : undefined });
      out = { clips: v.clips.map((c) => ({ id: c.id, role: c.role })), timeline: v.timeline.map((s) => `${s.id}:${s.clip}`) };
    } else if (cmd === "ingest") {
      const v = await ingest(need(), { force: Boolean(args.force), transcribe: Boolean(args.transcribe), language: args.language || null });
      out = { clips: v.clips.map((c) => ({ id: c.id, role: c.role, seconds: c.info?.duration, size: c.info ? `${c.info.width}×${c.info.height}` : null, audio: c.info?.hasAudio, sheets: c.sheets?.length || 0, sheetEvery: c.sheetEvery, transcript: c.transcript?.text || null })) };
    } else if (cmd === "plan") out = await planSummary(need());
    else if (cmd === "draft") {
      await warmHf(need());
      out = await draft(need(), { output: args.output || "all" });
      out.check = await check(need(), { output: args.output || "all" });
    } else if (cmd === "check") {
      await warmHf(need());
      out = { check: await check(need(), { output: args.output || "all" }) };
    } else if (cmd === "render") {
      await warmHf(need());
      out = { renders: await render(need(), { output: args.output || "all", quality: args.quality }) };
    } else if (cmd === "undo") out = await undo(need());
    else die("commands: init · add · ingest · plan · draft · check · render · undo");
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + "\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ ok: true, ...out }, null, 2) + "\n");
}
