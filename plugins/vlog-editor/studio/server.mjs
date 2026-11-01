#!/usr/bin/env node
// vlog-editor studio — a localhost web UI over the engine. Zero dependencies (Node 22+).
//
//   node plugins/vlog-editor/studio/server.mjs [--port 4317] [--workspace .] [--open]
//
// Binds to 127.0.0.1 only. Mutating requests must carry `X-Studio: 1` (blocks cross-site form posts).
// Reads and writes the same brands/ and videos/ folders as the Claude Code skills.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { STEPS, PLUGIN_ROOT } from "./lib/steps.mjs";
import { withDefaults } from "../scripts/lib/brand.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
    return acc;
  }, []),
);
const PORT = Number(args.port || process.env.STUDIO_PORT || 4317);
const WS = path.resolve(args.workspace || process.cwd());
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const BRANDS = path.join(WS, "brands");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".woff2": "font/woff2", ".wav": "audio/wav", ".mp3": "audio/mpeg" };

const exists = (p) => fsp.access(p).then(() => true, () => false);
const readJson = async (p, fb = null) => {
  try {
    return JSON.parse(await fsp.readFile(p, "utf8"));
  } catch {
    return fb;
  }
};
const writeJson = async (p, d) => {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, JSON.stringify(d, null, 2) + "\n");
};
const slugify = (s) => String(s).normalize("NFKD").replace(/ı/g, "i").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** Workspace-relative URL for a file, with an mtime cache-buster; null when missing. */
async function fileRef(abs) {
  try {
    const st = await fsp.stat(abs);
    return `/files/${path.relative(WS, abs).split(path.sep).map(encodeURIComponent).join("/")}?v=${Math.round(st.mtimeMs)}`;
  } catch {
    return null;
  }
}

// ---------------- jobs ----------------
const jobs = new Map();
const running = new Map(); // slug → jobId

function startJob(slug, step, opts) {
  if (!STEPS[step]) throw Object.assign(new Error(`unknown step ${step}`), { status: 404 });
  if (running.has(slug)) throw Object.assign(new Error(`a job is already running for ${slug}`), { status: 409, job: running.get(slug) });
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const job = { id, slug, step, opts, status: "running", logs: [], result: null, error: null, startedAt: new Date().toISOString(), endedAt: null, subs: new Set(), children: new Set() };
  jobs.set(id, job);
  running.set(slug, id);
  const send = (event, data) => {
    for (const res of job.subs) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const log = (line) => {
    const entry = { t: Date.now(), line: String(line) };
    job.logs.push(entry);
    if (job.logs.length > 3000) job.logs.shift();
    send("log", entry);
  };
  const ctx = { slug, step, opts: opts || {}, ws: WS, brandDir: path.join(BRANDS, slug), log, onSpawn: (c) => (job.children.add(c), c.on("close", () => job.children.delete(c))) };
  log(`▶ ${step}`);
  STEPS[step](ctx)
    .then((result) => {
      job.status = "done";
      job.result = result;
      log(`✓ ${step} finished`);
    })
    .catch((e) => {
      job.status = job.status === "cancelled" ? "cancelled" : "error";
      job.error = e.message;
      log(`✗ ${e.message}`);
    })
    .finally(async () => {
      job.endedAt = new Date().toISOString();
      running.delete(slug);
      send("done", publicJob(job));
      for (const res of job.subs) res.end();
      job.subs.clear();
      const { subs, children, ...persist } = job;
      await writeJson(path.join(BRANDS, slug, ".studio", "jobs", `${id}.json`), persist).catch(() => {});
    });
  return job;
}

const publicJob = (j) => ({ id: j.id, slug: j.slug, step: j.step, opts: j.opts, status: j.status, result: j.result, error: j.error, startedAt: j.startedAt, endedAt: j.endedAt, logCount: j.logs.length });

// ---------------- brand summaries ----------------
async function listBrands() {
  const dirs = await fsp.readdir(BRANDS, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const dir = path.join(BRANDS, d.name);
    const state = await readJson(path.join(dir, "kit.state.json"));
    const brand = await readJson(path.join(dir, "brand.json"));
    if (!state && !brand) continue;
    out.push({ slug: d.name, name: brand?.name || state?.brief?.name || d.name, stage: state?.stage || (brand ? "done" : "brief"), avatar: await fileRef(path.join(dir, "logo", "avatar.png")), running: running.get(d.name) || null });
  }
  return out;
}

async function brandDetail(slug) {
  const dir = path.join(BRANDS, slug);
  if (!(await exists(dir))) return null;
  const r = (p) => path.join(dir, p);
  const state = await readJson(r("kit.state.json"), {});
  const sources = await readJson(r("research/sources.json"));
  const manifest = await readJson(r("research/manifest.json"));
  const dossierFull = await readJson(r("research/dossier.json"));
  let dossier = null;
  if (dossierFull) {
    const pics = {};
    for (const [k, p] of Object.entries(dossierFull.pictures || {})) pics[k] = await fileRef(r(p));
    const items = [];
    for (const it of dossierFull.items || []) {
      items.push({
        key: it.key,
        handle: it.handle,
        role: it.role,
        url: it.url,
        type: it.type,
        likes: it.metrics?.likes ?? null,
        views: it.metrics?.views ?? null,
        title: (it.metrics?.title || "").slice(0, 120),
        duration: it.probe?.duration ?? null,
        medianShot: it.pace?.medianShot ?? null,
        firstCut: it.pace?.firstCut ?? null,
        sound: it.sound?.kind ?? null,
        lufs: it.sound?.lufs ?? null,
        hookText: it.transcript?.hookText || "",
        thumb: it.sheets?.thumb ? await fileRef(r(it.sheets.thumb)) : null,
        hook: it.sheets?.hook ? await fileRef(r(it.sheets.hook)) : null,
        overview: it.sheets?.overview ? await fileRef(r(it.sheets.overview)) : null,
        errors: it.errors || [],
      });
    }
    dossier = { generatedAt: dossierFull.generatedAt, groups: dossierFull.groups, sources: (dossierFull.sources || []).map(({ stats, ...s }) => ({ ...s, stats: stats ? { videos: stats.videos, likes: stats.engagement?.likes, views: stats.engagement?.views, medianShot: stats.pace?.medianShot } : null })), pictures: pics, items };
  }
  const dna = await readJson(r("research/style-dna.json"));
  const dnaMd = await fsp.readFile(r("research/style-dna.md"), "utf8").catch(() => null);
  const directions = [];
  for (const d of (await fsp.readdir(r("directions")).catch(() => [])).filter((x) => /^[A-Z][0-9]*$/.test(x)).sort()) {
    const brand = await readJson(r(`directions/${d}/brand.json`));
    if (brand) {
      const { derived, ...resolved } = withDefaults(structuredClone(brand));
      directions.push({ id: d, brand, resolved, board: await fileRef(r(`directions/${d}/board.png`)) });
    }
  }
  const comparePics = {};
  for (const f of (await fsp.readdir(r("directions")).catch(() => [])).filter((x) => /^compare.*\.png$/.test(x))) comparePics[f] = await fileRef(r(`directions/${f}`));
  const kit = await readJson(r("kit.json"));
  const files = {
    board: await fileRef(r("preview/board.png")),
    sizzle: await fileRef(r("preview/sizzle.mp4")),
    avatar: await fileRef(r("logo/avatar.png")),
    wordmark: await fileRef(r("logo/wordmark.png")),
    design: await fileRef(r("DESIGN.md")),
  };
  const recent = [];
  for (const f of (await fsp.readdir(r(".studio/jobs")).catch(() => [])).sort().slice(-12)) {
    const j = await readJson(r(`.studio/jobs/${f}`));
    if (j) recent.push({ id: j.id, step: j.step, status: j.status, error: j.error, startedAt: j.startedAt, endedAt: j.endedAt });
  }
  const inbox = (await fsp.readdir(r("research/inbox")).catch(() => [])).filter((f) => !f.startsWith("."));
  return { slug, state, sources, manifest: manifest ? { sources: manifest.sources, items: manifest.items?.length || 0, generatedAt: manifest.generatedAt } : null, dossier, dna, dnaMd, directions, directionsMeta: await readJson(r("directions/directions.json")), compare: comparePics, kit, files, recentJobs: recent.reverse(), running: running.get(slug) ? publicJob(jobs.get(running.get(slug))) : null, inbox };
}

// ---------------- http ----------------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, { "Content-Type": isJson ? MIME[".json"] : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function body(req, limit = 2e6) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(c);
  }
  const s = Buffer.concat(chunks).toString("utf8");
  return s ? JSON.parse(s) : {};
}

async function serveFile(req, res, abs, root) {
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return send(res, 403, "forbidden");
  let st;
  try {
    st = await fsp.stat(resolved);
  } catch {
    return send(res, 404, "not found");
  }
  if (!st.isFile()) return send(res, 404, "not found");
  const type = MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? +range[1] : 0;
    const end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    return fs.createReadStream(resolved, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": root === PUBLIC ? "no-cache" : "private, max-age=3600" });
  fs.createReadStream(resolved).pipe(res);
}

const which = (bin) => spawnSync("sh", ["-c", `command -v "${bin}"`]).status === 0;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  try {
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-studio"] !== "1") return send(res, 403, { error: "missing X-Studio header" });

    // static UI
    if (p === "/favicon.ico") return send(res, 204, "");
    if (p === "/" || p === "/index.html") return serveFile(req, res, path.join(PUBLIC, "index.html"), PUBLIC);
    if (p.startsWith("/static/")) return serveFile(req, res, path.join(PUBLIC, p.slice(8)), PUBLIC);
    if (p.startsWith("/files/")) return serveFile(req, res, path.join(WS, p.slice(7)), WS);

    // api
    if (p === "/api/health")
      return send(res, 200, { workspace: WS, plugin: PLUGIN_ROOT, tools: { claude: which("claude"), ytdlp: which("yt-dlp"), ffmpeg: which("ffmpeg"), node: process.version } });
    if (p === "/api/brands" && req.method === "GET") return send(res, 200, { brands: await listBrands() });
    if (p === "/api/brands" && req.method === "POST") {
      const { name } = await body(req);
      const slug = slugify(name || "");
      if (!SLUG_RE.test(slug)) return send(res, 400, { error: "give the brand a name (letters or numbers)" });
      const dir = path.join(BRANDS, slug);
      if (await exists(path.join(dir, "kit.state.json"))) return send(res, 409, { error: `brands/${slug} already exists`, slug });
      await writeJson(path.join(dir, "kit.state.json"), { schema: "vlog-editor/kit-state@1", slug, stage: "brief", brief: { name: name.trim(), startingPoints: [], platforms: ["tiktok", "instagram"], languages: ["en"], niche: "", audience: "", personality: { energy: 0.6, polish: 0.5, warmth: 0.5, playfulness: 0.5 }, mustHave: "", avoid: "", sound: false }, traitChoices: {}, chosenDirection: null, history: [{ at: new Date().toISOString(), stage: "brief" }] });
      return send(res, 201, { slug });
    }
    let m;
    if ((m = p.match(/^\/api\/brands\/([a-z0-9-]+)$/)) && req.method === "GET") {
      const d = await brandDetail(m[1]);
      return d ? send(res, 200, d) : send(res, 404, { error: "no such brand" });
    }
    if ((m = p.match(/^\/api\/brands\/([a-z0-9-]+)\/state$/)) && req.method === "PUT") {
      const f = path.join(BRANDS, m[1], "kit.state.json");
      const cur = await readJson(f);
      if (!cur) return send(res, 404, { error: "no such brand" });
      const patch = await body(req);
      const next = { ...cur, ...patch, brief: { ...cur.brief, ...(patch.brief || {}) }, traitChoices: patch.traitChoices ? { ...cur.traitChoices, ...patch.traitChoices } : cur.traitChoices };
      await writeJson(f, next);
      return send(res, 200, next);
    }
    if ((m = p.match(/^\/api\/brands\/([a-z0-9-]+)\/sources$/)) && req.method === "PUT") {
      const data = await body(req);
      if (!Array.isArray(data.sources)) return send(res, 400, { error: "sources must be an array" });
      await writeJson(path.join(BRANDS, m[1], "research", "sources.json"), data);
      return send(res, 200, data);
    }
    if ((m = p.match(/^\/api\/brands\/([a-z0-9-]+)\/directions\/([A-Z][0-9]*)$/)) && req.method === "PUT") {
      const data = await body(req);
      await writeJson(path.join(BRANDS, m[1], "directions", m[2], "brand.json"), data);
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/brands\/([a-z0-9-]+)\/upload$/)) && req.method === "POST") {
      const name = path.basename(url.searchParams.get("name") || "").replace(/[^\w.\- ]+/g, "_");
      if (!name || !/\.(mp4|mov|m4v|webm|jpg|jpeg|png|webp)$/i.test(name)) return send(res, 400, { error: "videos or images only" });
      const dir = path.join(BRANDS, m[1], "research", "inbox");
      await fsp.mkdir(dir, { recursive: true });
      await new Promise((resolve, reject) => req.pipe(fs.createWriteStream(path.join(dir, name))).on("finish", resolve).on("error", reject));
      return send(res, 201, { file: `research/inbox/${name}` });
    }
    if ((m = p.match(/^\/api\/brands\/([a-z0-9-]+)\/run\/([a-z-]+)$/)) && req.method === "POST") {
      if (!(await exists(path.join(BRANDS, m[1])))) return send(res, 404, { error: "no such brand" });
      const opts = await body(req);
      try {
        return send(res, 202, publicJob(startJob(m[1], m[2], opts)));
      } catch (e) {
        return send(res, e.status || 500, { error: e.message, job: e.job || null });
      }
    }
    if ((m = p.match(/^\/api\/jobs\/([\w-]+)$/))) {
      const j = jobs.get(m[1]);
      return j ? send(res, 200, { ...publicJob(j), logs: j.logs }) : send(res, 404, { error: "no such job" });
    }
    if ((m = p.match(/^\/api\/jobs\/([\w-]+)\/cancel$/)) && req.method === "POST") {
      const j = jobs.get(m[1]);
      if (!j) return send(res, 404, { error: "no such job" });
      j.status = "cancelled";
      for (const c of j.children) c.kill("SIGTERM");
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/jobs\/([\w-]+)\/events$/))) {
      const j = jobs.get(m[1]);
      if (!j) return send(res, 404, { error: "no such job" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      for (const entry of j.logs) res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
      if (j.status !== "running") {
        res.write(`event: done\ndata: ${JSON.stringify(publicJob(j))}\n\n`);
        return res.end();
      }
      j.subs.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => {
        clearInterval(ping);
        j.subs.delete(res);
      });
      return;
    }
    if (p === "/api/open" && req.method === "POST") {
      const { file } = await body(req);
      const abs = path.resolve(WS, file || ".");
      if (abs !== WS && !abs.startsWith(WS + path.sep)) return send(res, 403, { error: "outside workspace" });
      spawn(process.platform === "darwin" ? "open" : "xdg-open", [abs], { detached: true, stdio: "ignore" }).unref();
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`vlog-editor studio → ${url}\nworkspace: ${WS}`);
  if (args.open) spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
});
