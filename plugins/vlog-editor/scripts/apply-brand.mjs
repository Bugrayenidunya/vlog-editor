#!/usr/bin/env node
// Install a brand kit into a HyperFrames video project.
//
//   node apply-brand.mjs --brand brands/<slug> --project videos/<video-slug>
//
// Copies: DESIGN.md → <project>/DESIGN.md (HyperFrames reads it as the design spec),
//         fonts → assets/fonts/, logos → assets/brand/, sound → assets/brand/sound/,
//         components → compositions/brand/ (existing component files are kept unless --force).
// Writes <project>/brand.lock.json: which brand and version the video was made with (the performance
// loop joins analytics back to this, together with the video's edit.json fingerprint).
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, die, exists, ensureDir, writeJson, readJson } from "./lib/util.mjs";

async function copyFiles(srcDir, dstDir, filter = () => true, { overwrite = true } = {}) {
  if (!exists(srcDir)) return [];
  await ensureDir(dstDir);
  const out = [];
  for (const f of await fsp.readdir(srcDir)) {
    const s = path.join(srcDir, f);
    if (!(await fsp.stat(s)).isFile() || !filter(f)) continue;
    const d = path.join(dstDir, f);
    if (!overwrite && exists(d)) continue;
    await fsp.copyFile(s, d);
    out.push(path.relative(dstDir, d));
  }
  return out;
}

export async function applyBrand(brandDir, projectDir, { force = false, format = "vertical" } = {}) {
  brandDir = path.resolve(brandDir);
  projectDir = path.resolve(projectDir);
  const brandFile = path.join(brandDir, "brand.json");
  if (!exists(brandFile)) throw new Error(`no brand.json in ${brandDir} — build the kit first`);
  if (!exists(path.join(brandDir, "DESIGN.md"))) throw new Error(`no DESIGN.md in ${brandDir} — run build-kit.mjs`);
  await ensureDir(projectDir);
  const copied = {};
  await fsp.copyFile(path.join(brandDir, "DESIGN.md"), path.join(projectDir, "DESIGN.md"));
  copied.design = ["DESIGN.md"];
  copied.fonts = await copyFiles(path.join(brandDir, "fonts"), path.join(projectDir, "assets", "fonts"), (f) => f.endsWith(".woff2"));
  copied.logos = await copyFiles(path.join(brandDir, "logo"), path.join(projectDir, "assets", "brand"), (f) => /\.(png|svg|jpg)$/i.test(f));
  copied.sound = await copyFiles(path.join(brandDir, "sound"), path.join(projectDir, "assets", "brand", "sound"), (f) => /\.(wav|mp3|m4a|aac|ogg)$/i.test(f));
  // Kits since v0.3 keep one component set per format in components/<format>/; older kits have one flat set.
  const perFormat = path.join(brandDir, "components", format);
  copied.components = await copyFiles(exists(perFormat) ? perFormat : path.join(brandDir, "components"), path.join(projectDir, "compositions", "brand"), (f) => f.endsWith(".html"), { overwrite: force });
  const raw = await fsp.readFile(brandFile);
  const brand = JSON.parse(raw);
  const lock = {
    brand: path.basename(brandDir),
    name: brand.name,
    version: brand.version || null,
    hash: crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12),
    direction: brand.direction?.id || null,
    format,
    appliedAt: new Date().toISOString(),
  };
  const prev = await readJson(path.join(projectDir, "brand.lock.json"), null);
  if (prev?.hash && prev.hash !== lock.hash) lock.previous = { hash: prev.hash, appliedAt: prev.appliedAt };
  await writeJson(path.join(projectDir, "brand.lock.json"), lock);
  return { project: projectDir, copied, lock };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  if (!args.brand || !args.project) die("usage: apply-brand.mjs --brand brands/<slug> --project <hyperframes project> [--format vertical|horizontal|square] [--force]");
  const r = await applyBrand(args.brand, args.project, { force: Boolean(args.force), format: args.format || "vertical" });
  process.stdout.write(JSON.stringify({ ok: true, ...r, project: path.relative(process.cwd(), r.project) }, null, 2) + "\n");
}
