// Shared helpers for vlog-editor scripts. Zero dependencies: Node 22+, ffmpeg, yt-dlp, HyperFrames CLI.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** HyperFrames version these scripts were tested against. A workspace pin (node_modules) wins. */
export const HF_VERSION = "0.8.226";

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TEMPLATES = path.join(PLUGIN_ROOT, "templates");

/** --key value | --key=value | --flag ; repeated keys become arrays. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    let key = a.slice(2);
    let val = true;
    const eq = key.indexOf("=");
    if (eq >= 0) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      val = argv[++i];
    }
    if (key in out) out[key] = [].concat(out[key], val);
    else out[key] = val;
  }
  return out;
}

export function log(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

export function die(msg, code = 1) {
  log(`error: ${msg}`);
  process.exit(code);
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function which(bin) {
  const r = spawnSync("sh", ["-c", `command -v "${bin}"`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
  return p;
}

export async function readJson(p, fallback) {
  try {
    return JSON.parse(await fsp.readFile(p, "utf8"));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`cannot read JSON ${p}: ${e.message}`);
  }
}

export async function writeJson(p, data) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, JSON.stringify(data, null, 2) + "\n");
}

/** Run a command without a shell. Resolves {code, stdout, stderr}; rejects only on spawn failure. */
export function run(cmd, args, { cwd, timeoutMs = 0, env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        stderr += `\n[timeout after ${timeoutMs} ms]`;
        child.kill("SIGKILL");
      }, timeoutMs);
    }
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** Run and capture raw stdout bytes (for ffmpeg rawvideo pipes). */
export function runBuffer(cmd, args, { cwd, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    const chunks = [];
    let stderr = "";
    let timer = null;
    if (timeoutMs > 0) timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, buffer: Buffer.concat(chunks), stderr });
    });
  });
}

/** Locate the HyperFrames CLI: a node_modules pin above cwd or startDir, else npx at the tested version. */
let hfCached = null;
export function hfCommand(startDir) {
  if (hfCached) return hfCached;
  for (const start of [process.cwd(), startDir].filter(Boolean)) {
    let dir = path.resolve(start);
    for (;;) {
      const bin = path.join(dir, "node_modules", ".bin", "hyperframes");
      if (exists(bin)) return (hfCached = { cmd: bin, base: [] });
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return (hfCached = { cmd: "npx", base: ["--yes", `hyperframes@${HF_VERSION}`] });
}

/** Resolve (and for npx, install once) before parallel use: concurrent first-time npx runs race. */
export async function warmHf(startDir) {
  const { cmd, base } = hfCommand(startDir);
  const r = await run(cmd, [...base, "--version"], { timeoutMs: 300000 });
  if (r.code !== 0) throw new Error(`HyperFrames CLI unavailable: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
  return r.stdout.trim().split("\n").pop();
}

export async function runHf(args, opts = {}) {
  const { cmd, base } = hfCommand(opts.workspace);
  return run(cmd, [...base, ...args], opts);
}

/** Parse JSON from CLI stdout that may carry banner lines before/after the object. */
export function parseJsonLoose(text) {
  const t = String(text || "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const lines = t.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].trimStart()[0];
    if (c !== "{" && c !== "[") continue;
    const rest = lines.slice(i).join("\n");
    const close = c === "{" ? "}" : "]";
    for (let end = rest.lastIndexOf(close); end > 0; end = rest.lastIndexOf(close, end - 1)) {
      try {
        return JSON.parse(rest.slice(0, end + 1));
      } catch {}
    }
  }
  return null;
}

export function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/ı/g, "i")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Run fn over items with at most `limit` in flight. Keeps input order in the result. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function median(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function round(x, digits = 2) {
  if (typeof x !== "number" || !Number.isFinite(x)) return x ?? null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** WCAG relative luminance and contrast ratio. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Replace {{KEY}} placeholders. Unknown keys are left in place so they are easy to spot. */
export function fillTemplate(text, vars) {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export async function copyDir(src, dst) {
  await ensureDir(dst);
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}
