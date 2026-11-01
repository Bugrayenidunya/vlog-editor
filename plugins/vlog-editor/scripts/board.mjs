#!/usr/bin/env node
// Render brand direction boards (1080×1920 stills) and a side-by-side comparison sheet.
//
//   node board.mjs --brand-file brands/<slug>/directions/A/brand.json [--bg <image>]
//   node board.mjs --compare brands/<slug>/directions/{A,B,C}/brand.json --out brands/<slug>/directions/compare.png [--bg <image>]
//
// Each board shows the reel look (hook title, logo + handle, the caption style where captions really sit)
// above a spec panel (palette, type, motion, sound). Boards are HyperFrames projects in <direction>/.board/.
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, log, die, exists, ensureDir, writeJson, run, runHf, warmHf, parseJsonLoose, escapeHtml } from "./lib/util.mjs";
import { contrast } from "./lib/util.mjs";
import { loadBrand, validateBrand, fontFamilies, cssVariables, captionCss, captionWordsHtml, logoCss, logoHtml, fitDisplaySize, emphasize, recipeCss, recipeHtml } from "./lib/brand.mjs";
import { fetchFonts } from "./fonts.mjs";

const GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js";

function boardHtml(b, { fontsCss, chipId, chipLabel, sub, hasBg }) {
  const c = b.colors;
  // Captions live over footage, not over the brand ground: on a light ground, judge them on a footage-dark band.
  const needsPlate = !hasBg && b.captions.style !== "pill" && contrast(c.captionText, c.ground) < 3;
  const rec = b.samples.recipe || null;
  const hookSize = rec
    ? fitDisplaySize(b.samples.hook, { width: 1080 - b.layout.padX - b.layout.railRight, lines: 2, max: 118, min: 60, widthFactor: b.fonts.display.widthFactor ?? 0.5 })
    : fitDisplaySize(b.samples.hook, { width: 1080 - b.layout.padX - b.layout.railRight, lines: 3, max: 150, min: 76, widthFactor: b.fonts.display.widthFactor ?? 0.5 });
  const hookTop = rec ? 320 : 340;
  const recipeTop = Math.round(hookTop + 2 * hookSize * (b.fonts.display.lineHeight ?? 1) + 56);
  const recipeShown = rec ? { ...rec, tracks: (rec.tracks || []).slice(0, 2), steps: (rec.steps || []).slice(0, 1) } : null;
  const capWords = String(b.samples.caption).split(/\s+/).filter(Boolean);
  const groupSize = Math.max(...[].concat(b.captions.wordsPerGroup || [3]));
  const active = Math.min(b.samples.captionActive ?? 0, capWords.length - 1);
  const start = Math.max(0, Math.min(active - Math.floor(groupSize / 2), capWords.length - groupSize));
  const shown = b.captions.style === "kinetic" ? capWords.slice(active, active + 1) : capWords.slice(start, start + groupSize);
  const shownActive = b.captions.style === "kinetic" ? 0 : active - start;
  const swatches = [
    ["Ground", c.ground],
    ["Surface", c.surface],
    ["Ink", c.ink],
    ["Primary", c.primary],
    ["Accent", c.accent],
    ["Highlight", c.highlight],
  ];
  const m = b.motion;
  const motionLine = `${m.energy} energy · shots ${[].concat(m.pace?.shotSeconds || []).join("–")} s · ${[].concat(m.transitions || []).slice(0, 3).join(", ")}`;
  const soundLine = b.sound?.enabled ? `${[].concat(b.sound.music?.moods || []).slice(0, 2).join(", ")} ${[].concat(b.sound.music?.genres || []).slice(0, 2).join(" / ")}${b.sound.music?.bpm ? ` · ${[].concat(b.sound.music.bpm).join("–")} BPM` : ""}` : "no sonic identity yet";
  const handle = b.handles?.tiktok || b.handles?.instagram || b.handles?.youtube || "";
  return `<!doctype html>
<html lang="${escapeHtml((b.languages || ["en"])[0])}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="${GSAP}"></script>
    <style>
${fontsCss}
      :root {
${cssVariables(b)}
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: var(--color-ground); }
      #board { position: relative; width: 1080px; height: 1920px; overflow: hidden; background: var(--color-ground); color: var(--color-ink); font-family: var(--font-body); }
      .glow { position: absolute; inset: 0; background:
        radial-gradient(820px 720px at 88% 8%, color-mix(in srgb, var(--color-primary) 30%, transparent), transparent 70%),
        radial-gradient(760px 640px at 0% 72%, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 70%); }
      .bg-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .scrim { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.15) 40%, rgba(0,0,0,.2) 60%, rgba(0,0,0,.6) 100%); }
      .chip { position: absolute; top: 190px; left: var(--pad-x); right: var(--rail-right); display: flex; align-items: center; gap: 20px; }
      .chip-id { flex: none; width: 68px; height: 68px; border-radius: 50%; background: var(--color-ink); color: var(--color-ground); display: grid; place-items: center; font-family: var(--font-body); font-weight: 700; font-size: 34px; }
      .chip-label { font-family: var(--font-body); font-weight: 700; font-size: 32px; line-height: 1.1; }
      .chip-sub { font-family: var(--font-body); font-weight: 400; font-size: 23px; line-height: 1.3; color: var(--color-muted); margin-top: 4px; }
      .hook { position: absolute; top: ${hookTop}px; left: var(--pad-x); right: var(--rail-right); font-family: var(--font-display); font-weight: var(--display-weight); text-transform: var(--display-transform); letter-spacing: var(--display-tracking); line-height: var(--display-leading); font-size: ${hookSize}px; color: var(--color-ink); text-wrap: balance; }
      .hook em { font-style: normal; color: var(--color-highlight); }
      .cap-plate { position: absolute; left: 0; right: 0; top: 1000px; height: 360px; background: linear-gradient(180deg, transparent 0%, rgba(24,20,18,.82) 28%, rgba(24,20,18,.82) 72%, transparent 100%); }
      .cap-plate span { position: absolute; right: var(--pad-x); bottom: 70px; font-family: var(--font-body); font-size: 18px; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.45); }
      .brandline { position: absolute; top: 880px; left: var(--pad-x); right: var(--rail-right); display: flex; align-items: center; gap: 22px; }
      .handle { font-family: var(--font-body); font-weight: 700; font-size: 30px; color: var(--color-muted); }
${captionCss()}
${logoCss()}
${recipeCss()}
      .spec { position: absolute; left: 36px; right: 36px; bottom: 36px; height: 520px; background: var(--color-surface); border-radius: 40px; padding: 38px 44px; display: flex; flex-direction: column; gap: 30px; }
      .swatches { display: flex; justify-content: space-between; }
      .sw { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 150px; }
      .sw i { display: block; width: 96px; height: 96px; border-radius: 50%; box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--color-ink) 18%, transparent); }
      .sw b { font-family: var(--font-body); font-weight: 700; font-size: 21px; }
      .sw span { font-family: var(--font-body); font-weight: 400; font-size: 19px; color: var(--color-muted); }
      .type { display: flex; gap: 28px; }
      .tp { flex: 1; display: flex; align-items: center; gap: 22px; }
      .tp .aa { font-size: 104px; line-height: 1; }
      .tp .aa.d { font-family: var(--font-display); font-weight: var(--display-weight); text-transform: none; }
      .tp .aa.b { font-family: var(--font-body); font-weight: 700; }
      .tp b { display: block; font-family: var(--font-body); font-weight: 700; font-size: 26px; }
      .tp span { font-family: var(--font-body); font-size: 20px; color: var(--color-muted); }
      .notes { font-family: var(--font-body); font-size: 22px; line-height: 1.45; color: var(--color-muted); }
      .notes b { color: var(--color-ink); font-weight: 700; }
    </style>
  </head>
  <body>
    <div id="board" data-composition-id="board" data-start="0" data-duration="1" data-width="1080" data-height="1920">
      ${hasBg ? '<img class="bg-img" src="assets/bg.jpg" alt="" /><div class="scrim"></div>' : '<div class="glow"></div>'}
      <div class="chip">
        <div class="chip-id">${escapeHtml(chipId)}</div>
        <div><div class="chip-label">${escapeHtml(chipLabel)}</div>${sub ? `<div class="chip-sub">${escapeHtml(sub)}</div>` : ""}</div>
      </div>
      <h1 class="hook">${emphasize(b.samples.hook, b.samples.hookEmphasis)}</h1>
      ${recipeShown ? recipeHtml(b, recipeShown).replace('class="rc"', `class="rc" style="top:${recipeTop}px"`) : `<div class="brandline">${logoHtml(b, b.logo.style, 64)}${handle ? `<span class="handle">${escapeHtml(handle)}</span>` : ""}</div>`}
      ${needsPlate ? '<div class="cap-plate"><span>over footage</span></div>' : ""}
      <div class="cap-group" data-cap-style="${escapeHtml(b.captions.style)}">${captionWordsHtml(shown, shownActive)}</div>
      <div class="spec">
        <div class="swatches">${swatches.map(([n, hex]) => `<div class="sw"><i style="background:${hex}"></i><b>${n}</b><span>${hex}</span></div>`).join("")}</div>
        <div class="type">
          <div class="tp"><span class="aa d">Aa</span><div><b>${escapeHtml(b.fonts.display.family)}</b><span>display · ${[].concat(b.fonts.display.weights).join("/")}</span></div></div>
          <div class="tp"><span class="aa b">Aa</span><div><b>${escapeHtml(b.fonts.body.family)}</b><span>body · captions ${escapeHtml(b.fonts.caption.family)} ${b.fonts.caption.weight}</span></div></div>
        </div>
        <div class="notes"><b>Captions</b> ${escapeHtml(b.captions.style)} · <b>Logo</b> ${escapeHtml(b.logo.style)}<br /><b>Motion</b> ${escapeHtml(motionLine)}<br /><b>Sound</b> ${escapeHtml(soundLine)}</div>
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["board"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

/** Build the board project for one direction. Returns { dir, label, issues }. */
export async function prepareBoard(brandFile, { bg, cacheDir } = {}) {
  const b = await loadBrand(brandFile);
  const issues = validateBrand(b);
  const dir = path.join(path.dirname(brandFile), ".board");
  await fsp.rm(dir, { recursive: true, force: true });
  await ensureDir(path.join(dir, "assets", "fonts"));
  const fonts = await fetchFonts({ families: fontFamilies(b), outDir: path.join(dir, "assets", "fonts"), urlPrefix: "assets/fonts/", cacheDir });
  for (const m of fonts.missing) issues.push({ level: "error", msg: `font ${m.family}: ${m.reason}` });
  for (const f of fonts.families) if (!f.latinExt && (b.languages || []).some((l) => ["tr", "pl", "cs", "ro", "hu", "hr", "sk", "sl", "lv", "lt"].includes(l))) issues.push({ level: "warn", msg: `font ${f.family} has no latin-ext glyphs for ${b.languages.join("/")}` });
  const hasBg = Boolean(bg && exists(bg));
  if (hasBg) {
    await run("ffmpeg", ["-v", "error", "-y", "-i", path.resolve(bg), "-frames:v", "1", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", "-q:v", "3", path.join(dir, "assets", "bg.jpg")]);
  }
  const id = b.direction?.id || path.basename(path.dirname(brandFile));
  const label = `${id} · ${b.direction?.label || b.name}`;
  await fsp.writeFile(path.join(dir, "index.html"), boardHtml(b, { fontsCss: fonts.css.replace(/^/gm, "      "), chipId: id, chipLabel: b.direction?.label || b.name, sub: b.direction?.summary || b.tagline, hasBg }));
  await writeJson(path.join(dir, "meta.json"), { id: `board-${id}`, name: label });
  return { dir, label, issues, brand: b };
}

export async function snapshotBoard(dir, outPng) {
  const shots = path.join(dir, ".shots");
  const r = await runHf(["snapshot", dir, "--at", "0.5", "--no-end", "-o", shots, "--json"], { timeoutMs: 180000, workspace: dir });
  const j = parseJsonLoose(r.stdout);
  const found = (await fsp.readdir(shots).catch(() => [])).filter((f) => f.endsWith(".png")).map((f) => path.join(shots, f));
  const png = j?.paths?.[0] || j?.frames?.[0]?.path || found[0];
  if (!png || !exists(png)) throw new Error(`snapshot failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`);
  await fsp.copyFile(png, outPng);
  return outPng;
}

export async function compareBoards(dirs, labels, outPng) {
  const safe = labels.map((l) => l.replace(/,/g, " "));
  const r = await runHf(["compare", ...dirs, "--at", "0.5", "--labels", safe.join(","), "--out", outPng, "--cols", String(Math.min(4, dirs.length)), "--timeout", "30000", "--json"], { timeoutMs: 300000, workspace: dirs[0] });
  if (!exists(outPng)) throw new Error(`compare failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`);
  return outPng;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const files = [].concat(args.compare || [], args._ || [], args["brand-file"] || []).filter((x) => typeof x === "string");
  if (!files.length) die("usage: board.mjs --brand-file <brand.json> | --compare <a.json> <b.json> … --out compare.png [--bg image]");
  const brandsRoot = path.resolve(files[0], "..", "..", "..");
  const cacheDir = path.join(brandsRoot, ".cache", "fonts");
  await warmHf(path.dirname(path.resolve(files[0])));
  const results = [];
  for (const f of files.map((x) => path.resolve(x))) {
    log(`→ board ${path.relative(process.cwd(), f)}`);
    const prep = await prepareBoard(f, { bg: args.bg, cacheDir });
    const png = await snapshotBoard(prep.dir, path.join(path.dirname(f), "board.png"));
    results.push({ brand: path.relative(process.cwd(), f), board: path.relative(process.cwd(), png), label: prep.label, issues: prep.issues, dir: prep.dir });
  }
  let compare = null;
  if (args.compare || files.length > 1) {
    const out = path.resolve(args.out || path.join(path.dirname(path.dirname(path.resolve(files[0]))), "compare.png"));
    compare = path.relative(process.cwd(), await compareBoards(results.map((r) => r.dir), results.map((r) => r.label), out));
  }
  process.stdout.write(JSON.stringify({ ok: true, boards: results.map(({ dir, ...r }) => r), compare }, null, 2) + "\n");
}
