// Run Claude Code headless (`claude -p`) for a judgment step, streaming progress lines.
// Uses the person's own Claude Code login; tools are allow-listed per step; edits are auto-accepted
// only for the tools listed (no Bash).
import { spawn } from "node:child_process";

/**
 * @param {object} o
 * @param {string} o.prompt
 * @param {string} o.cwd            workspace root
 * @param {string[]} o.tools        allowed tools, e.g. ["Read","Write","Edit","Glob","Grep"]
 * @param {object} [o.schema]       JSON schema for the final structured answer
 * @param {string[]} [o.addDirs]    extra readable dirs (the plugin's references)
 * @param {(line:string)=>void} o.log
 * @param {(child)=>void} [o.onSpawn]
 * @returns {Promise<{ok:boolean, output:any, text:string, cost:number|null, turns:number|null, error?:string}>}
 */
export function runClaude({ prompt, cwd, tools, schema, addDirs = [], log, onSpawn, model, sessionId, resume }) {
  return new Promise((resolve) => {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowedTools", tools.join(",")];
    // A video keeps one Claude Code session: the first turn creates it, later turns resume it.
    if (resume) args.push("--resume", resume);
    else if (sessionId) args.push("--session-id", sessionId);
    else args.push("--no-session-persistence");
    if (schema) args.push("--json-schema", JSON.stringify(schema));
    for (const d of addDirs) args.push("--add-dir", d);
    if (model) args.push("--model", model);
    const child = spawn("claude", args, { cwd, env: { ...process.env } });
    onSpawn?.(child);
    let buf = "";
    let final = null;
    let sessionSeen = null;
    let stderr = "";
    const short = (s, n = 140) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
    const rel = (p) => String(p || "").replace(cwd + "/", "");
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.type === "assistant") {
          for (const c of e.message?.content || []) {
            if (c.type === "text" && c.text.trim()) log(`💬 ${short(c.text.trim().replace(/\s+/g, " "), 220)}`);
            if (c.type === "tool_use" && c.name !== "StructuredOutput") {
              const inp = c.input || {};
              const what = inp.file_path || inp.path || inp.pattern || inp.query || inp.url || inp.command || inp.skill || "";
              log(`🔧 ${c.name} ${short(rel(what), 120)}`);
            }
          }
        } else if (e.type === "result") final = e;
        else if (e.type === "system" && e.subtype === "init" && e.session_id) sessionSeen = e.session_id;
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ ok: false, output: null, text: "", cost: null, turns: null, error: `cannot start claude: ${err.message}` }));
    child.on("close", (code) => {
      if (!final) return resolve({ ok: false, output: null, text: "", cost: null, turns: null, error: `claude exited ${code}: ${stderr.trim().split("\n").slice(-3).join(" ")}` });
      resolve({
        ok: !final.is_error,
        output: final.structured_output ?? null,
        text: typeof final.result === "string" ? final.result : "",
        cost: final.total_cost_usd ?? null,
        turns: final.num_turns ?? null,
        session: final.session_id || sessionSeen || null,
        error: final.is_error ? String(final.result || final.subtype || "error") : undefined,
      });
    });
  });
}
