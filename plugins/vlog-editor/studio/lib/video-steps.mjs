// Studio steps for videos. Engine work runs scripts/video.mjs; edits by conversation run Claude Code headless
// in ONE persistent session per video (first turn creates it, later turns --resume it), so Claude remembers
// what it already changed. Every Claude turn is preceded by an undo snapshot and followed by check + frames.
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { runClaude } from "./claude.mjs";
import { runScript, PLUGIN_ROOT } from "./steps.mjs";
import { loadVideo, saveVideo, snapshotVersion, checkAndFrames } from "../../scripts/video.mjs";
import { runHf, parseJsonLoose } from "../../scripts/lib/util.mjs";

const SCRIPTS = path.join(PLUGIN_ROOT, "scripts");
export const previews = new Map(); // slug → { url, port }

const rel = (ctx) => path.join("videos", ctx.slug);

function chatTools() {
  return ["Read", "Write", "Edit", "Glob", "Grep", "Skill", "Bash(npx hyperframes:*)", `Bash(node ${SCRIPTS}/video.mjs:*)`, "Bash(ffprobe:*)"];
}

function firstTurnPrompt(ctx, request) {
  const p = rel(ctx);
  return `You are the video editor inside the vlog-editor studio, working with the person on one short-form vertical video (TikTok / Instagram Reels, 1080×1920). They talk to you from a chat box next to the preview.

Project: ${p}/ — a HyperFrames project whose root composition is ${p}/index.html. Use the /hyperframes skill before editing compositions; it holds the render contract.
Brand: ${p}/DESIGN.md is the binding brand spec. Brand components live in ${p}/compositions/brand/: brand-hook, brand-recipe-card (data in RECIPE between the @recipe markers), brand-captions (WORDS between the @words markers), brand-lower-third, brand-end-card.
Structured source: ${p}/video.json — clips (role main|face|broll, in, out, focusX 0–1 for the vertical crop), hook {text, emphasis}, recipe, blendAt (s, when the recipe card shows), faceSeconds, maxSeconds, lowerThird {title, subtitle, at}, captions [{text, start, end}] (on-screen text beats), endCard {cta, seconds}.
  To change any of those, edit video.json and then run: node ${SCRIPTS}/video.mjs draft --project ${p} --force
  (it regenerates index.html and the component data from video.json).
  For anything the fields cannot express (extra overlays, motion, layout, effects, b-roll placement), edit index.html or the compositions directly instead; the studio then marks the video hand-edited.
To see the footage: contact sheets ${p}/.vlog/sheets/<clip-id>.jpg (one frame every video.json clips[].sheetEvery seconds).
After every change: npx hyperframes check ${p}  — fix every error. When the change is visual, look at it: npx hyperframes snapshot ${p} --at <seconds> --no-end, then Read the PNG it reports.
Rules: never render (the person renders from the studio); never touch files outside ${p}/; pass the project path as an argument instead of using cd; keep the brand's rules from DESIGN.md.
Reply in one to three short sentences: what you changed and what to look at.

The person's request: ${request}`;
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export const VIDEO_STEPS = {
  async ingest(ctx) {
    return runScript(ctx, "video", ["ingest", "--project", rel(ctx), ...(ctx.opts.force ? ["--force"] : [])]);
  },

  /** Ingest when needed, then regenerate index.html from video.json, then check + frames. */
  async draft(ctx) {
    await runScript(ctx, "video", ["ingest", "--project", rel(ctx)]);
    return runScript(ctx, "video", ["draft", "--project", rel(ctx), ...(ctx.opts.force ? ["--force"] : [])]);
  },

  async check(ctx) {
    return runScript(ctx, "video", ["check", "--project", rel(ctx)]);
  },

  async render(ctx) {
    return runScript(ctx, "video", ["render", "--project", rel(ctx)]);
  },

  async undo(ctx) {
    const r = await runScript(ctx, "video", ["undo", "--project", rel(ctx)]);
    await runScript(ctx, "video", ["check", "--project", rel(ctx)]);
    return r;
  },

  /** One conversational edit. opts: { message } */
  async chat(ctx) {
    const message = String(ctx.opts.message || "").trim();
    if (!message) throw new Error("empty message");
    const dir = path.join(ctx.ws, rel(ctx));
    let v = await loadVideo(dir);
    await snapshotVersion(dir, `chat: ${message.slice(0, 80)}`);
    v.chat = [...(v.chat || []), { role: "user", text: message, at: new Date().toISOString() }];
    await saveVideo(dir, v);
    const base = { cwd: ctx.ws, tools: chatTools(), addDirs: [PLUGIN_ROOT], log: ctx.log, onSpawn: ctx.onSpawn };
    ctx.log("🤖 Claude is editing the video…");
    let r;
    if (v.claude?.session) {
      r = await runClaude({ ...base, prompt: `(Same video: ${rel(ctx)}/.) ${message}`, resume: v.claude.session });
      if (!r.ok && /session|conversation|not found/i.test(r.error || "")) {
        ctx.log("   previous session unavailable — starting a new one");
        v.claude.session = null;
      }
    }
    if (!v.claude?.session) {
      const id = crypto.randomUUID();
      r = await runClaude({ ...base, prompt: firstTurnPrompt(ctx, message), sessionId: id });
      if (r.ok) r.session = r.session || id;
    }
    v = await loadVideo(dir); // Claude may have edited video.json
    v.claude = { ...(v.claude || {}), session: r.session || v.claude?.session || null };
    v.chat = [...(v.chat || []), { role: "assistant", text: r.ok ? r.text || "Done." : `Something went wrong: ${r.error}`, at: new Date().toISOString(), turns: r.turns ?? null, ok: r.ok }];
    await saveVideo(dir, v);
    ctx.log("→ checking and capturing frames");
    const check = await checkAndFrames(dir);
    if (!r.ok) throw new Error(r.error || "Claude could not finish");
    return { reply: r.text, check };
  },

  /** Start HyperFrames' own Studio (live preview + timeline editing) for this project. */
  async preview(ctx) {
    const dir = path.join(ctx.ws, rel(ctx));
    const cur = previews.get(ctx.slug);
    if (cur) {
      const st = await runHf(["preview", dir, "--status", "--json"], { cwd: dir, timeoutMs: 30000, workspace: dir });
      if (/running|listening|"ok":\s*true/i.test(st.stdout)) return cur;
    }
    const port = await freePort();
    ctx.log(`→ starting the HyperFrames Studio on port ${port}`);
    const r = await runHf(["preview", dir, "--background", "--no-open", "--port", String(port), "--json"], { cwd: dir, timeoutMs: 120000, workspace: dir });
    const j = parseJsonLoose(r.stdout) || {};
    const url = j.url || j.studioUrl || (r.stdout.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+[^\s"']*/) || [])[0] || `http://localhost:${port}`;
    const info = { url, port };
    previews.set(ctx.slug, info);
    return info;
  },

  async "stop-preview"(ctx) {
    const dir = path.join(ctx.ws, rel(ctx));
    await runHf(["preview", dir, "--stop"], { cwd: dir, timeoutMs: 30000, workspace: dir });
    previews.delete(ctx.slug);
    return { stopped: true };
  },
};
