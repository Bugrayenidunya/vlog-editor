#!/usr/bin/env node
// Video projects: one HyperFrames project per video, assembled from the brand kit.
//
//   node video.mjs init   --brand brands/<slug> --title "Up the wheel" [--slug 2026-11-02-up-the-wheel]
//   node video.mjs add    --project videos/<slug> --file <clip> [--role main|face|broll]
//   node video.mjs ingest --project videos/<slug> [--force]
//   node video.mjs draft  --project videos/<slug> [--force]       (regenerates index.html from video.json)
//   node video.mjs render --project videos/<slug>
//   node video.mjs undo   --project videos/<slug>
//
// video.json is the structured source of truth: clips (role, trim, crop), hook, recipe, blend time, CTA.
// `draft` writes index.html from it; hand or Claude edits to index.html set "locked": true, and draft then
// refuses to overwrite unless --force. Every draft keeps a restorable version in .vlog/versions/.
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, log, die, exists, ensureDir, readJson, writeJson, run, runHf, warmHf, parseJsonLoose, slugify, round, escapeHtml } from "./lib/util.mjs";
import { withDefaults } from "./lib/brand.mjs";
import { applyBrand } from "./apply-brand.mjs";

const VIDEO_SCHEMA = "vlog-editor/video@1";

// ---------------- helpers ----------------
async function probe(file) {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeoutMs: 60000 });
  const j = parseJsonLoose(r.stdout) || {};
  const v = (j.streams || []).find((s) => s.codec_type === "video") || {};
  const a = (j.streams || []).find((s) => s.codec_type === "audio");
  const rot = Number(v.tags?.rotate || v.side_data_list?.find((s) => s.rotation != null)?.rotation || 0);
  const swap = Math.abs(rot) === 90 || Math.abs(rot) === 270;
  const [n, d] = String(v.r_frame_rate || "30/1").split("/").map(Number);
  return { width: swap ? v.height : v.width, height: swap ? v.width : v.height, codec: v.codec_name, fps: d ? round(n / d, 3) : 30, duration: round(Number(j.format?.duration) || 0, 3), hasAudio: Boolean(a) };
}

const hash = async (p) => (exists(p) ? crypto.createHash("sha256").update(await fsp.readFile(p)).digest("hex").slice(0, 16) : null);

export async function loadVideo(projectDir) {
  const v = await readJson(path.join(projectDir, "video.json"), null);
  if (!v) throw new Error(`no video.json in ${projectDir}`);
  return v;
}

export async function saveVideo(projectDir, v) {
  v.updatedAt = new Date().toISOString();
  await writeJson(path.join(projectDir, "video.json"), v);
  return v;
}

/** Copy index.html, video.json and brand compositions into .vlog/versions/<stamp>/ (for undo). */
export async function snapshotVersion(projectDir, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = await ensureDir(path.join(projectDir, ".vlog", "versions", stamp));
  for (const f of ["index.html", "video.json"]) if (exists(path.join(projectDir, f))) await fsp.copyFile(path.join(projectDir, f), path.join(dir, f));
  const comp = path.join(projectDir, "compositions", "brand");
  if (exists(comp)) {
    await ensureDir(path.join(dir, "compositions"));
    for (const f of await fsp.readdir(comp)) await fsp.copyFile(path.join(comp, f), path.join(dir, "compositions", f));
  }
  await writeJson(path.join(dir, "reason.json"), { reason, at: new Date().toISOString() });
  // keep the newest 30
  const all = (await fsp.readdir(path.join(projectDir, ".vlog", "versions"))).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 30))) await fsp.rm(path.join(projectDir, ".vlog", "versions", old), { recursive: true, force: true });
  return stamp;
}

export async function undo(projectDir) {
  const root = path.join(projectDir, ".vlog", "versions");
  const all = (await fsp.readdir(root).catch(() => [])).sort();
  const last = all.at(-1);
  if (!last) throw new Error("nothing to undo");
  const dir = path.join(root, last);
  for (const f of ["index.html", "video.json"]) if (exists(path.join(dir, f))) await fsp.copyFile(path.join(dir, f), path.join(projectDir, f));
  if (exists(path.join(dir, "compositions"))) for (const f of await fsp.readdir(path.join(dir, "compositions"))) await fsp.copyFile(path.join(dir, "compositions", f), path.join(projectDir, "compositions", "brand", f));
  const reason = await readJson(path.join(dir, "reason.json"), {});
  await fsp.rm(dir, { recursive: true, force: true });
  return { restored: last, reason: reason.reason || null };
}

// ---------------- init ----------------
export async function initVideo({ brandDir, title, slug, workspace = process.cwd() }) {
  brandDir = path.resolve(brandDir);
  const brand = await readJson(path.join(brandDir, "brand.json"), null);
  if (!brand) throw new Error(`no brand.json in ${brandDir} — build the brand kit first`);
  const date = new Date().toISOString().slice(0, 10);
  slug = slug || `${date}-${slugify(title || "video") || "video"}`;
  const projectDir = path.resolve(workspace, "videos", slug);
  if (exists(path.join(projectDir, "video.json"))) throw new Error(`videos/${slug} already exists`);
  await ensureDir(path.dirname(projectDir));
  const r = await runHf(["init", projectDir, "--resolution", "portrait", "--non-interactive", "--skip-skills"], { cwd: workspace, timeoutMs: 300000, workspace });
  if (!exists(path.join(projectDir, "index.html"))) throw new Error(`hyperframes init failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ")}`);
  await applyBrand(brandDir, projectDir, { force: true });
  const b = withDefaults(brand);
  const v = {
    schema: VIDEO_SCHEMA,
    slug,
    title: title || slug,
    brand: path.basename(brandDir),
    createdAt: new Date().toISOString(),
    clips: [],
    hook: { text: b.samples.hook, emphasis: b.samples.hookEmphasis || "" },
    recipe: b.samples.recipe ? structuredClone(b.samples.recipe) : null,
    blendAt: null,
    faceSeconds: 2.5,
    maxSeconds: 60,
    lowerThird: null,
    captions: [],
    endCard: { cta: b.samples.cta || "", seconds: 2.5 },
    audio: { lufs: b.sound?.music?.lufs ?? -14 },
    locked: false,
    claude: { session: null },
    chat: [],
    renders: [],
  };
  await saveVideo(projectDir, v);
  await fsp.mkdir(path.join(projectDir, "source"), { recursive: true });
  return { project: projectDir, video: v };
}

// ---------------- add ----------------
export async function addClip(projectDir, file, role = "main") {
  const v = await loadVideo(projectDir);
  const name = path.basename(file).replace(/[^\w.\- ]+/g, "_");
  const dst = path.join(projectDir, "source", name);
  if (path.resolve(file) !== dst) {
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(path.resolve(file), dst);
  }
  let id = slugify(name.replace(/\.[^.]+$/, "")) || "clip";
  while (v.clips.some((c) => c.id === id && c.file !== `source/${name}`)) id += "-2";
  v.clips = v.clips.filter((c) => c.file !== `source/${name}`);
  if (role === "main") for (const c of v.clips) if (c.role === "main") c.role = "broll";
  v.clips.push({ id, file: `source/${name}`, role, in: 0, out: null, focusX: 0.5 });
  await saveVideo(projectDir, v);
  return v;
}

// ---------------- ingest ----------------
async function loudness(file) {
  const r = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { timeoutMs: 600000 });
  const m = r.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

export async function ingest(projectDir, { force = false } = {}) {
  const v = await loadVideo(projectDir);
  if (!v.clips.length) throw new Error("add at least one clip first");
  const mediaDir = await ensureDir(path.join(projectDir, "assets", "media"));
  const sheetDir = await ensureDir(path.join(projectDir, ".vlog", "sheets"));
  for (const c of v.clips) {
    const src = path.join(projectDir, c.file);
    if (!exists(src)) throw new Error(`missing ${c.file}`);
    const srcHash = (await fsp.stat(src)).size + "-" + Math.round((await fsp.stat(src)).mtimeMs);
    const work = path.join(mediaDir, `${c.id}.mp4`);
    if (!force && c.srcHash === srcHash && exists(work)) continue;
    log(`→ ${c.id}: probing and making an H.264 working copy`);
    const info = await probe(src);
    // Short side 1080, 30 fps constant, H.264 + AAC: plays everywhere, seeks exactly.
    const landscape = info.width >= info.height;
    const scale = landscape ? "scale=-2:1080" : "scale=1080:-2";
    const r = await run("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `${scale},fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "30", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", work], { timeoutMs: 1800000 });
    if (r.code !== 0) throw new Error(`transcode failed for ${c.id}: ${r.stderr.trim().split("\n").pop()}`);
    c.info = await probe(work);
    c.work = path.relative(projectDir, work);
    c.srcHash = srcHash;
    const every = c.info.duration > 60 ? Math.ceil(c.info.duration / 24) : 2;
    const sheet = path.join(sheetDir, `${c.id}.jpg`);
    await run("ffmpeg", ["-v", "error", "-y", "-i", work, "-vf", `fps=1/${every},scale=240:-2,tile=6x4:padding=4:color=white`, "-frames:v", "1", "-q:v", "4", sheet], { timeoutMs: 300000 });
    await run("ffmpeg", ["-v", "error", "-y", "-i", work, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", path.join(sheetDir, `${c.id}.thumb.jpg`)], { timeoutMs: 60000 });
    c.sheet = path.relative(projectDir, sheet);
    c.sheetEvery = every;
    c.thumb = path.relative(projectDir, path.join(sheetDir, `${c.id}.thumb.jpg`));
  }
  // Master audio from the main clip, two-pass loudness normalisation to the brand target.
  const main = v.clips.find((c) => c.role === "main") || v.clips[0];
  const target = v.audio?.lufs ?? -14;
  const masterRel = "assets/audio/master.m4a";
  const master = path.join(projectDir, masterRel);
  if (main.info?.hasAudio && (force || v.audio?.masterFrom !== main.srcHash || !exists(master))) {
    log(`→ master audio from ${main.id} at ${target} LUFS`);
    await ensureDir(path.dirname(master));
    const before = await loudness(path.join(projectDir, main.work));
    const lin = before ? `:measured_I=${before.input_i}:measured_TP=${before.input_tp}:measured_LRA=${before.input_lra}:measured_thresh=${before.input_thresh}:offset=${before.target_offset}:linear=true` : "";
    const r = await run("ffmpeg", ["-v", "error", "-y", "-i", path.join(projectDir, main.work), "-vn", "-af", `loudnorm=I=${target}:TP=-1:LRA=11${lin},aresample=48000`, "-c:a", "aac", "-b:a", "256k", master], { timeoutMs: 1800000 });
    if (r.code !== 0) throw new Error(`audio master failed: ${r.stderr.trim().split("\n").pop()}`);
    const after = await loudness(master);
    v.audio = { ...v.audio, lufs: target, master: masterRel, masterFrom: main.srcHash, sourceLufs: before ? +before.input_i : null, masterLufs: after ? +after.input_i : null };
  }
  await saveVideo(projectDir, v);
  return v;
}

// ---------------- draft ----------------
const fx = (n) => Number(n.toFixed(3));

/** Compute the timeline from video.json (pure). */
export function plan(v) {
  const main = v.clips.find((c) => c.role === "main") || v.clips[0];
  if (!main?.info) throw new Error("ingest the clips first");
  const face = v.clips.find((c) => c.role === "face" && c.info);
  const mIn = Math.max(0, main.in || 0);
  const mOut = Math.min(main.info.duration, main.out || main.info.duration);
  const T = fx(Math.max(4, Math.min(v.maxSeconds || 60, mOut - mIn)));
  const faceLen = face ? Math.min(face.info.duration - (face.in || 0), (face.out || face.info.duration) - (face.in || 0)) : 0;
  const F = face ? fx(Math.max(0, Math.min(v.faceSeconds ?? 2.5, faceLen, T - 2))) : 0;
  const end = Math.min(v.endCard?.seconds ?? 2.5, T / 3);
  const hookEnd = fx(Math.min(3.2, Math.max(2, T * 0.25)));
  const recipeLen = 4.5;
  const latest = T - end - recipeLen;
  const recipeAt = v.recipe ? fx(Math.max(hookEnd + 0.3, Math.min(v.blendAt ?? T * 0.4, latest))) : null;
  const lt = v.lowerThird?.title ? { at: fx(Math.max(0, Math.min(v.lowerThird.at ?? hookEnd + 0.4, T - end - 3))), dur: 3 } : null;
  return { main, face, mIn, mOut, T, F, end: fx(end), endAt: fx(T - end), hookEnd, recipeAt, recipeLen: v.recipe ? fx(Math.min(recipeLen, T - end - recipeAt)) : 0, lt };
}

function wordsFromBeats(beats) {
  const words = [];
  for (const b of beats || []) {
    const ws = String(b.text || "").split(/\s+/).filter(Boolean);
    const dur = Math.max(0.3, (b.end ?? b.start + 2) - b.start);
    ws.forEach((w, i) => words.push({ text: w, start: fx(b.start + (i * dur) / ws.length), end: fx(b.start + ((i + 1) * dur) / ws.length - 0.02) }));
  }
  return words;
}

async function fillMarker(file, startMarker, endMarker, replacement) {
  if (!exists(file)) return false;
  const html = await fsp.readFile(file, "utf8");
  const re = new RegExp(`(// ${startMarker}[^\\n]*\\n)[\\s\\S]*?(\\n\\s*// ${endMarker})`);
  if (!re.test(html)) return false;
  await fsp.writeFile(file, html.replace(re, `$1      ${replacement}$2`));
  return true;
}

export async function draft(projectDir, { force = false } = {}) {
  const v = await loadVideo(projectDir);
  if (v.locked && !force) throw Object.assign(new Error("this video was hand-edited (locked); drafting would overwrite index.html — pass --force"), { code: "locked" });
  const p = plan(v);
  await snapshotVersion(projectDir, "draft");
  const brand = await readJson(path.join(projectDir, "..", "..", "brands", v.brand, "brand.json"), null);
  const b = withDefaults(brand || {});
  const handle = b.handles?.tiktok || b.handles?.instagram || b.handles?.youtube || "";
  const comp = path.join(projectDir, "compositions", "brand");
  if (v.recipe) await fillMarker(path.join(comp, "brand-recipe-card.html"), "@recipe-start", "@recipe-end", `var RECIPE = ${JSON.stringify(v.recipe)};`);
  const capWords = wordsFromBeats(v.captions);
  const capStart = v.captions?.length ? fx(Math.max(0, Math.min(...v.captions.map((c) => c.start)) - 0.1)) : 0;
  const capEnd = v.captions?.length ? fx(Math.max(...v.captions.map((c) => c.end ?? c.start + 2)) + 0.3) : 0;
  const shiftedWords = capWords.map((w) => ({ ...w, start: fx(w.start - capStart), end: fx(w.end - capStart) }));
  if (capWords.length) await fillMarker(path.join(comp, "brand-captions.html"), "@words-start", "@words-end", `var WORDS = ${JSON.stringify(shiftedWords)};`);

  const host = (id, start, dur, track, values, kind = "graphics") =>
    `<div id="${id}" data-composition-id="${id}" data-composition-src="compositions/brand/${id}.html" data-start="${fx(start)}" data-duration="${fx(dur)}" data-track-index="${track}" data-track-kind="${kind}" data-width="1080" data-height="1920"${values ? ` data-variable-values='${JSON.stringify(values).replace(/&/g, "&amp;").replace(/'/g, "&#39;")}'` : ""}></div>`;
  const pos = (c) => `${Math.round((c.focusX ?? 0.5) * 100)}% 50%`;
  const lines = [];
  if (p.face) lines.push(`<video id="face" class="clip" src="${p.face.work}" data-start="0" data-duration="${p.F}" data-media-start="${fx(p.face.in || 0)}" data-track-index="0" muted playsinline style="object-position:${pos(p.face)}"></video>`);
  lines.push(`<video id="main" class="clip" src="${p.main.work}" data-start="${p.F}" data-duration="${fx(p.T - p.F)}" data-media-start="${fx(p.mIn + p.F)}" data-track-index="1" muted playsinline style="object-position:${pos(p.main)}"></video>`);
  if (v.audio?.master) lines.push(`<audio id="mix" src="${v.audio.master}" data-start="0" data-duration="${p.T}" data-media-start="${fx(p.mIn)}" data-fade-out="1.2"></audio>`);
  lines.push(host("brand-hook", 0, p.hookEnd, 3, { hook: v.hook?.text || "", emphasis: v.hook?.emphasis || "" }));
  if (p.recipeAt != null && p.recipeLen > 1) lines.push(host("brand-recipe-card", p.recipeAt, p.recipeLen, 4, { top: 560 }));
  if (p.lt) lines.push(host("brand-lower-third", p.lt.at, p.lt.dur, 5, { title: v.lowerThird.title, subtitle: v.lowerThird.subtitle || "" }));
  if (capWords.length) lines.push(host("brand-captions", capStart, capEnd - capStart, 6, null, "captions"));
  lines.push(host("brand-end-card", p.endAt, p.end, 7, { cta: v.endCard?.cta || "", handle }));

  const html = `<!doctype html>
<html lang="${escapeHtml((b.languages || ["en"])[0])}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <!-- Generated by vlog-editor from video.json. Hand edits are fine: set "locked": true in video.json. -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: ${b.colors.ground}; }
      #root video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${p.T}" data-width="1080" data-height="1920">
      ${lines.join("\n      ")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
  await fsp.writeFile(path.join(projectDir, "index.html"), html);
  v.locked = false;
  v.plan = { T: p.T, faceSeconds: p.F, hookEnd: p.hookEnd, recipeAt: p.recipeAt, endAt: p.endAt, lowerThirdAt: p.lt?.at ?? null };
  v.indexHash = await hash(path.join(projectDir, "index.html"));
  await saveVideo(projectDir, v);
  return { video: v, plan: v.plan };
}

// ---------------- check + frames ----------------
export async function checkAndFrames(projectDir, { at } = {}) {
  const v = await loadVideo(projectDir);
  const r = await runHf(["check", projectDir, "--json"], { cwd: projectDir, timeoutMs: 600000, workspace: projectDir });
  const j = parseJsonLoose(r.stdout);
  const findings = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if ((o.severity || o.level) && (o.message || o.code)) findings.push({ level: o.severity || o.level, code: o.code || o.rule || null, message: String(o.message || "").slice(0, 300) });
    Object.values(o).forEach(walk);
  };
  walk(j);
  const errors = findings.filter((f) => /error/i.test(f.level));
  const warnings = findings.filter((f) => /warn/i.test(f.level));
  const T = v.plan?.T || 10;
  const moments = [0.3, v.plan?.lowerThirdAt != null ? v.plan.lowerThirdAt + 1 : null, v.plan?.recipeAt != null ? v.plan.recipeAt + 1.2 : T * 0.45, T * 0.7, (v.plan?.endAt ?? T - 2) + 1.2].filter((t) => t != null);
  const times = at || [...new Set(moments.map((t) => fx(Math.min(T - 0.05, Math.max(0, t)))))].sort((a, b) => a - b);
  const out = path.join(projectDir, ".vlog", "frames");
  await fsp.rm(out, { recursive: true, force: true });
  const s = await runHf(["snapshot", projectDir, "--at", times.join(","), "--no-end", "-o", out, "--json"], { cwd: projectDir, timeoutMs: 600000, workspace: projectDir });
  const frames = (await fsp.readdir(out).catch(() => [])).filter((f) => f.endsWith(".png")).sort((a, b2) => parseFloat(a.replace(/[^\d.]/g, "")) - parseFloat(b2.replace(/[^\d.]/g, ""))).map((f) => path.relative(projectDir, path.join(out, f)));
  v.lastCheck = { at: new Date().toISOString(), ok: errors.length === 0 && (j?.ok !== false), errors: errors.slice(0, 20), warnings: warnings.slice(0, 20), frames, times };
  if (!frames.length) v.lastCheck.snapshotError = (s.stderr || s.stdout).trim().split("\n").slice(-3).join(" ");
  // Hand or Claude edits since the last draft lock the video against regeneration.
  const h = await hash(path.join(projectDir, "index.html"));
  if (v.indexHash && h !== v.indexHash) v.locked = true;
  await saveVideo(projectDir, v);
  return v.lastCheck;
}

// ---------------- render ----------------
export async function render(projectDir) {
  const v = await loadVideo(projectDir);
  const check = await checkAndFrames(projectDir, { at: [0.3] });
  if (check.errors.length) throw new Error(`fix check errors first: ${check.errors.map((e) => e.message).slice(0, 3).join(" · ")}`);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const out = path.join(projectDir, "renders", `${v.slug}_${stamp}.mp4`);
  await ensureDir(path.dirname(out));
  log("→ rendering (this takes about as long as the video, often less)");
  const r = await runHf(["render", "-o", out, "--quiet"], { cwd: projectDir, timeoutMs: 3600000, workspace: projectDir });
  if (!exists(out)) throw new Error(`render failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`);
  const info = await probe(out);
  const ln = await loudness(out);
  const lock = await readJson(path.join(projectDir, "brand.lock.json"), {});
  const p = v.plan || {};
  // The edit fingerprint: what this video did, so performance can be joined back to style later.
  const fingerprint = {
    schema: "vlog-editor/edit@1",
    video: v.slug,
    renderedAt: new Date().toISOString(),
    file: path.relative(projectDir, out),
    brand: { slug: lock.brand || v.brand, version: lock.version ?? null, hash: lock.hash ?? null, direction: lock.direction ?? null },
    seconds: info.duration,
    lufs: ln ? +ln.input_i : null,
    hook: { text: v.hook?.text || "", emphasis: v.hook?.emphasis || "", seconds: p.hookEnd ?? null, formula: v.hook?.formula || null },
    faceAtFrame0: (p.faceSeconds || 0) > 0,
    firstCut: (p.faceSeconds || 0) > 0 ? p.faceSeconds : null,
    recipe: v.recipe ? { at: p.recipeAt ?? null, tracks: (v.recipe.tracks || []).length, steps: v.recipe.steps || [] } : null,
    lowerThird: Boolean(v.lowerThird?.title),
    captions: (v.captions || []).length,
    endCard: { cta: v.endCard?.cta || "", seconds: v.endCard?.seconds ?? null },
    clips: v.clips.map((c) => ({ id: c.id, role: c.role, in: c.in || 0, out: c.out ?? null, focusX: c.focusX ?? 0.5 })),
    handEdited: Boolean(v.locked),
    claudeTurns: (v.chat || []).filter((m) => m.role === "user").length,
  };
  await writeJson(path.join(projectDir, "edit.json"), fingerprint);
  v.renders = [...(v.renders || []), { file: fingerprint.file, at: fingerprint.renderedAt, seconds: info.duration, lufs: fingerprint.lufs }];
  await saveVideo(projectDir, v);
  return { file: fingerprint.file, seconds: info.duration, lufs: fingerprint.lufs, fingerprint };
}

// ---------------- cli ----------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const cmd = args._[0];
  const project = args.project ? path.resolve(args.project) : null;
  const need = () => project || die("--project videos/<slug> is required");
  let out;
  try {
    if (cmd === "init") {
      if (!args.brand) die('usage: video.mjs init --brand brands/<slug> --title "…" [--slug …]');
      out = await initVideo({ brandDir: args.brand, title: args.title, slug: args.slug });
      out.project = path.relative(process.cwd(), out.project);
    } else if (cmd === "add") {
      if (!args.file) die("usage: video.mjs add --project videos/<slug> --file <clip> [--role main|face|broll]");
      out = { video: await addClip(need(), args.file, args.role || "main") };
    } else if (cmd === "ingest") out = { video: await ingest(need(), { force: Boolean(args.force) }) };
    else if (cmd === "draft") {
      await warmHf(need());
      out = await draft(need(), { force: Boolean(args.force) });
      out.check = await checkAndFrames(need());
    } else if (cmd === "check") out = { check: await checkAndFrames(need()) };
    else if (cmd === "render") {
      await warmHf(need());
      out = await render(need());
    } else if (cmd === "undo") out = await undo(need());
    else die("commands: init · add · ingest · draft · check · render · undo");
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message, code: e.code || null }) + "\n");
    process.exit(1);
  }
  if (out?.video) out.video = { slug: out.video.slug, clips: out.video.clips.length, locked: out.video.locked, plan: out.video.plan ?? null };
  process.stdout.write(JSON.stringify({ ok: true, ...out }, null, 2) + "\n");
}
