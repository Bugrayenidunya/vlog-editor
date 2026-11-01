#!/usr/bin/env node
// Collect reference media for a brand: accounts (ranked by likes), single URLs, and local files.
//
//   node collect.mjs --brand brands/<slug> [--sources <file>] [--dry-run] [--only <sourceKey>]
//
// Reads <brand>/research/sources.json:
// {
//   "cookiesFromBrowser": null,            // e.g. "chrome" — ONLY with the person's explicit consent
//   "defaults": { "top": 8, "scan": 60, "sinceDays": 365, "maxDuration": 180, "rankBy": "likes" },
//   "sources": [
//     { "kind": "account", "platform": "tiktok",  "handle": "@name", "role": "reference" },
//     { "kind": "account", "platform": "youtube", "handle": "@name", "role": "reference", "top": 5 },
//     { "kind": "urls",  "role": "self", "urls": ["https://www.instagram.com/reel/..."] },
//     { "kind": "files", "role": "self", "path": "research/inbox" }
//   ]
// }
// role: "self" (the person's own account) | "reference" (accounts they admire) | "discovered" (found by niche search)
//
// Writes media under <brand>/research/media/<sourceKey>/ and <brand>/research/manifest.json.
// Prints a JSON summary on stdout. Safe to re-run: existing downloads are reused.
import fsp from "node:fs/promises";
import path from "node:path";
import { parseArgs, log, die, exists, which, readJson, writeJson, ensureDir, run, pool, slugify, parseJsonLoose } from "./lib/util.mjs";

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const FORMAT = "bv*[vcodec^=h264]+ba/b[vcodec^=h264]/bv*+ba/b";

const args = parseArgs();
if (!args.brand) die("usage: collect.mjs --brand brands/<slug> [--sources file] [--dry-run] [--only key]");
const brandDir = path.resolve(args.brand);
const researchDir = path.join(brandDir, "research");
const sourcesFile = path.resolve(args.sources || path.join(researchDir, "sources.json"));
if (!exists(sourcesFile)) die(`no sources file at ${sourcesFile}`);

const config = await readJson(sourcesFile);
const defaults = { top: 8, scan: 60, sinceDays: 365, maxDuration: 180, rankBy: "likes", ...(config.defaults || {}) };
const cookies = config.cookiesFromBrowser || null;
const dryRun = Boolean(args["dry-run"]);
const needsYtDlp = (config.sources || []).some((s) => s.kind !== "files");
if (needsYtDlp && !which("yt-dlp")) die("yt-dlp is not installed (macOS: brew install yt-dlp; else: pipx install yt-dlp)");

function platformOf(url) {
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return "web";
}

function cleanHandle(h) {
  return String(h || "").trim().replace(/^https?:\/\/[^/]+\//, "").replace(/^@/, "").replace(/\/.*$/, "");
}

function sourceKey(s, i) {
  if (s.key) return slugify(s.key);
  if (s.kind === "account") return `${s.platform}-${slugify(cleanHandle(s.handle))}`;
  if (s.kind === "files") return `files-${slugify(path.basename(s.path || "inbox"))}`;
  return `urls-${s.role || "reference"}-${i}`;
}

function accountUrl(platform, handle) {
  const h = cleanHandle(handle);
  if (platform === "tiktok") return `https://www.tiktok.com/@${h}`;
  if (platform === "youtube") return `https://www.youtube.com/@${h}/shorts`;
  return null;
}

function metricsOf(e) {
  const ts = e.timestamp ?? (e.upload_date ? Date.UTC(+e.upload_date.slice(0, 4), +e.upload_date.slice(4, 6) - 1, +e.upload_date.slice(6, 8)) / 1000 : null);
  const m = {
    views: e.view_count ?? null,
    likes: e.like_count ?? null,
    comments: e.comment_count ?? null,
    shares: e.repost_count ?? null,
    saves: e.save_count ?? null,
    duration: e.duration ?? null,
    timestamp: ts,
    title: e.title ?? null,
    description: e.description ?? null,
    track: e.track ?? null,
    artists: e.artists ?? (e.artist ? [e.artist] : null),
    followers: e.channel_follower_count ?? null,
  };
  const inter = [m.likes, m.comments, m.shares, m.saves].filter((x) => typeof x === "number");
  m.engagementRate = m.views && inter.length ? +(inter.reduce((a, b) => a + b, 0) / m.views).toFixed(4) : null;
  return m;
}

function cookieArgs() {
  return cookies ? ["--cookies-from-browser", cookies] : [];
}

function explainYtDlpError(stderr, platform) {
  const s = stderr || "";
  if (/Unsupported URL/i.test(s) && platform === "instagram")
    return { code: "instagram_listing_unsupported", hint: "Instagram profiles can't be listed by yt-dlp. Collect reel URLs (browser or paste) and add them as a 'urls' source." };
  if (/login|cookies|empty media response|rate-limit|private/i.test(s))
    return { code: "needs_login", hint: "The platform refused without a login. Ask the person before using cookiesFromBrowser, or have them paste URLs / drop files." };
  if (/not found|404|does not exist|Unable to extract/i.test(s)) return { code: "not_found", hint: "Check the handle or URL." };
  return { code: "fetch_failed", hint: s.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300) };
}

async function listAccount(src) {
  const url = accountUrl(src.platform, src.handle);
  if (!url) {
    return { error: explainYtDlpError("Unsupported URL", src.platform), entries: [] };
  }
  const scan = src.scan ?? defaults.scan;
  const r = await run("yt-dlp", ["--flat-playlist", "--playlist-end", String(scan), "--socket-timeout", "30", "-J", ...cookieArgs(), url], { timeoutMs: 240000 });
  const data = r.code === 0 ? parseJsonLoose(r.stdout) : null;
  if (!data) return { error: explainYtDlpError(r.stderr, src.platform), entries: [], url };
  const entries = (data.entries || []).map((e) => ({
    id: String(e.id),
    url: e.url && /^https?:/.test(e.url) ? e.url : e.webpage_url || (src.platform === "youtube" ? `https://www.youtube.com/shorts/${e.id}` : `${url}/video/${e.id}`),
    metrics: metricsOf(e),
  }));
  return { entries, url, channel: data.channel || data.uploader || null, followers: data.channel_follower_count ?? null };
}

function rankAndPick(entries, src) {
  const top = src.top ?? defaults.top;
  const sinceDays = src.sinceDays ?? defaults.sinceDays;
  const maxDuration = src.maxDuration ?? defaults.maxDuration;
  const rankBy = src.rankBy ?? defaults.rankBy;
  const cutoff = sinceDays ? Date.now() / 1000 - sinceDays * 86400 : null;
  const score = (e) => {
    const m = e.metrics;
    if (rankBy === "engagement") return m.engagementRate ?? -1;
    if (rankBy === "views") return m.views ?? -1;
    return m.likes ?? m.views ?? -1; // youtube flat listings carry views only
  };
  const usable = entries.filter((e) => !e.metrics.duration || e.metrics.duration <= maxDuration);
  const recent = usable.filter((e) => !cutoff || !e.metrics.timestamp || e.metrics.timestamp >= cutoff);
  const pool_ = recent.length >= Math.min(top, usable.length) ? recent : usable;
  const ranked = [...pool_].sort((a, b) => score(b) - score(a));
  return {
    picked: ranked.slice(0, top),
    note: pool_ === usable && recent.length < usable.length ? `fewer than ${top} posts in the last ${sinceDays} days; older posts included` : null,
    rankedBy: rankBy === "likes" && entries.every((e) => e.metrics.likes == null) ? "views" : rankBy,
  };
}

async function download(entry, dir) {
  const existing = (await fsp.readdir(dir).catch(() => [])).find((f) => f.startsWith(entry.id + ".") && VIDEO_EXT.has(path.extname(f)));
  if (existing) return { file: path.join(dir, existing), cached: true };
  const cachedPhoto = (await fsp.readdir(dir).catch(() => [])).find((f) => f.startsWith(entry.id + ".") && IMAGE_EXT.has(path.extname(f).toLowerCase()));
  if (cachedPhoto) return downloadPhotoPost(entry, dir);
  const r = await run(
    "yt-dlp",
    ["--no-playlist", "--no-progress", "--socket-timeout", "30", "-f", FORMAT, "-S", "res:1080", "--merge-output-format", "mp4", "--write-info-json", "-o", path.join(dir, "%(id)s.%(ext)s"), ...cookieArgs(), entry.url],
    { timeoutMs: 300000 },
  );
  const file = (await fsp.readdir(dir).catch(() => [])).find((f) => f.startsWith(entry.id + ".") && VIDEO_EXT.has(path.extname(f)));
  if (r.code === 0 && file) return { file: path.join(dir, file) };
  // Photo/slideshow posts: the format chain falls through to the audio track, or yt-dlp says no video format.
  const audioOnly = (await fsp.readdir(dir).catch(() => [])).some((f) => f.startsWith(entry.id + ".") && /\.(m4a|mp3|aac|ogg|opus)$/i.test(f));
  if (audioOnly || /format is not available|No video formats/i.test(r.stderr)) {
    const photo = await downloadPhotoPost(entry, dir);
    if (photo) return photo;
  }
  return { error: explainYtDlpError(r.stderr, platformOf(entry.url)) };
}

/** TikTok photo/slideshow posts have no video stream: keep the cover image and the sound. */
async function downloadPhotoPost(entry, dir) {
  const find = async (exts) => (await fsp.readdir(dir).catch(() => [])).find((f) => f.startsWith(entry.id + ".") && exts.has(path.extname(f).toLowerCase()));
  const AUDIO_EXT = new Set([".m4a", ".mp3", ".aac", ".ogg", ".opus"]);
  if (!(await find(IMAGE_EXT)) || !(await find(AUDIO_EXT))) {
    await run(
      "yt-dlp",
      ["--no-playlist", "--no-progress", "--socket-timeout", "30", "-f", "bestaudio/audio", "--write-info-json", "--write-thumbnail", "--convert-thumbnails", "jpg", "-o", path.join(dir, "%(id)s.%(ext)s"), ...cookieArgs(), entry.url],
      { timeoutMs: 300000 },
    );
  }
  const image = await find(IMAGE_EXT);
  const audio = await find(AUDIO_EXT);
  if (!image) return null;
  return { file: path.join(dir, image), audio: audio ? path.join(dir, audio) : null, type: "photo" };
}

async function enrichFromInfo(file, metrics) {
  const info = await readJson(file.replace(/\.[^.]+$/, ".info.json"), null);
  if (!info) return metrics;
  const full = metricsOf(info);
  for (const [k, v] of Object.entries(full)) if (metrics[k] == null && v != null) metrics[k] = v;
  return metrics;
}

async function listFiles(dir) {
  const out = [];
  async function walk(d) {
    for (const ent of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else {
        const ext = path.extname(ent.name).toLowerCase();
        if (VIDEO_EXT.has(ext)) out.push({ file: p, type: "video" });
        else if (IMAGE_EXT.has(ext)) out.push({ file: p, type: "image" });
      }
    }
  }
  await walk(dir);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const rel = (p) => path.relative(brandDir, p);
const prev = await readJson(path.join(researchDir, "manifest.json"), { items: [], sources: [] });
const sourcesOut = [];
const items = [];

for (const [i, src] of (config.sources || []).entries()) {
  const key = sourceKey(src, i);
  if (args.only && args.only !== key) {
    sourcesOut.push(...prev.sources.filter((s) => s.key === key));
    items.push(...prev.items.filter((it) => it.sourceKey === key));
    continue;
  }
  const role = src.role || "reference";
  const mediaDir = path.join(researchDir, "media", key);
  const report = { key, kind: src.kind, platform: src.platform || null, handle: src.handle ? "@" + cleanHandle(src.handle) : null, role };
  log(`→ ${key}`);

  if (src.kind === "files") {
    const dir = path.resolve(brandDir, src.path || "research/inbox");
    const files = await listFiles(dir);
    report.found = files.length;
    if (!files.length) report.error = { code: "empty", hint: `no video or image files in ${rel(dir)}` };
    for (const f of files) {
      items.push({ key: `${key}/${slugify(path.basename(f.file))}`, sourceKey: key, role, platform: src.platform || "local", handle: report.handle, id: slugify(path.basename(f.file)), type: f.type, file: rel(f.file), url: null, metrics: {} });
    }
    sourcesOut.push(report);
    continue;
  }

  let picked = [];
  if (src.kind === "account") {
    const listing = await listAccount(src);
    report.url = listing.url || null;
    report.channel = listing.channel || null;
    report.followers = listing.followers ?? null;
    report.scanned = listing.entries.length;
    if (listing.error) {
      report.error = listing.error;
      sourcesOut.push(report);
      log(`  ✗ ${listing.error.code}: ${listing.error.hint}`);
      continue;
    }
    const r = rankAndPick(listing.entries, src);
    picked = r.picked;
    report.rankedBy = r.rankedBy;
    if (r.note) report.note = r.note;
  } else if (src.kind === "urls") {
    picked = (src.urls || []).map((u) => {
      const id = (u.match(/\/(?:video|reel|reels|shorts|p)\/([A-Za-z0-9_-]+)/) || [])[1] || slugify(u).slice(-24);
      return { id, url: u, metrics: {} };
    });
    report.scanned = picked.length;
  } else {
    report.error = { code: "bad_source", hint: `unknown kind "${src.kind}"` };
    sourcesOut.push(report);
    continue;
  }

  report.picked = picked.length;
  report.top = picked.slice(0, 5).map((e) => ({ id: e.id, likes: e.metrics.likes ?? null, views: e.metrics.views ?? null, title: (e.metrics.title || "").slice(0, 80) }));
  if (dryRun) {
    sourcesOut.push(report);
    continue;
  }

  await ensureDir(mediaDir);
  const results = await pool(picked, 3, async (e, rank) => {
    const d = await download(e, mediaDir);
    if (d.error) return { e, rank, error: d.error };
    const metrics = await enrichFromInfo(d.file, { ...e.metrics });
    return { e, rank, file: d.file, audio: d.audio || null, type: d.type || "video", metrics };
  });
  const failed = results.filter((r) => r.error);
  if (failed.length) report.failed = failed.map((r) => ({ id: r.e.id, url: r.e.url, ...r.error }));
  report.downloaded = results.length - failed.length;
  if (!report.followers) report.followers = results.find((r) => r.metrics?.followers)?.metrics.followers ?? null;
  for (const r of results.filter((x) => !x.error)) {
    items.push({ key: `${key}/${r.e.id}`, sourceKey: key, role, platform: src.platform || platformOf(r.e.url), handle: report.handle, id: r.e.id, type: r.type, file: rel(r.file), ...(r.audio ? { audio: rel(r.audio) } : {}), url: r.e.url, rank: r.rank + 1, metrics: r.metrics });
  }
  sourcesOut.push(report);
  const photos = results.filter((r) => r.type === "photo").length;
  if (photos) report.photoPosts = photos;
  log(`  ✓ ${report.downloaded}/${picked.length} downloaded${photos ? ` (${photos} photo posts: cover + sound)` : ""}${failed.length ? `, ${failed.length} failed (${failed[0].error.code})` : ""}`);
}

const manifest = { generatedAt: new Date().toISOString(), brandDir: rel(brandDir) || ".", dryRun, sources: sourcesOut, items: dryRun ? prev.items : items };
if (!dryRun) await writeJson(path.join(researchDir, "manifest.json"), manifest);
process.stdout.write(JSON.stringify({ ok: true, dryRun, manifest: dryRun ? null : rel(path.join(researchDir, "manifest.json")), sources: sourcesOut, items: manifest.items.length }, null, 2) + "\n");
