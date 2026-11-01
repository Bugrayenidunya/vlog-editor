// Studio steps: each is one job. Engine steps run the plugin scripts; judgment steps run Claude headless
// with the same reference docs the brand-kit skill uses, so both interfaces produce the same artifacts.
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude } from "./claude.mjs";

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS = path.join(PLUGIN_ROOT, "scripts");
const REFS = path.join(PLUGIN_ROOT, "skills", "brand-kit", "references");

const exists = (p) => fsp.access(p).then(() => true, () => false);
const readJson = async (p, fb = null) => {
  try {
    return JSON.parse(await fsp.readFile(p, "utf8"));
  } catch {
    return fb;
  }
};

export function runScript(ctx, name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, `${name}.mjs`), ...args], { cwd: ctx.ws });
    ctx.onSpawn?.(child);
    let out = "";
    let errBuf = "";
    let tail = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => {
      errBuf += d;
      tail = (tail + d).slice(-4000);
      let i;
      while ((i = errBuf.indexOf("\n")) >= 0) {
        const line = errBuf.slice(0, i).trimEnd();
        errBuf = errBuf.slice(i + 1);
        if (line) ctx.log(line);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      let json = null;
      try {
        json = JSON.parse(out.slice(out.indexOf("{")));
      } catch {}
      if (code !== 0 || !json) return reject(new Error(`${name} failed (exit ${code}): ${tail.trim().split("\n").slice(-3).join(" ")}`));
      resolve(json);
    });
  });
}

const preamble = (ctx) => `You are running one step of the vlog-editor brand-kit engine, headless, for the brand at brands/${ctx.slug}/ (workspace root: the current directory).
Rules: do not ask questions — decide, and list anything uncertain in your final answer. Work only inside brands/${ctx.slug}/. Read files before you rely on them. Look at images with the Read tool when the instructions say to look at pictures. You cannot run shell commands: write valid JSON carefully (double quotes, no trailing commas, no comments); the engine parses every JSON file you write when you finish and sends back any error.
The person's brief and choices: brands/${ctx.slug}/kit.state.json. Brand file schema: ${REFS}/brand-schema.md.`;

function claude(ctx, { prompt, schema, tools = ["Read", "Write", "Edit", "Glob", "Grep"] }) {
  ctx.log(`🤖 Claude is working (headless)…`);
  return runClaude({ prompt: `${preamble(ctx)}\n\n${prompt}`, cwd: ctx.ws, tools, schema, addDirs: [PLUGIN_ROOT], log: ctx.log, onSpawn: ctx.onSpawn }).then((r) => {
    if (r.cost != null) ctx.log(`   (${r.turns} turns)`);
    if (!r.ok) throw new Error(r.error || "Claude step failed");
    return r.output;
  });
}

async function setStage(ctx, stage) {
  const f = path.join(ctx.brandDir, "kit.state.json");
  const s = (await readJson(f, {})) || {};
  s.stage = stage;
  s.history = [...(s.history || []), { at: new Date().toISOString(), stage }].slice(-50);
  await fsp.writeFile(f, JSON.stringify(s, null, 2) + "\n");
}

async function directionFiles(ctx, ids) {
  const dir = path.join(ctx.brandDir, "directions");
  const all = (await fsp.readdir(dir).catch(() => [])).filter((d) => /^[A-Z][0-9]*$/.test(d)).sort();
  const pick = ids?.length ? all.filter((d) => ids.includes(d)) : all;
  const files = [];
  for (const d of pick) if (await exists(path.join(dir, d, "brand.json"))) files.push(path.join("brands", ctx.slug, "directions", d, "brand.json"));
  return files;
}

async function renderBoards(ctx, ids, { compare = true } = {}) {
  const files = await directionFiles(ctx, ids);
  if (!files.length) throw new Error("no directions to render");
  const state = await readJson(path.join(ctx.brandDir, "kit.state.json"), {});
  const args = [...(compare && files.length > 1 ? ["--compare"] : ["--brand-file"]), ...files];
  const isMainSet = !ids?.length || ids.join("") === "ABC";
  if (compare && files.length > 1) args.push("--out", path.join("brands", ctx.slug, "directions", isMainSet ? "compare.png" : `compare-${ids.join("")}.png`));
  if (state?.boardBackground) args.push("--bg", state.boardBackground);
  return runScript(ctx, "board", args);
}

/** Parse the JSON files a Claude step wrote; return "file: error" strings for the ones that don't parse. */
async function badJson(ctx, rels) {
  const bad = [];
  for (const rel of rels) {
    try {
      JSON.parse(await fsp.readFile(path.join(ctx.brandDir, rel), "utf8"));
    } catch (e) {
      bad.push(`${rel}: ${e.code === "ENOENT" ? "missing" : e.message}`);
    }
  }
  return bad;
}

async function ensureJson(ctx, rels, what) {
  const bad = await badJson(ctx, rels);
  if (!bad.length) return;
  ctx.log(`⚠ invalid JSON — asking Claude to fix: ${bad.join("; ")}`);
  await claude(ctx, {
    prompt: `STEP: fix JSON. These files from the ${what} step do not parse:\n${bad.map((b) => `- brands/${ctx.slug}/${b}`).join("\n")}\nRewrite each so it is valid JSON with the same content.`,
    schema: { type: "object", properties: { fixed: { type: "array", items: { type: "string" } } }, required: ["fixed"] },
  });
  const still = await badJson(ctx, rels);
  if (still.length) throw new Error(`still invalid JSON: ${still.join("; ")}`);
}

const errorsOf = (boards) => (boards?.boards || []).flatMap((b) => (b.issues || []).filter((i) => i.level === "error").map((i) => `${b.label}: ${i.msg}`));

export const STEPS = {
  /** Rank and download. opts.dryRun lists the top posts without downloading. */
  async collect(ctx) {
    const r = await runScript(ctx, "collect", ["--brand", path.join("brands", ctx.slug), ...(ctx.opts.dryRun ? ["--dry-run"] : [])]);
    if (!ctx.opts.dryRun) await setStage(ctx, "analyze");
    return r;
  },

  async analyze(ctx) {
    const state = await readJson(path.join(ctx.brandDir, "kit.state.json"), {});
    const lang = ctx.opts.language || state?.brief?.languages?.[0] || "en";
    const r = await runScript(ctx, "analyze", ["--brand", path.join("brands", ctx.slug), ...(ctx.opts.transcribe === false ? [] : ["--transcribe", "--language", lang]), ...(ctx.opts.force ? ["--force"] : [])]);
    await setStage(ctx, "dna");
    return r;
  },

  async dna(ctx) {
    const out = await claude(ctx, {
      prompt: `STEP: style DNA. Read ${REFS}/style-dna.md and follow it exactly.
Inputs: brands/${ctx.slug}/research/dossier.md, brands/${ctx.slug}/research/dossier.json and the pictures they list (paths are relative to brands/${ctx.slug}/). Look at the first-frame grids and at least 8 hook strips.
Write brands/${ctx.slug}/research/style-dna.md and brands/${ctx.slug}/research/style-dna.json.
Final answer: the summary, the number of traits, and open questions.`,
      schema: { type: "object", properties: { summary: { type: "string" }, traits: { type: "integer" }, openQuestions: { type: "array", items: { type: "string" } } }, required: ["summary", "traits"] },
    });
    await ensureJson(ctx, ["research/style-dna.json"], "style DNA");
    await setStage(ctx, "dna");
    return out;
  },

  async directions(ctx) {
    const out = await claude(ctx, {
      prompt: `STEP: brand directions. Read ${REFS}/directions.md and ${REFS}/brand-schema.md and follow them exactly.
Inputs: brands/${ctx.slug}/kit.state.json (brief + traitChoices: adopt/skip per trait id), brands/${ctx.slug}/research/style-dna.json (and style-dna.md), brands/${ctx.slug}/research/dossier.md.
${ctx.opts.note ? `The person adds: ${ctx.opts.note}\n` : ""}Write brands/${ctx.slug}/directions/A/brand.json, B/brand.json, C/brand.json and brands/${ctx.slug}/directions/directions.json.`,
      schema: { type: "object", properties: { directions: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, summary: { type: "string" } }, required: ["id", "label"] } } }, required: ["directions"] },
    });
    await ensureJson(ctx, ["directions/A/brand.json", "directions/B/brand.json", "directions/C/brand.json", "directions/directions.json"], "directions");
    ctx.log("→ rendering boards");
    let boards = await renderBoards(ctx, ["A", "B", "C"]);
    const errs = errorsOf(boards);
    if (errs.length) {
      ctx.log(`⚠ ${errs.length} issue(s) — asking Claude to fix: ${errs.join("; ")}`);
      await claude(ctx, {
        prompt: `STEP: fix brand directions. The board renderer reported these errors:\n${errs.map((e) => `- ${e}`).join("\n")}\nFix them in brands/${ctx.slug}/directions/*/brand.json (change only what is needed; for a missing font pick a real Google Fonts family of the same character).`,
        schema: { type: "object", properties: { fixed: { type: "array", items: { type: "string" } } }, required: ["fixed"] },
      });
      boards = await renderBoards(ctx, ["A", "B", "C"]);
    }
    await setStage(ctx, "directions");
    return { ...out, boards };
  },

  /** Re-render boards: opts.ids (default all), opts.compare. */
  async boards(ctx) {
    return renderBoards(ctx, ctx.opts.ids, { compare: ctx.opts.compare !== false });
  },

  /** Change one direction per instruction. opts: { id, instruction, asVariant } */
  async refine(ctx) {
    const { id, instruction, asVariant } = ctx.opts;
    if (!id || !instruction) throw new Error("refine needs id and instruction");
    let target = id;
    if (asVariant) {
      const dir = path.join(ctx.brandDir, "directions");
      const used = (await fsp.readdir(dir)).filter((d) => /^R\d+$/.test(d)).map((d) => +d.slice(1));
      target = `R${used.length ? Math.max(...used) + 1 : 1}`;
      await fsp.mkdir(path.join(dir, target), { recursive: true });
      const src = await readJson(path.join(dir, id, "brand.json"));
      src.direction = { ...(src.direction || {}), id: target, label: `${src.direction?.label || id} · refined`, basedOn: id };
      await fsp.writeFile(path.join(dir, target, "brand.json"), JSON.stringify(src, null, 2) + "\n");
    }
    const out = await claude(ctx, {
      prompt: `STEP: refine a brand direction. Read the "Refining" section of ${REFS}/directions.md and ${REFS}/brand-schema.md.
Edit only brands/${ctx.slug}/directions/${target}/brand.json. Change only what this request names, keep everything else identical:
"${instruction}"`,
      schema: { type: "object", properties: { changed: { type: "array", items: { type: "string" } }, note: { type: "string" } }, required: ["changed"] },
    });
    ctx.log("→ rendering board");
    const boards = await renderBoards(ctx, asVariant ? [id, target] : [target], { compare: Boolean(asVariant) });
    await setStage(ctx, "refine");
    return { ...out, target, boards };
  },

  async names(ctx) {
    return claude(ctx, {
      prompt: `STEP: name ideas. Read the brief in kit.state.json, research/style-dna.md, and the chosen direction (kit.state.json → chosenDirection; its brands/${ctx.slug}/directions/<id>/brand.json). Propose 8 brand names: short, easy to say in the brand's primary language, plausible as a TikTok/Instagram handle, not an existing big creator's name. ${ctx.opts.note || ""}
Do not write files.`,
      tools: ["Read", "Glob"],
      schema: { type: "object", properties: { names: { type: "array", items: { type: "object", properties: { name: { type: "string" }, handle: { type: "string" }, why: { type: "string" } }, required: ["name", "handle", "why"] } } }, required: ["names"] },
    });
  },

  /** Find top accounts in a niche. opts: { niche, platforms, region } */
  async discover(ctx) {
    const { niche, platforms = ["tiktok"], region = "" } = ctx.opts;
    if (!niche) throw new Error("discover needs a niche");
    return claude(ctx, {
      prompt: `STEP: discover reference accounts. Read the "Discovering top accounts" section of ${REFS}/sources.md.
Niche: ${niche}. Platforms: ${platforms.join(", ")}. ${region ? `Region/language: ${region}.` : ""}
Search the web (prefer sources from the last 12 months) and return 8–10 real, currently active accounts with exact handles. Mix 2–3 large accounts with 4–6 mid-size accounts that grew recently. Do not write files.`,
      tools: ["WebSearch", "WebFetch", "Read"],
      schema: { type: "object", properties: { candidates: { type: "array", items: { type: "object", properties: { platform: { type: "string" }, handle: { type: "string" }, name: { type: "string" }, followers: { type: "string" }, why: { type: "string" }, source: { type: "string" } }, required: ["platform", "handle", "why"] } } }, required: ["candidates"] },
    });
  },

  async sound(ctx) {
    const state = await readJson(path.join(ctx.brandDir, "kit.state.json"), {});
    const id = ctx.opts.id || state?.chosenDirection;
    if (!id) throw new Error("choose a direction first");
    const out = await claude(ctx, {
      prompt: `STEP: sonic identity. Read ${REFS}/sound.md. Evidence: the "sound" rows and tracks in brands/${ctx.slug}/research/dossier.md and style-dna.json.
Update only the "sound" object (set enabled: true) in brands/${ctx.slug}/directions/${id}/brand.json. Do not download or generate audio.`,
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    });
    await setStage(ctx, "sound");
    return out;
  },

  async build(ctx) {
    const state = await readJson(path.join(ctx.brandDir, "kit.state.json"), {});
    const id = ctx.opts.id || state?.chosenDirection;
    if (!id) throw new Error("choose a direction first");
    const args = ["--brand", path.join("brands", ctx.slug), "--from", path.join("brands", ctx.slug, "directions", id, "brand.json")];
    if (ctx.opts.footage) args.push("--footage", ctx.opts.footage);
    const r = await runScript(ctx, "build-kit", args);
    await setStage(ctx, "done");
    return r;
  },
};
