#!/usr/bin/env node
// Download Google Fonts as local .woff2 files plus an @font-face stylesheet (HyperFrames renders need local fonts).
//
//   node fonts.mjs --out brands/<slug>/fonts --family "Anton:400" --family "Inter:400,700,900" \
//                  [--subsets latin,latin-ext] [--url-prefix ""]
//
// Writes <out>/<family>-<weight>-<subset>.woff2, <out>/fonts.css and <out>/fonts.json.
// latin-ext is on by default: Turkish (ğ ş ı İ), Polish, Czech… need it.
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, log, die, ensureDir, writeJson, slugify, exists } from "./lib/util.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LICENSE_URL = (family) => `https://fonts.google.com/specimen/${family.replace(/ /g, "+")}/license`;

async function css2(family, weights) {
  const q = weights.length && !(weights.length === 1 && weights[0] === 400) ? `${family.replace(/ /g, "+")}:wght@${weights.join(";")}` : family.replace(/ /g, "+");
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${q}&display=swap`, { headers: { "User-Agent": UA } });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

function parseFaces(css) {
  // Google annotates each block with /* subset */ before @font-face
  const faces = [];
  const re = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g;
  let m;
  while ((m = re.exec(css))) {
    const body = m[2];
    const get = (k) => (body.match(new RegExp(`${k}:\\s*([^;]+);`)) || [])[1]?.trim();
    const url = (get("src") || "").match(/url\(([^)]+)\)/)?.[1];
    faces.push({ subset: m[1], family: get("font-family")?.replace(/['"]/g, ""), style: get("font-style") || "normal", weight: Number(get("font-weight")) || 400, url, unicodeRange: get("unicode-range") });
  }
  return faces;
}

/**
 * @param {{families: {family: string, weights: number[]}[], outDir: string, subsets?: string[], urlPrefix?: string}} opts
 * @returns {Promise<{css: string, families: object[], missing: object[]}>}
 */
export async function fetchFonts({ families, outDir, subsets = ["latin", "latin-ext"], urlPrefix = "", cacheDir = null }) {
  await ensureDir(outDir);
  if (cacheDir) await ensureDir(cacheDir);
  const cssBlocks = [];
  const report = [];
  const missing = [];
  for (const { family, weights: wanted } of families) {
    const weights = [...new Set((wanted?.length ? wanted : [400]).map(Number))].sort((a, b) => a - b);
    let faces = [];
    let r = await css2(family, weights);
    if (r.ok) faces = parseFaces(r.text);
    else {
      // Some weights don't exist for this family: keep the ones that do.
      for (const w of weights) {
        const one = await css2(family, [w]);
        if (one.ok) faces.push(...parseFaces(one.text));
      }
    }
    if (!faces.length) {
      missing.push({ family, reason: r.status === 400 ? "not on Google Fonts (check the exact family name)" : `HTTP ${r.status}` });
      continue;
    }
    const available = [...new Set(faces.map((f) => f.subset))];
    const keep = faces.filter((f) => f.style === "normal" && subsets.includes(f.subset));
    const files = [];
    for (const f of keep) {
      const name = `${slugify(family)}-${f.weight}-${f.subset}.woff2`;
      const cached = cacheDir ? path.join(cacheDir, name) : null;
      if (cached && exists(cached)) await fsp.copyFile(cached, path.join(outDir, name));
      else {
        const buf = Buffer.from(await (await fetch(f.url, { headers: { "User-Agent": UA } })).arrayBuffer());
        await fsp.writeFile(path.join(outDir, name), buf);
        if (cached) await fsp.writeFile(cached, buf);
      }
      files.push(name);
      cssBlocks.push(`/* ${family} ${f.weight} ${f.subset} */\n@font-face {\n  font-family: "${family}";\n  font-style: normal;\n  font-weight: ${f.weight};\n  font-display: block;\n  src: url("${urlPrefix}${name}") format("woff2");\n  unicode-range: ${f.unicodeRange};\n}`);
    }
    const gotWeights = [...new Set(keep.map((f) => f.weight))].sort((a, b) => a - b);
    const lostWeights = weights.filter((w) => !gotWeights.includes(w));
    report.push({ family, weights: gotWeights, missingWeights: lostWeights, subsetsAvailable: available, subsetsSaved: [...new Set(keep.map((f) => f.subset))], latinExt: available.includes("latin-ext"), files, license: LICENSE_URL(family) });
    log(`  ✓ ${family} ${gotWeights.join("/")}${lostWeights.length ? ` (no ${lostWeights.join("/")})` : ""}${available.includes("latin-ext") ? "" : " ⚠ no latin-ext (Turkish ğ ş ı will fall back)"}`);
  }
  const css = cssBlocks.join("\n\n") + "\n";
  await fsp.writeFile(path.join(outDir, "fonts.css"), css);
  await writeJson(path.join(outDir, "fonts.json"), { source: "Google Fonts (SIL OFL / Apache 2.0 — check each license link)", families: report, missing });
  return { css, families: report, missing };
}

/** "Inter:400,700" → {family: "Inter", weights: [400, 700]} */
export function parseFamilySpec(spec) {
  const [family, w] = String(spec).split(":");
  return { family: family.trim(), weights: w ? w.split(",").map((x) => Number(x.trim())).filter(Boolean) : [400] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const specs = [].concat(args.family || []);
  if (!args.out || !specs.length) die('usage: fonts.mjs --out <dir> --family "Anton:400" [--family "Inter:400,700"] [--subsets latin,latin-ext] [--url-prefix ""]');
  const out = await fetchFonts({ families: specs.map(parseFamilySpec), outDir: path.resolve(args.out), subsets: String(args.subsets || "latin,latin-ext").split(","), urlPrefix: args["url-prefix"] || "" });
  process.stdout.write(JSON.stringify({ ok: out.missing.length === 0, families: out.families.map(({ files, ...f }) => f), missing: out.missing }, null, 2) + "\n");
}
