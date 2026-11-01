import { html, render, useState, useEffect, useRef, useCallback } from "./vendor/htm-preact.mjs";

// ---------------- api ----------------
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const fmt = (n) => (n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n));
const list = (x) => [].concat(x || []).filter((v) => v !== "" && v != null);
const csv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

const TABS = [
  ["brief", "Brief"],
  ["sources", "Sources"],
  ["research", "Research"],
  ["dna", "Style DNA"],
  ["directions", "Directions"],
  ["refine", "Refine"],
  ["sound", "Sound"],
  ["kit", "Kit"],
];
const STAGE_TAB = { brief: "brief", sources: "sources", collect: "sources", analyze: "research", dna: "dna", directions: "directions", refine: "refine", sound: "sound", build: "kit", done: "kit" };
const LANGS = [["tr", "Türkçe"], ["en", "English"], ["de", "Deutsch"], ["es", "Español"], ["fr", "Français"], ["ar", "العربية"]];
const PLATFORMS = [["tiktok", "TikTok"], ["instagram", "Instagram Reels"], ["youtube", "YouTube Shorts"]];
const CAPTION_STYLES = ["highlight", "pill", "outline", "clean", "kinetic"];
const LOGO_STYLES = ["wordmark", "wordmark-dot", "wordmark-underline", "monogram-circle", "monogram-square", "lockup-circle", "lockup-square"];

function doneMap(d) {
  const s = d.state || {};
  const chosen = d.directions.find((x) => x.id === s.chosenDirection);
  return {
    brief: Boolean(s.brief?.niche || s.brief?.startingPoints?.length),
    sources: Boolean(d.manifest),
    research: Boolean(d.dossier),
    dna: Boolean(d.dna),
    directions: d.directions.length > 0,
    refine: Boolean(s.chosenDirection),
    sound: Boolean(chosen && (!s.brief?.sound || chosen.brand.sound?.enabled)),
    kit: Boolean(d.kit),
  };
}

// ---------------- app ----------------
function parseHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("v/")) return { kind: "video", slug: h.slice(2) };
  if (h.startsWith("b/")) return { kind: "brand", slug: h.slice(2) };
  return h ? { kind: "brand", slug: h } : { kind: null, slug: null };
}

function App() {
  const [health, setHealth] = useState(null);
  const [brands, setBrands] = useState([]);
  const [videos, setVideos] = useState([]);
  const [route, setRoute] = useState(parseHash());
  const [d, setD] = useState(null);
  const [vd, setVd] = useState(null);
  const [tab, setTab] = useState(null);
  const [job, setJob] = useState(null);
  const [toast, setToast] = useState(null);
  const waiters = useRef({});
  const es = useRef(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const slug = route.kind === "brand" ? route.slug : null;
  const vslug = route.kind === "video" ? route.slug : null;

  const fail = (e) => {
    setToast(e.message || String(e));
    setTimeout(() => setToast(null), 6000);
  };
  const loadLists = () => {
    api("GET", "/api/brands").then((r) => setBrands(r.brands)).catch(fail);
    api("GET", "/api/videos").then((r) => setVideos(r.videos)).catch(fail);
  };
  const refresh = useCallback(async () => {
    const r = routeRef.current;
    try {
      if (r.kind === "brand") {
        const det = await api("GET", `/api/brands/${r.slug}`);
        setD(det);
        return det;
      }
      if (r.kind === "video") {
        const det = await api("GET", `/api/videos/${r.slug}`);
        setVd(det);
        return det;
      }
    } catch (e) {
      fail(e);
    }
  }, []);

  useEffect(() => {
    api("GET", "/api/health").then(setHealth).catch(fail);
    loadLists();
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const want = route.kind ? `${route.kind === "video" ? "v" : "b"}/${route.slug}` : "";
    if (decodeURIComponent(location.hash.slice(1)) !== want) location.hash = want ? encodeURIComponent(want).replace("%2F", "/") : "";
    setTab(null);
    setD(null);
    setVd(null);
    refresh().then((det) => {
      if (det && route.kind === "brand") setTab(STAGE_TAB[det.state?.stage] || "brief");
      if (det?.running) attach(det.running);
    });
  }, [route.kind, route.slug]);

  function attach(j) {
    es.current?.close();
    setJob({ ...j, logs: [], open: true });
    const src = new EventSource(`/api/jobs/${j.id}/events`);
    es.current = src;
    src.addEventListener("log", (ev) => {
      const e = JSON.parse(ev.data);
      setJob((cur) => (cur && cur.id === j.id ? { ...cur, logs: [...cur.logs, e.line].slice(-800) } : cur));
    });
    src.addEventListener("done", (ev) => {
      const fin = JSON.parse(ev.data);
      src.close();
      setJob((cur) => (cur && cur.id === j.id ? { ...cur, ...fin } : cur));
      refresh();
      loadLists();
      const w = waiters.current[j.id];
      if (w) {
        delete waiters.current[j.id];
        fin.status === "done" ? w.resolve(fin.result) : w.reject(new Error(fin.error || fin.status));
      }
    });
  }

  /** Start a job at base (/api/brands/x or /api/videos/x); resolves with its result when it finishes. */
  const runAt = async (base, step, opts = {}) => {
    const j = await api("POST", `${base}/run/${step}`, opts);
    attach(j);
    return new Promise((resolve, reject) => (waiters.current[j.id] = { resolve, reject }));
  };
  const run = (step, opts) => runAt(`/api/brands/${slug}`, step, opts);
  const runVideo = (step, opts) => runAt(`/api/videos/${vslug}`, step, opts);
  const saveState = async (patch) => {
    const st = await api("PUT", `/api/brands/${slug}/state`, patch);
    setD((cur) => ({ ...cur, state: st }));
    return st;
  };
  const busy = job?.status === "running";
  const props = { d, run, refresh, saveState, setTab, fail, busy, slug };

  return html`<div class="app">
    <${Sidebar} brands=${brands} videos=${videos} route=${route} setRoute=${setRoute} health=${health} onCreated=${(r) => (loadLists(), setRoute(r))} fail=${fail} />
    <main class="main">
      ${!route.kind && html`<${Welcome} />`}
      ${route.kind === "brand" && d && html`<div>
        <div class="head">
          <h1>${d.state?.brief?.name || d.slug} <span class="badge">${d.state?.stage || "brief"}</span></h1>
          <nav class="steps">${TABS.map(([k, label], i) => {
            const done = doneMap(d)[k];
            return html`<button key=${k} class=${`step ${tab === k ? "on" : ""} ${done ? "done" : ""}`} onClick=${() => setTab(k)}><b>${done ? "✓" : i + 1}</b>${label}</button>`;
          })}</nav>
        </div>
        <div class="content">
          ${tab === "brief" && html`<${Brief} ...${props} />`}
          ${tab === "sources" && html`<${Sources} ...${props} />`}
          ${tab === "research" && html`<${Research} ...${props} />`}
          ${tab === "dna" && html`<${Dna} ...${props} />`}
          ${tab === "directions" && html`<${Directions} ...${props} />`}
          ${tab === "refine" && html`<${Refine} ...${props} />`}
          ${tab === "sound" && html`<${Sound} ...${props} />`}
          ${tab === "kit" && html`<${Kit} ...${props} />`}
        </div>
      </div>`}
      ${route.kind === "video" && vd && html`<${VideoPage} v=${vd} setV=${setVd} run=${runVideo} refresh=${refresh} fail=${fail} busy=${busy} job=${job} />`}
    </main>
    ${job && html`<${Console} job=${job} setJob=${setJob} />`}
    ${toast && html`<div class="toast" onClick=${() => setToast(null)}>${toast}</div>`}
  </div>`;
}

function Sidebar({ brands, videos, route, setRoute, health, onCreated, fail }) {
  const [name, setName] = useState("");
  const [vtitle, setVtitle] = useState("");
  const [vbrand, setVbrand] = useState("");
  const kits = brands.filter((b) => b.stage === "done");
  const createBrand = async () => {
    try {
      const r = await api("POST", "/api/brands", { name });
      setName("");
      onCreated({ kind: "brand", slug: r.slug });
    } catch (e) {
      fail(e);
    }
  };
  const createVideo = async () => {
    try {
      const r = await api("POST", "/api/videos", { title: vtitle, brand: vbrand || kits[0]?.slug });
      setVtitle("");
      onCreated({ kind: "video", slug: r.slug });
    } catch (e) {
      fail(e);
    }
  };
  const on = (kind, s) => route.kind === kind && route.slug === s;
  return html`<aside class="side">
    <div class="logo"><i></i>vlog-editor studio</div>
    <h4>Videos</h4>
    <div class="stack" style="gap:2px">
      ${videos.map(
        (v) => html`<div key=${v.slug} class=${`brand-item ${on("video", v.slug) ? "on" : ""}`} onClick=${() => setRoute({ kind: "video", slug: v.slug })}>
          <div class="av vt">${v.thumb ? html`<img src=${v.thumb} />` : "▶"}</div>
          <div><div>${v.title}</div><small>${v.running ? "working…" : `${v.brand}${v.renders ? ` · ${v.renders} render${v.renders > 1 ? "s" : ""}` : ""}`}</small></div>
        </div>`,
      )}
    </div>
    <div class="stack">
      <input type="text" placeholder="New video title" value=${vtitle} onInput=${(e) => setVtitle(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && vtitle.trim() && kits.length && createVideo()} />
      ${kits.length > 1 && html`<select value=${vbrand || kits[0].slug} onChange=${(e) => setVbrand(e.target.value)}>${kits.map((b) => html`<option value=${b.slug}>${b.name}</option>`)}</select>`}
      <button class="btn primary" disabled=${!vtitle.trim() || !kits.length} onClick=${createVideo}>+ New video</button>
      ${!kits.length && html`<small class="sub">Build a brand kit first.</small>`}
    </div>
    <h4>Brands</h4>
    <div class="stack" style="gap:2px">
      ${brands.map(
        (b) => html`<div key=${b.slug} class=${`brand-item ${on("brand", b.slug) ? "on" : ""}`} onClick=${() => setRoute({ kind: "brand", slug: b.slug })}>
          <div class="av">${b.avatar ? html`<img src=${b.avatar} />` : (b.name || "?")[0].toUpperCase()}</div>
          <div><div>${b.name}</div><small>${b.running ? "working…" : b.stage}</small></div>
        </div>`,
      )}
    </div>
    <div class="stack">
      <input type="text" placeholder="New brand name (or working title)" value=${name} onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && name.trim() && createBrand()} />
      <button class="btn" disabled=${!name.trim()} onClick=${createBrand}>+ New brand kit</button>
    </div>
    <div class="health">
      ${health &&
      html`<div title=${health.workspace}>workspace: ${health.workspace.split("/").slice(-1)[0]}</div>
        <div><span class=${`dot ${health.tools.claude ? "on" : ""}`}></span>Claude Code</div>
        <div><span class=${`dot ${health.tools.ytdlp ? "on" : ""}`}></span>yt-dlp</div>
        <div><span class=${`dot ${health.tools.ffmpeg ? "on" : ""}`}></span>ffmpeg</div>`}
    </div>
  </aside>`;
}

function Welcome() {
  return html`<div class="empty"><div>
    <h2>Brand kits and videos</h2>
    <p>Build a brand kit from evidence, then make videos with it: upload your clips, build a draft, and edit by talking to Claude.</p>
    <p class="sub">Pick a video or a brand on the left, or create one.</p>
  </div></div>`;
}

function Console({ job, setJob }) {
  const pre = useRef(null);
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [job.logs.length, job.open]);
  const cancel = (e) => {
    e.stopPropagation();
    api("POST", `/api/jobs/${job.id}/cancel`).catch(() => {});
  };
  const st = job.status;
  return html`<div class="console">
    <div class="bar" onClick=${() => setJob({ ...job, open: !job.open })}>
      ${st === "running" ? html`<span class="spin"></span>` : html`<span class=${`badge ${st === "done" ? "ok" : "err"}`}>${st}</span>`}
      <b>${job.step}</b>
      ${st === "running" && html`<button class="btn sm ghost" onClick=${cancel}>Cancel</button>`}
      ${st !== "running" && html`<button class="btn sm ghost" onClick=${(e) => (e.stopPropagation(), setJob(null))}>Close</button>`}
      <span class="sub" style="margin:0">${job.open ? "▾" : "▸"}</span>
    </div>
    ${job.open && html`<pre ref=${pre}>${job.logs.join("\n")}${job.error ? `\n✗ ${job.error}` : ""}</pre>`}
  </div>`;
}

// ---------------- 1. brief ----------------
function Brief({ d, saveState, setTab, fail }) {
  const [b, setB] = useState(d.state.brief || {});
  useEffect(() => setB(d.state.brief || {}), [d.slug]);
  const set = (k, v) => setB((cur) => ({ ...cur, [k]: v }));
  const toggle = (k, v) => set(k, list(b[k]).includes(v) ? list(b[k]).filter((x) => x !== v) : [...list(b[k]), v]);
  const p = b.personality || {};
  const setP = (k, v) => set("personality", { ...p, [k]: v });
  const save = async () => {
    try {
      await saveState({ brief: b, stage: d.state.stage === "brief" ? "sources" : d.state.stage });
      setTab("sources");
    } catch (e) {
      fail(e);
    }
  };
  const slider = (k, lo, hi) => html`<div class="slider"><span>${lo}</span><input type="range" min="0" max="1" step="0.05" value=${p[k] ?? 0.5} onInput=${(e) => setP(k, +e.target.value)} /><span>${hi}</span></div>`;
  const chip = (k, v, label) => html`<button class=${`chip ${list(b[k]).includes(v) ? "on" : ""}`} onClick=${() => toggle(k, v)}>${label}</button>`;
  return html`<div>
    <div class="card">
      <h3>Where should the brand come from?</h3>
      <p class="sub">Pick any mix. Nothing yet? Choose "find top accounts" and the studio searches your niche.</p>
      <div class="chips">
        ${chip("startingPoints", "self", "My existing account")}
        ${chip("startingPoints", "references", "Accounts I admire")}
        ${chip("startingPoints", "discover", "Find top accounts in my niche")}
        ${chip("startingPoints", "scratch", "Describe it from scratch")}
      </div>
    </div>
    <div class="grid2">
      <div class="card stack">
        <h3>Basics</h3>
        <label class="f">Brand name <input type="text" value=${b.name || ""} placeholder="Leave empty to get name ideas later" onInput=${(e) => set("name", e.target.value)} /></label>
        <label class="f">Niche <input type="text" value=${b.niche || ""} placeholder="e.g. slow travel in Türkiye, home cooking, tech reviews" onInput=${(e) => set("niche", e.target.value)} /></label>
        <label class="f">Audience <input type="text" value=${b.audience || ""} placeholder="who watches, where, how old, why" onInput=${(e) => set("audience", e.target.value)} /></label>
        <label class="f">Platforms</label>
        <div class="chips">${PLATFORMS.map(([v, l]) => chip("platforms", v, l))}</div>
        <label class="f">Caption languages (first = primary)</label>
        <div class="chips">${LANGS.map(([v, l]) => chip("languages", v, l))}</div>
      </div>
      <div class="card stack">
        <h3>Personality</h3>
        ${slider("energy", "calm", "high energy")}
        ${slider("polish", "raw", "cinematic")}
        ${slider("warmth", "cool", "warm")}
        ${slider("playfulness", "serious", "playful")}
        <label class="f">Must have <textarea value=${b.mustHave || ""} placeholder="colours, a mascot, bilingual captions…" onInput=${(e) => set("mustHave", e.target.value)}></textarea></label>
        <label class="f">Avoid <textarea value=${b.avoid || ""} placeholder="looks or habits you don't want" onInput=${(e) => set("avoid", e.target.value)}></textarea></label>
        <label class="row" style="gap:8px"><input type="checkbox" checked=${Boolean(b.sound)} onChange=${(e) => set("sound", e.target.checked)} /> Include a sonic identity (music bed, sting, sound effects)</label>
      </div>
    </div>
    <div class="row end"><button class="btn primary" onClick=${save}>Save and continue →</button></div>
  </div>`;
}

// ---------------- 2. sources ----------------
function Sources({ d, run, saveState, setTab, fail, busy, slug }) {
  const brief = d.state.brief || {};
  const initial = d.sources || {
    cookiesFromBrowser: null,
    defaults: { top: 8, scan: 60, sinceDays: 365, maxDuration: 180, rankBy: "likes" },
    sources: (d.inbox.length ? [{ kind: "files", role: "self", path: "research/inbox" }] : []),
  };
  const [cfg, setCfg] = useState(initial);
  const [preview, setPreview] = useState(null);
  const [cands, setCands] = useState(null);
  const [picked, setPicked] = useState({});
  const [niche, setNiche] = useState(brief.niche || "");
  const [igUrls, setIgUrls] = useState(() => Object.fromEntries(["self", "reference"].map((r) => [r, (cfg.sources.find((s) => s.kind === "urls" && s.role === r)?.urls || []).join("\n")])));
  const accounts = cfg.sources.filter((s) => s.kind === "account");
  const setSources = (sources) => setCfg({ ...cfg, sources });
  const addAccount = (role) => setSources([...cfg.sources, { kind: "account", platform: list(brief.platforms)[0] === "youtube" ? "youtube" : "tiktok", handle: "", role }]);
  const updAccount = (i, patch) => setSources(cfg.sources.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const delSource = (i) => setSources(cfg.sources.filter((_, j) => j !== i));

  const compose = () => {
    const base = cfg.sources.filter((s) => s.kind !== "urls" && !(s.kind === "account" && !s.handle.trim()));
    for (const role of ["self", "reference"]) {
      const urls = igUrls[role].split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
      if (urls.length) base.push({ kind: "urls", role, urls });
    }
    if (d.inbox.length && !base.some((s) => s.kind === "files")) base.push({ kind: "files", role: "self", path: "research/inbox" });
    return { ...cfg, sources: base };
  };
  const save = async () => {
    const c = compose();
    await api("PUT", `/api/brands/${slug}/sources`, c);
    return c;
  };
  const doPreview = async () => {
    try {
      await save();
      const r = await run("collect", { dryRun: true });
      setPreview(r.sources);
    } catch (e) {
      fail(e);
    }
  };
  const doCollect = async () => {
    try {
      await save();
      await run("collect");
      setTab("research");
    } catch (e) {
      fail(e);
    }
  };
  const discover = async () => {
    try {
      const r = await run("discover", { niche, platforms: list(brief.platforms).filter((p) => p !== "instagram").length ? list(brief.platforms).filter((p) => p !== "instagram") : ["tiktok"], region: list(brief.languages)[0] });
      setCands(r.candidates || []);
    } catch (e) {
      fail(e);
    }
  };
  const addPicked = () => {
    const add = (cands || []).filter((c, i) => picked[i]).map((c) => ({ kind: "account", platform: /you/i.test(c.platform) ? "youtube" : /insta/i.test(c.platform) ? "instagram" : "tiktok", handle: c.handle, role: "discovered" }));
    setSources([...cfg.sources, ...add]);
    setPicked({});
  };
  const upload = async (files) => {
    for (const f of files) {
      try {
        const r = await fetch(`/api/brands/${slug}/upload?name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "X-Studio": "1" }, body: f });
        if (!r.ok) throw new Error((await r.json()).error);
      } catch (e) {
        fail(e);
      }
    }
    if (!cfg.sources.some((s) => s.kind === "files")) setSources([...cfg.sources, { kind: "files", role: "self", path: "research/inbox" }]);
  };

  const accountRows = (role) =>
    cfg.sources.map((s, i) =>
      s.kind === "account" && s.role === role
        ? html`<div key=${i} class="row">
            <select style="width:160px" value=${s.platform} onChange=${(e) => updAccount(i, { platform: e.target.value })}>${PLATFORMS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
            <input type="text" style="flex:1;width:auto" placeholder="@handle" value=${s.handle} onInput=${(e) => updAccount(i, { handle: e.target.value })} />
            <input type="number" style="width:80px" title="posts to take" value=${s.top ?? ""} placeholder=${String(cfg.defaults.top)} onInput=${(e) => updAccount(i, { top: e.target.value ? +e.target.value : undefined })} />
            <button class="btn sm ghost" onClick=${() => delSource(i)}>✕</button>
          </div>`
        : null,
    );
  const hasIg = accounts.some((s) => s.platform === "instagram");

  return html`<div>
    <div class="grid2">
      <div class="card stack">
        <h3>Your account</h3>
        <p class="sub">Your own top posts become the baseline: what to keep, what to fix.</p>
        ${accountRows("self")}
        <div class="row"><button class="btn sm" onClick=${() => addAccount("self")}>+ Add account</button>
          <label class="btn sm">⬆ Upload clips<input type="file" multiple accept="video/*,image/*" style="display:none" onChange=${(e) => upload([...e.target.files])} /></label></div>
        ${d.inbox.length > 0 && html`<div class="sub">Uploaded: ${d.inbox.join(", ")}</div>`}
      </div>
      <div class="card stack">
        <h3>Accounts you admire</h3>
        <p class="sub">Their most-liked recent posts show the grammar to learn: pace, hooks, captions, colour.</p>
        ${accountRows("reference")}
        ${accountRows("discovered")}
        <div class="row"><button class="btn sm" onClick=${() => addAccount("reference")}>+ Add account</button></div>
      </div>
    </div>
    <div class="card stack">
      <h3>Find top accounts in your niche</h3>
      <div class="row"><input type="text" style="flex:1;width:auto" value=${niche} placeholder="niche" onInput=${(e) => setNiche(e.target.value)} /><button class="btn" disabled=${busy || !niche.trim()} onClick=${discover}>🔎 Search with Claude</button></div>
      ${cands &&
      html`<table class="t"><thead><tr><th></th><th>Account</th><th>Platform</th><th>Followers</th><th>Why</th></tr></thead><tbody>
        ${cands.map((c, i) => html`<tr key=${i}><td><input type="checkbox" checked=${Boolean(picked[i])} onChange=${(e) => setPicked({ ...picked, [i]: e.target.checked })} /></td><td><b>${c.handle}</b><br /><small class="sub">${c.name || ""}</small></td><td>${c.platform}</td><td>${c.followers || "–"}</td><td class="sub">${c.why}</td></tr>`)}
      </tbody></table>
      <div class="row end"><button class="btn sm" onClick=${addPicked}>Add selected</button></div>`}
    </div>
    <div class="card stack">
      <h3>Instagram</h3>
      <p class="sub">Instagram profiles can't be listed without logging in. Paste reel links (best), or allow the downloader to use your Chrome login.</p>
      ${hasIg && html`<div class="note warn">An Instagram account was added above: it will be skipped unless you paste reel links or allow your Chrome login.</div>`}
      <div class="grid2">
        <label class="f">Your reels (one link per line)<textarea value=${igUrls.self} onInput=${(e) => setIgUrls({ ...igUrls, self: e.target.value })}></textarea></label>
        <label class="f">Reels you admire<textarea value=${igUrls.reference} onInput=${(e) => setIgUrls({ ...igUrls, reference: e.target.value })}></textarea></label>
      </div>
      <label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" checked=${cfg.cookiesFromBrowser === "chrome"} onChange=${(e) => setCfg({ ...cfg, cookiesFromBrowser: e.target.checked ? "chrome" : null })} />
        <span>Allow yt-dlp to read my Chrome cookies for Instagram. <span class="sub">It reads your browser's login cookies locally; macOS will ask for Keychain access. Nothing is uploaded.</span></span></label>
    </div>
    <div class="card">
      <h3>How much</h3>
      <div class="row">
        <label class="f">Posts per account <input type="number" value=${cfg.defaults.top} onInput=${(e) => setCfg({ ...cfg, defaults: { ...cfg.defaults, top: +e.target.value || 8 } })} /></label>
        <label class="f">Scan latest <input type="number" value=${cfg.defaults.scan} onInput=${(e) => setCfg({ ...cfg, defaults: { ...cfg.defaults, scan: +e.target.value || 60 } })} /></label>
        <label class="f">Within days <input type="number" value=${cfg.defaults.sinceDays} onInput=${(e) => setCfg({ ...cfg, defaults: { ...cfg.defaults, sinceDays: +e.target.value || 365 } })} /></label>
        <label class="f">Rank by <select value=${cfg.defaults.rankBy || "likes"} onChange=${(e) => setCfg({ ...cfg, defaults: { ...cfg.defaults, rankBy: e.target.value } })}><option value="likes">most liked</option><option value="views">most viewed</option><option value="engagement">engagement rate</option></select></label>
      </div>
    </div>
    ${preview &&
    html`<div class="card"><h3>Ranking preview</h3>
      <table class="t"><thead><tr><th>Source</th><th>Scanned</th><th>Top posts</th></tr></thead><tbody>
      ${preview.map((s) => html`<tr key=${s.key}><td><b>${s.handle || s.key}</b> <span class="badge">${s.role}</span>${s.error ? html`<div class="note err">${s.error.code}: ${s.error.hint}</div>` : ""}</td><td>${s.scanned ?? s.found ?? "–"}</td>
        <td>${(s.top || []).map((t) => html`<div class="sub" style="margin:0">♥ ${fmt(t.likes)} · ▶ ${fmt(t.views)} — ${t.title}</div>`)}</td></tr>`)}
      </tbody></table></div>`}
    ${d.manifest &&
    html`<div class="note">Last collection: ${d.manifest.items} items from ${d.manifest.sources.length} sources (${new Date(d.manifest.generatedAt).toLocaleString()}).</div>`}
    <div class="row end" style="margin-top:14px">
      <button class="btn" disabled=${busy} onClick=${doPreview}>Preview ranking</button>
      <button class="btn primary" disabled=${busy} onClick=${doCollect}>Collect videos →</button>
    </div>
  </div>`;
}

// ---------------- 3. research ----------------
function Research({ d, run, setTab, fail, busy }) {
  const [transcribe, setTranscribe] = useState(true);
  const [open, setOpen] = useState(null);
  const lang = list(d.state.brief?.languages)[0] || "en";
  const analyze = () => run("analyze", { transcribe, language: lang }).catch(fail);
  if (!d.manifest) return html`<div class="card"><h3>Nothing collected yet</h3><p class="sub">Add sources and collect videos first.</p><button class="btn" onClick=${() => setTab("sources")}>← Sources</button></div>`;
  const dz = d.dossier;
  const groups = dz ? Object.entries(dz.groups) : [];
  const rows = [
    ["videos", (s) => s.videos],
    ["duration (s)", (s) => s.duration.median],
    ["median shot (s)", (s) => s.pace.medianShot],
    ["first cut (s)", (s) => s.pace.firstCut],
    ["cuts / min", (s) => s.pace.cutsPerMinute],
    ["luma", (s) => s.look.luma],
    ["saturation", (s) => s.look.saturation],
    ["warmth", (s) => s.look.warmth],
    ["sound", (s) => Object.entries(s.sound.kinds).map(([k, n]) => `${k} ${n}`).join(", ")],
    ["loudness (LUFS)", (s) => s.sound.lufs],
    ["words / s", (s) => s.speech.wordsPerSecond],
    ["median likes", (s) => fmt(s.engagement.likes)],
    ["palette", (s) => html`${s.palette.slice(0, 6).map((c) => html`<span class="sw" title=${c.hex} style=${`background:${c.hex}`}></span>`)}`],
    ["vivid", (s) => html`${s.vivid.map((c) => html`<span class="sw" title=${c.hex} style=${`background:${c.hex}`}></span>`)}`],
    ["hashtags", (s) => s.hashtags.slice(0, 5).map((t) => t.tag).join(" ")],
  ];
  const items = (dz?.items || []).filter((x) => x.type === "video").sort((a, b) => (b.likes ?? b.views ?? 0) - (a.likes ?? a.views ?? 0));
  return html`<div>
    <div class="card">
      <h3>Collected</h3>
      <table class="t"><thead><tr><th>Source</th><th>Role</th><th>Followers</th><th>Videos</th><th>Median likes</th><th></th></tr></thead><tbody>
        ${d.manifest.sources.map((s) => {
          const st = dz?.sources.find((x) => x.key === s.key)?.stats;
          return html`<tr key=${s.key}><td><b>${s.handle || s.key}</b></td><td><span class="badge">${s.role}</span></td><td>${fmt(s.followers)}</td><td>${s.downloaded ?? s.found ?? 0}</td><td>${fmt(st?.likes)}</td><td>${s.error ? html`<span class="badge err" title=${s.error.hint}>${s.error.code}</span>` : ""}</td></tr>`;
        })}
      </tbody></table>
      <div class="row end" style="margin-top:12px">
        <label class="row" style="gap:6px"><input type="checkbox" checked=${transcribe} onChange=${(e) => setTranscribe(e.target.checked)} /> transcribe speech (${lang})</label>
        <button class="btn ${dz ? "" : "primary"}" disabled=${busy} onClick=${analyze}>${dz ? "Re-analyze" : "Analyze videos"}</button>
      </div>
    </div>
    ${dz &&
    html`<div>
      <div class="card"><h3>What the numbers say</h3>
        <table class="t"><thead><tr><th>Measure</th>${groups.map(([g]) => html`<th>${g}</th>`)}</tr></thead><tbody>
          ${rows.map(([label, fn]) => html`<tr><td class="sub">${label}</td>${groups.map(([, s]) => html`<td>${fn(s) ?? "–"}</td>`)}</tr>`)}
        </tbody></table>
        ${groups.filter(([, s]) => s.leadersVsRest).map(([g, s]) => html`<div class="note" style="margin-top:10px"><b>${g}:</b> top half by likes vs the rest — shots ${s.leadersVsRest.leaders.medianShot}s vs ${s.leadersVsRest.rest.medianShot}s · first cut ${s.leadersVsRest.leaders.firstCut}s vs ${s.leadersVsRest.rest.firstCut}s · length ${s.leadersVsRest.leaders.duration}s vs ${s.leadersVsRest.rest.duration}s (n=${s.leadersVsRest.n})</div>`)}
      </div>
      <div class="card"><h3>First frames (the thumbnails)</h3>
        <div class="stack">${Object.entries(dz.pictures).filter(([k]) => k.includes("first frames")).map(([k, src]) => html`<div><div class="sub">${k}</div><img class="pic" src=${src} /></div>`)}</div>
      </div>
      <div class="card"><h3>Videos, most liked first</h3>
        <div class="vids">${items.map((it) => html`<div class="vid" key=${it.key} onClick=${() => setOpen(it)}><img src=${it.thumb} loading="lazy" /><div><b>♥ ${fmt(it.likes)}</b> · ▶ ${fmt(it.views)}<br />${it.handle || "own"} · shot ${it.medianShot ?? "–"}s</div></div>`)}</div>
      </div>
      <div class="row end"><button class="btn primary" onClick=${() => setTab("dna")}>Find the style DNA →</button></div>
    </div>`}
    ${open &&
    html`<div class="modal" onClick=${() => setOpen(null)}><div onClick=${(e) => e.stopPropagation()}>
      <div class="row" style="justify-content:space-between"><h3 style="margin:0">${open.handle || "own clip"} — ♥ ${fmt(open.likes)} · ▶ ${fmt(open.views)}</h3><button class="btn sm" onClick=${() => setOpen(null)}>Close</button></div>
      <p class="sub">${open.title}</p>
      <div class="kv" style="margin-bottom:12px"><span>Length</span><div>${open.duration}s</div><span>Median shot</span><div>${open.medianShot}s · first cut ${open.firstCut ?? "–"}s</div><span>Sound</span><div>${open.sound} · ${open.lufs} LUFS</div><span>Hook words</span><div>${open.hookText || "–"}</div>${open.url ? html`<span>Original</span><div><a href=${open.url} target="_blank">open ↗</a></div>` : ""}</div>
      <div class="sub">First 3 seconds</div><img class="pic" src=${open.hook} />
      <div class="sub" style="margin-top:10px">Overview</div><img class="pic" src=${open.overview} />
    </div></div>`}
  </div>`;
}

// ---------------- 4. style DNA ----------------
const CATS = ["hook", "editing", "captions", "type", "color", "look", "format", "sound", "length", "voice"];
function Dna({ d, run, saveState, setTab, fail, busy }) {
  const dna = d.dna;
  const [choices, setChoices] = useState(d.state.traitChoices || {});
  useEffect(() => setChoices(d.state.traitChoices || {}), [d.slug, dna]);
  const choiceOf = (t) => choices[t.id] || (["adopt", "keep", "fix"].includes(t.recommend) ? "adopt" : "skip");
  const go = async () => {
    try {
      const all = Object.fromEntries((dna?.traits || []).map((t) => [t.id, choiceOf(t)]));
      await saveState({ traitChoices: all });
      setTab("directions");
    } catch (e) {
      fail(e);
    }
  };
  if (!d.dossier) return html`<div class="card"><h3>Analyze videos first</h3><button class="btn" onClick=${() => setTab("research")}>← Research</button></div>`;
  return html`<div>
    <div class="card">
      <div class="row" style="justify-content:space-between"><div><h3>Style DNA</h3><p class="sub" style="margin:0">Claude looks at the numbers and the pictures, and separates what wins in the niche from what is one creator's signature.</p></div>
      <button class="btn ${dna ? "" : "primary"}" disabled=${busy} onClick=${() => run("dna").catch(fail)}>${dna ? "Run again" : "Find the style DNA"}</button></div>
      ${dna && html`<p style="margin-top:14px">${dna.summary}</p>`}
    </div>
    ${dna &&
    html`<div>
      ${CATS.filter((c) => dna.traits.some((t) => t.category === c)).map(
        (c) => html`<div class="card" key=${c}><h3 style="text-transform:capitalize">${c}</h3>
          ${dna.traits.filter((t) => t.category === c).map(
            (t) => html`<div class="trait" key=${t.id}><div><b>${t.label}</b> <span class="badge">${t.kind}</span> <span class=${`badge ${t.strength === "strong" ? "ok" : t.strength === "weak" ? "warn" : ""}`}>${t.strength}</span> <span class="badge">${t.source}</span>${t.recommend === "avoid" ? html` <span class="badge err">avoid</span>` : ""}<small>${t.evidence}</small></div>
              <div class="seg"><button class=${choiceOf(t) === "adopt" ? "on" : ""} onClick=${() => setChoices({ ...choices, [t.id]: "adopt" })}>Adopt</button><button class=${choiceOf(t) === "skip" ? "on skip" : ""} onClick=${() => setChoices({ ...choices, [t.id]: "skip" })}>Skip</button></div></div>`,
          )}</div>`,
      )}
      <div class="grid2">
        ${dna.self && html`<div class="card"><h3>Your account today</h3>${["keep", "fix", "protect"].map((k) => list(dna.self[k]).length ? html`<div class="sub" style="margin:8px 0 2px;text-transform:uppercase">${k}</div><ul>${list(dna.self[k]).map((x) => html`<li>${x}</li>`)}</ul>` : null)}</div>`}
        <div class="card"><h3>Openings (what nobody does)</h3><ul>${list(dna.whitespace).map((x) => html`<li>${x}</li>`)}</ul>
          ${list(dna.signatures).length > 0 && html`<h3 style="margin-top:12px">Signatures (inspiration only)</h3><ul>${dna.signatures.map((s) => html`<li><b>${s.account}</b>: ${s.what}</li>`)}</ul>`}</div>
      </div>
      ${list(dna.openQuestions).length > 0 && html`<div class="note">Open questions: ${dna.openQuestions.join(" · ")}</div>`}
      <details class="card"><summary>style-dna.md</summary><div class="md">${d.dnaMd}</div></details>
      <div class="row end"><button class="btn primary" onClick=${go}>Save choices and design directions →</button></div>
    </div>`}
  </div>`;
}

// ---------------- 5. directions ----------------
function Directions({ d, run, saveState, setTab, fail, busy }) {
  const [note, setNote] = useState("");
  const main = d.directions.filter((x) => /^[A-Z]$/.test(x.id));
  const meta = (id) => d.directionsMeta?.directions?.find((x) => x.id === id) || {};
  const choose = async (id) => {
    try {
      await saveState({ chosenDirection: id, stage: "refine" });
      setTab("refine");
    } catch (e) {
      fail(e);
    }
  };
  return html`<div>
    <div class="card">
      <h3>Three brands that could all work</h3>
      <p class="sub">On-trend, the opening nobody uses, and the boldest version of you. Each is rendered as a real reel frame plus its spec.</p>
      <label class="f">Anything to steer? (optional)<textarea value=${note} placeholder="e.g. keep it light-coloured, no serif fonts, my favourite colour is teal" onInput=${(e) => setNote(e.target.value)}></textarea></label>
      <div class="row end" style="margin-top:10px"><button class="btn ${main.length ? "" : "primary"}" disabled=${busy || !d.dna} onClick=${() => run("directions", { note }).catch(fail)}>${main.length ? "Generate again" : "Generate directions"}</button></div>
      ${!d.dna && html`<div class="note warn">Find the style DNA first.</div>`}
    </div>
    ${d.compare["compare.png"] && html`<div class="card"><img class="pic" src=${d.compare["compare.png"]} /></div>`}
    <div class="grid3">
      ${main.map(
        (x) => html`<div class=${`card dir ${d.state.chosenDirection === x.id ? "chosen" : ""}`} key=${x.id}>
          ${x.board && html`<img src=${x.board} />`}
          <div><b>${x.id} · ${x.brand.direction?.label || ""}</b><p class="sub" style="margin:4px 0">${x.brand.direction?.summary || meta(x.id).summary || ""}</p></div>
          ${(x.brand.direction?.rationale || meta(x.id).rationale) && html`<div class="sub"><b>Why:</b> ${x.brand.direction?.rationale || meta(x.id).rationale}</div>`}
          ${meta(x.id).risk && html`<div class="sub"><b>Risk:</b> ${meta(x.id).risk}</div>`}
          <button class="btn ${d.state.chosenDirection === x.id ? "primary" : ""}" onClick=${() => choose(x.id)}>${d.state.chosenDirection === x.id ? "Chosen ✓" : `Choose ${x.id}`}</button>
        </div>`,
      )}
    </div>
  </div>`;
}

// ---------------- 6. refine ----------------
function Refine({ d, run, saveState, fail, busy, slug, setTab }) {
  const id = d.state.chosenDirection;
  const dir = d.directions.find((x) => x.id === id);
  const [b, setB] = useState(dir?.resolved || dir?.brand || null);
  const [ask, setAsk] = useState("");
  const [variant, setVariant] = useState(false);
  const [names, setNames] = useState(null);
  useEffect(() => setB(dir?.resolved || dir?.brand || null), [id, dir?.board]);
  if (!dir || !b) return html`<div class="card"><h3>Choose a direction first</h3><button class="btn" onClick=${() => setTab("directions")}>← Directions</button></div>`;
  const setIn = (pathStr, v) => {
    const keys = pathStr.split(".");
    const next = structuredClone(b);
    let o = next;
    keys.slice(0, -1).forEach((k) => (o = o[k] = o[k] ?? {}));
    o[keys.at(-1)] = v;
    setB(next);
  };
  const get = (pathStr) => pathStr.split(".").reduce((o, k) => o?.[k], b);
  const saveRender = async () => {
    try {
      await api("PUT", `/api/brands/${slug}/directions/${id}`, b);
      await run("boards", { ids: [id], compare: false });
    } catch (e) {
      fail(e);
    }
  };
  const refine = async () => {
    try {
      const r = await run("refine", { id, instruction: ask, asVariant: variant });
      setAsk("");
      if (variant && r?.target) await saveState({ chosenDirection: id });
    } catch (e) {
      fail(e);
    }
  };
  const colorKeys = ["ground", "surface", "ink", "muted", "primary", "accent", "highlight", "captionText", "captionStroke", "captionBox"];
  const variants = d.directions.filter((x) => x.id !== id);
  const latestCompare = Object.entries(d.compare)
    .filter(([f]) => f !== "compare.png" && f.includes(id))
    .sort((a, b) => +b[1].split("v=")[1] - +a[1].split("v=")[1])[0]?.[1];
  const txt = (p, ph = "") => html`<input type="text" value=${get(p) ?? ""} placeholder=${ph} onInput=${(e) => setIn(p, e.target.value)} />`;
  const sel = (p, opts) => html`<select value=${get(p) ?? ""} onChange=${(e) => setIn(p, e.target.value)}>${opts.map((o) => html`<option value=${o}>${o}</option>`)}</select>`;
  return html`<div class="grid2" style="grid-template-columns: 420px 1fr; align-items:start">
    <div class="stack" style="position:sticky; top:120px">
      ${dir.board && html`<img class="pic" src=${dir.board} />`}
      <div class="row"><button class="btn primary" disabled=${busy} onClick=${saveRender}>Save and re-render</button><button class="btn" onClick=${() => setTab(d.state.brief?.sound ? "sound" : "kit")}>Looks right →</button></div>
    </div>
    <div>
      <div class="card stack">
        <h3>Ask Claude for a change</h3>
        <textarea value=${ask} placeholder="e.g. warmer palette, less shouty captions, make the logo a monogram, more playful hook" onInput=${(e) => setAsk(e.target.value)}></textarea>
        <div class="row" style="justify-content:space-between"><label class="row" style="gap:6px"><input type="checkbox" checked=${variant} onChange=${(e) => setVariant(e.target.checked)} /> keep this one and make a variant to compare</label>
          <button class="btn" disabled=${busy || !ask.trim()} onClick=${refine}>Apply with Claude</button></div>
      </div>
      <div class="card stack">
        <div class="row" style="justify-content:space-between"><h3>Name</h3><button class="btn sm" disabled=${busy} onClick=${() => run("names").then((r) => setNames(r.names)).catch(fail)}>💡 Name ideas</button></div>
        <div class="grid2">${txt("name")} ${txt("tagline", "tagline")}</div>
        <div class="grid2">${txt("handles.tiktok", "@tiktok")} ${txt("handles.instagram", "@instagram")}</div>
        ${names && html`<div class="chips">${names.map((n) => html`<button class="chip" title=${n.why} onClick=${() => setB({ ...b, name: n.name, logo: { ...b.logo, text: null, monogram: null }, handles: { ...b.handles, tiktok: n.handle, instagram: n.handle } })}>${n.name} <span class="sub">${n.handle}</span></button>`)}</div>`}
      </div>
      <div class="card"><h3>Colours</h3>
        <div class="kv">${colorKeys.map((k) => html`<span>${k}</span><div class="row"><input type="color" value=${get(`colors.${k}`) || "#000000"} onInput=${(e) => setIn(`colors.${k}`, e.target.value.toUpperCase())} /><input type="text" style="width:120px" value=${get(`colors.${k}`) || ""} onInput=${(e) => setIn(`colors.${k}`, e.target.value)} /></div>`)}</div>
      </div>
      <div class="card"><h3>Type</h3>
        <div class="kv">
          <span>Display</span><div class="row">${txt("fonts.display.family")}${sel("fonts.display.transform", ["none", "uppercase"])}</div>
          <span>Display weights</span><input type="text" value=${list(get("fonts.display.weights")).join(",")} onInput=${(e) => setIn("fonts.display.weights", csv(e.target.value).map(Number))} />
          <span>Width factor</span><input type="number" step="0.02" value=${get("fonts.display.widthFactor") ?? 0.5} onInput=${(e) => setIn("fonts.display.widthFactor", +e.target.value)} />
          <span>Body</span>${txt("fonts.body.family")}
          <span>Captions</span><div class="row">${txt("fonts.caption.family")}<input type="number" style="width:90px" value=${get("fonts.caption.weight") ?? 800} onInput=${(e) => setIn("fonts.caption.weight", +e.target.value)} />${sel("fonts.caption.transform", ["none", "uppercase"])}</div>
        </div>
        <p class="sub" style="margin-top:8px">Any Google Fonts family (exact name). Turkish needs latin-ext; the renderer warns when it is missing.</p>
      </div>
      <div class="card"><h3>Captions, logo, motion</h3>
        <div class="kv">
          <span>Caption style</span>${sel("captions.style", CAPTION_STYLES)}
          <span>Words per group</span><input type="text" value=${list(get("captions.wordsPerGroup")).join(",")} onInput=${(e) => setIn("captions.wordsPerGroup", csv(e.target.value).map(Number))} />
          <span>Logo</span><div class="row">${sel("logo.style", LOGO_STYLES)}${sel("logo.case", ["as-is", "upper", "lower"])}</div>
          <span>Energy</span>${sel("motion.energy", ["calm", "balanced", "high"])}
          <span>Transitions</span><input type="text" value=${list(get("motion.transitions")).join(", ")} onInput=${(e) => setIn("motion.transitions", csv(e.target.value))} />
        </div>
      </div>
      <div class="card"><h3>Samples on the board</h3>
        <div class="kv">
          <span>Hook</span>${txt("samples.hook")}
          <span>Emphasis</span>${txt("samples.hookEmphasis")}
          <span>Caption line</span>${txt("samples.caption")}
          <span>Active word #</span><input type="number" value=${get("samples.captionActive") ?? 0} onInput=${(e) => setIn("samples.captionActive", +e.target.value)} />
          <span>Call to action</span>${txt("samples.cta")}
        </div>
      </div>
      ${latestCompare && html`<div class="card"><h3>Latest comparison</h3><img class="pic" src=${latestCompare} /></div>`}
      ${variants.length > 0 &&
      html`<div class="card"><h3>Other directions and variants</h3><div class="grid3">${variants.map((v) => html`<div class="dir" key=${v.id}>${v.board && html`<img src=${v.board} />`}<b>${v.id} · ${v.brand.direction?.label || ""}</b><button class="btn sm" onClick=${() => saveState({ chosenDirection: v.id })}>Use this one</button></div>`)}</div></div>`}
    </div>
  </div>`;
}

// ---------------- 7. sound ----------------
function Sound({ d, run, saveState, fail, busy, slug, setTab }) {
  const id = d.state.chosenDirection;
  const dir = d.directions.find((x) => x.id === id);
  const [s, setS] = useState(dir?.brand.sound || {});
  useEffect(() => setS(dir?.brand.sound || {}), [id, dir?.brand.sound?.enabled, JSON.stringify(dir?.brand.sound)]);
  if (!d.state.brief?.sound)
    return html`<div class="card"><h3>Sonic identity is off</h3><p class="sub">A music bed, a short sting and a set of sound effects that repeat in every video. Optional.</p>
      <div class="row"><button class="btn" onClick=${() => saveState({ brief: { sound: true } }).catch(fail)}>Turn it on</button><button class="btn ghost" onClick=${() => setTab("kit")}>Skip →</button></div></div>`;
  if (!dir) return html`<div class="card"><h3>Choose a direction first</h3></div>`;
  const m = s.music || {};
  const setM = (k, v) => setS({ ...s, enabled: true, music: { ...m, [k]: v } });
  const save = async () => {
    try {
      await api("PUT", `/api/brands/${slug}/directions/${id}`, { ...dir.brand, sound: { ...s, enabled: true } });
      setTab("kit");
    } catch (e) {
      fail(e);
    }
  };
  return html`<div>
    <div class="card"><div class="row" style="justify-content:space-between"><div><h3>Sonic identity</h3><p class="sub" style="margin:0">Proposed from the sound of the top posts: music share, loudness, tracks.</p></div>
      <button class="btn ${s.enabled ? "" : "primary"}" disabled=${busy} onClick=${() => run("sound").catch(fail)}>${s.enabled ? "Propose again" : "Propose with Claude"}</button></div></div>
    <div class="card"><div class="kv">
      <span>Moods</span><input type="text" value=${list(m.moods).join(", ")} onInput=${(e) => setM("moods", csv(e.target.value))} />
      <span>Genres</span><input type="text" value=${list(m.genres).join(", ")} onInput=${(e) => setM("genres", csv(e.target.value))} />
      <span>BPM range</span><input type="text" value=${list(m.bpm).join("-")} onInput=${(e) => setM("bpm", e.target.value.split("-").map(Number).filter(Boolean))} />
      <span>Loudness (LUFS)</span><input type="number" value=${m.lufs ?? -14} onInput=${(e) => setM("lufs", +e.target.value)} />
      <span>Vocals</span><select value=${m.vocals || "instrumental"} onChange=${(e) => setM("vocals", e.target.value)}><option>instrumental</option><option>vocal chops</option><option>vocals ok</option></select>
      <span>Sting</span><input type="text" value=${s.sting?.description || ""} onInput=${(e) => setS({ ...s, sting: { ...(s.sting || {}), description: e.target.value } })} />
      <span>Voice style</span><input type="text" value=${s.voice?.style || ""} onInput=${(e) => setS({ ...s, voice: { ...(s.voice || {}), style: e.target.value } })} />
    </div>
    <p class="sub" style="margin-top:10px">Audio files come later through HyperFrames media-use (HeyGen music catalog with a free sign-in, 21 bundled effects offline). The kit stores the identity.</p></div>
    <div class="row end"><button class="btn primary" onClick=${save}>Save and go to the kit →</button></div>
  </div>`;
}

// ---------------- 8. kit ----------------
function Kit({ d, run, fail, busy }) {
  const [footage, setFootage] = useState("");
  const id = d.state.chosenDirection;
  const k = d.kit;
  const build = () => run("build", footage ? { footage: `brands/${d.slug}/research/inbox/${footage}` } : {}).catch(fail);
  const open = (file) => api("POST", "/api/open", { file }).catch(fail);
  return html`<div>
    <div class="card"><h3>Build the kit</h3>
      <p class="sub">Writes DESIGN.md (HyperFrames reads it as the design spec), tokens, local fonts, logos, the caption/hook/lower-third/end-card components, and renders a sizzle through a real HyperFrames project.</p>
      <div class="row">
        ${d.inbox.filter((f) => /\.(mp4|mov|m4v|webm)$/i.test(f)).length > 0 && html`<label class="f" style="min-width:260px">Background footage for the sizzle<select value=${footage} onChange=${(e) => setFootage(e.target.value)}><option value="">brand backdrop</option>${d.inbox.filter((f) => /\.(mp4|mov|m4v|webm)$/i.test(f)).map((f) => html`<option value=${f}>${f}</option>`)}</select></label>`}
        <button class="btn primary" disabled=${busy || !id} onClick=${build}>${k ? "Rebuild kit" : "Build kit"} ${id ? `from ${id}` : ""}</button>
      </div>
      ${!id && html`<div class="note warn">Choose a direction first.</div>`}
    </div>
    ${k &&
    html`<div>
      ${k.issues?.length > 0 && html`<div class="card"><h3>Issues</h3>${k.issues.map((i) => html`<div class=${`note ${i.level === "error" ? "err" : "warn"}`} style="margin-bottom:6px">${i.level}: ${i.msg}</div>`)}</div>`}
      <div class="grid3">
        <div class="card"><h3>Sizzle</h3>${d.files.sizzle && html`<video class="sizzle" src=${d.files.sizzle} controls loop playsinline></video>`}</div>
        <div class="card"><h3>Board</h3>${d.files.board && html`<img class="pic" src=${d.files.board} />`}</div>
        <div class="card stack"><h3>Logo</h3>
          ${d.files.avatar && html`<img class="pic" style="max-width:200px" src=${d.files.avatar} />`}
          ${d.files.wordmark && html`<img class="pic" style="background:#222" src=${d.files.wordmark} />`}
        </div>
      </div>
      <div class="card"><h3>Files</h3>
        <div class="kv">
          <span>Version</span><div>v${k.version} · built ${new Date(k.builtAt).toLocaleString()}</div>
          <span>Fonts</span><div>${k.files.fonts.map((f) => html`<div>${f.family} ${f.weights.join("/")} ${f.latinExt ? "" : html`<span class="badge warn">no latin-ext</span>`} <a href=${f.license} target="_blank">license</a></div>`)}</div>
          <span>Components</span><div>${k.files.components.join(", ")}</div>
          <span>Design spec</span><div><a href=${d.files.design} target="_blank">DESIGN.md</a></div>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn" onClick=${() => open(`brands/${d.slug}`)}>Open brand folder</button></div>
        <p class="sub" style="margin-top:12px">Use it in a video: <code>node plugins/vlog-editor/scripts/apply-brand.mjs --brand brands/${d.slug} --project videos/&lt;video&gt;</code></p>
      </div>
    </div>`}
  </div>`;
}

// ---------------- videos ----------------
const ROLES = [["main", "Main: decks + mix audio"], ["face", "Face: opens the video"], ["broll", "B-roll"]];
const QUICK = ["Make the hook punchier", "Show the recipe card right when the blend starts", "Crop more toward the mixer", "Add a lower third naming the technique", "End 2 seconds earlier"];
const fieldsOf = (v) => ({ title: v.title, hook: v.hook || { text: "", emphasis: "" }, recipe: v.recipe || null, blendAt: v.blendAt ?? null, faceSeconds: v.faceSeconds ?? 2.5, maxSeconds: v.maxSeconds ?? 60, lowerThird: v.lowerThird || null, captions: v.captions || [], endCard: v.endCard || { cta: "", seconds: 2.5 } });
const clipKey = (cs) => JSON.stringify(cs.map((c) => [c.id, c.role, c.in, c.out, c.focusX]));
const num = (x) => (x === "" || x == null || Number.isNaN(+x) ? null : +x);

function CropBox({ c, onChange }) {
  const w = c.info?.width || 16;
  const h = c.info?.height || 9;
  const frac = w / h > 9 / 16 ? (h * 9) / 16 / w : 1;
  const left = (c.focusX ?? 0.5) * (1 - frac) * 100;
  return html`<div class="crop">
    ${c.thumbUrl ? html`<img src=${c.thumbUrl} />` : html`<div class="crop-ph">ingest to see the frame</div>`}
    <div class="box" style=${`left:${left}%;width:${frac * 100}%`}></div>
    ${frac < 1 && html`<input type="range" min="0" max="1" step="0.01" value=${c.focusX ?? 0.5} onInput=${(e) => onChange(+e.target.value)} title="Vertical crop position" />`}
  </div>`;
}

function VideoPage({ v, setV, run, fail, busy }) {
  const renderFresh = (vv) => vv.renders?.length && new Date(vv.renders[0].at) >= new Date(vv.updatedAt || 0) - 2000;
  const [view, setView] = useState(renderFresh(v) ? "render" : "frames");
  const [f, setF] = useState(fieldsOf(v));
  const [clips, setClips] = useState(v.clips);
  const [msg, setMsg] = useState("");
  const [armed, setArmed] = useState(false);
  const [role, setRole] = useState(v.clips.some((c) => c.role === "main") ? "face" : "main");
  const [uploading, setUploading] = useState(null);
  const chatBox = useRef(null);
  useEffect(() => {
    setF(fieldsOf(v));
    setClips(v.clips);
    setArmed(false);
  }, [v.updatedAt, v.slug]);
  useEffect(() => {
    if (chatBox.current) chatBox.current.scrollTop = chatBox.current.scrollHeight;
  }, [v.chat?.length]);
  const dirty = JSON.stringify(fieldsOf(v)) !== JSON.stringify(f) || clipKey(v.clips) !== clipKey(clips);
  const set = (k, val) => setF((cur) => ({ ...cur, [k]: val }));
  const save = async () => {
    const r = await api("PUT", `/api/videos/${v.slug}`, { ...f, clips });
    setV(r);
    return r;
  };
  const guard = (fn) => async (...a) => {
    try {
      await fn(...a);
    } catch (e) {
      fail(e);
    }
  };
  const build = guard(async () => {
    if (dirty) await save();
    if (v.locked && !armed) return setArmed(true);
    setArmed(false);
    await run("draft", { force: Boolean(v.locked) });
    setView("frames");
  });
  const renderIt = guard(async () => {
    if (dirty) await save();
    await run("render");
    setView("render");
  });
  const send = guard(async (text) => {
    const t = String(text ?? msg).trim();
    if (!t) return;
    if (dirty) await save();
    setMsg("");
    setV({ ...v, chat: [...(v.chat || []), { role: "user", text: t, at: new Date().toISOString(), pending: true }] });
    await run("chat", { message: t });
    setView("frames");
  });
  const upload = async (files) => {
    for (const file of files) {
      setUploading(file.name);
      try {
        const r = await fetch(`/api/videos/${v.slug}/upload?name=${encodeURIComponent(file.name)}&role=${role}`, { method: "POST", headers: { "X-Studio": "1" }, body: file });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setV(j);
        setRole("face");
      } catch (e) {
        fail(e);
      }
    }
    setUploading(null);
  };
  const updClip = (id, patch) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const rec = f.recipe;
  const setRec = (patch) => set("recipe", { ...(rec || { label: "Combo", title: "", tracks: [], steps: [], cta: f.endCard?.cta || "" }), ...patch });
  const hasMain = clips.some((c) => c.role === "main");
  const ingested = clips.length > 0 && clips.every((c) => c.info);
  const lc = v.lastCheck;

  return html`<div class="content video">
    <div class="vhead">
      <input class="vtitle" value=${f.title} onInput=${(e) => set("title", e.target.value)} />
      <span class="badge">${v.brand}</span>
      ${v.locked && html`<span class="badge warn" title="Edited by hand or by Claude beyond the fields">hand-edited</span>`}
      ${lc && html`<span class=${`badge ${lc.errors?.length ? "err" : lc.warnings?.length ? "warn" : "ok"}`}>${lc.errors?.length ? `${lc.errors.length} errors` : lc.warnings?.length ? `${lc.warnings.length} warnings` : "check ok"}</span>`}
      ${v.plan && html`<span class="sub" style="margin:0">${v.plan.T.toFixed(1)} s</span>`}
      ${dirty && html`<button class="btn sm" onClick=${guard(save)}>Save changes</button>`}
    </div>
    <div class=${`vgrid ${view === "live" ? "wide-left" : ""}`}>
      <div class="vleft">
        <div class="seg wide">
          <button class=${view === "frames" ? "on" : ""} onClick=${() => setView("frames")}>Frames</button>
          <button class=${view === "live" ? "on" : ""} onClick=${() => setView("live")}>Live editor</button>
          <button class=${view === "render" ? "on" : ""} onClick=${() => setView("render")}>Render${v.renders?.length ? ` (${v.renders.length})` : ""}</button>
        </div>
        ${view === "frames" &&
        (v.frames?.length
          ? html`<div class="frames">${v.frames.map((fr) => html`<figure><img src=${fr.url} /><figcaption>${fr.t != null ? `${fr.t.toFixed(1)} s` : ""}</figcaption></figure>`)}</div>`
          : html`<div class="empty-box">${ingested ? "Build a draft to see the video's key frames." : "Upload a main clip (your decks with the mix audio), then build a draft."}</div>`)}
        ${view === "live" &&
        (v.preview
          ? html`<div class="live"><iframe src=${v.preview.url} title="HyperFrames Studio"></iframe><div class="row"><a href=${v.preview.url} target="_blank">Open in a new tab ↗</a><button class="btn sm ghost" disabled=${busy} onClick=${() => run("stop-preview").catch(fail)}>Stop</button></div></div>`
          : html`<div class="empty-box"><p>HyperFrames' own editor: play the video, scrub the timeline, nudge clips and texts.</p><button class="btn" disabled=${busy || !v.plan} onClick=${() => run("preview").then(() => setView("live")).catch(fail)}>Start live editor</button></div>`)}
        ${view === "render" &&
        (v.renders?.length
          ? html`<div class="stack">${!renderFresh(v) && html`<div class="note warn">This render is older than your latest changes. Render again to export them.</div>`}<video class="sizzle" style="max-width:100%" src=${v.renders[0].url} controls playsinline></video>
              ${v.renders.map((r, i) => html`<div class="row sub" style="margin:0"><span>${i === 0 ? "latest" : new Date(r.at).toLocaleString()}</span><span>${r.seconds?.toFixed?.(1)} s · ${r.lufs ?? "–"} LUFS</span><a href=${r.url} download>download</a></div>`)}</div>`
          : html`<div class="empty-box">No render yet. Render when the frames look right.</div>`)}
        <div class="row" style="margin-top:12px">
          <button class=${`btn ${armed ? "warn-btn" : ""}`} disabled=${busy || !hasMain} onClick=${build}>${armed ? "Overwrite hand edits?" : v.plan ? "Rebuild from fields" : "Build draft"}</button>
          <button class="btn primary" disabled=${busy || !v.plan} onClick=${renderIt}>Render MP4</button>
          <button class="btn ghost" disabled=${busy || !v.versions} onClick=${() => run("undo").catch(fail)} title="Restore the version before the last draft or Claude edit">↶ Undo${v.versions ? ` (${v.versions})` : ""}</button>
        </div>
        ${armed && html`<p class="sub">Claude or a hand edit changed this video beyond the fields. Rebuilding from the fields replaces those edits (Undo brings them back).</p>`}
        ${lc && (lc.errors?.length || lc.warnings?.length) ? html`<div class="stack" style="margin-top:10px">${[...(lc.errors || []), ...(lc.warnings || [])].slice(0, 6).map((x) => html`<div class=${`note ${/error/i.test(x.level) ? "err" : "warn"}`}>${x.code ? html`<b>${x.code}</b> ` : ""}${x.message}</div>`)}</div>` : null}
      </div>

      <div class="vright">
        <div class="card chat">
          <h3>Edit with Claude</h3>
          <p class="sub">Say what to change. Claude edits this video's project (one ongoing session that remembers earlier edits), checks it, and the frames update.</p>
          <div class="msgs" ref=${chatBox}>
            ${(v.chat || []).length === 0 && html`<div class="sub">No messages yet.</div>`}
            ${(v.chat || []).map((m) => html`<div class=${`msg ${m.role} ${m.ok === false ? "bad" : ""}`}>${m.text}${m.pending ? html` <span class="spin inline"></span>` : ""}</div>`)}
          </div>
          <div class="chips" style="margin:8px 0">${QUICK.map((q) => html`<button class="chip" disabled=${busy || !v.plan} onClick=${() => send(q)}>${q}</button>`)}</div>
          <div class="row">
            <textarea style="flex:1;min-height:56px" placeholder=${v.plan ? "e.g. start on the drop at 0:12 and make the hook two lines" : "Build a draft first, then ask for changes"} value=${msg} onInput=${(e) => setMsg(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && send()}></textarea>
            <button class="btn primary" disabled=${busy || !msg.trim() || !v.plan} onClick=${() => send()}>Send</button>
          </div>
        </div>

        <div class="card stack">
          <div class="row" style="justify-content:space-between"><h3>Clips</h3>
            <div class="row"><select style="width:220px" value=${role} onChange=${(e) => setRole(e.target.value)}>${ROLES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
            <label class="btn sm">${uploading ? `Uploading ${uploading}…` : "⬆ Add clip"}<input type="file" accept="video/*" multiple style="display:none" disabled=${Boolean(uploading)} onChange=${(e) => upload([...e.target.files])} /></label></div>
          </div>
          ${clips.length === 0 && html`<p class="sub">Add your decks clip as <b>Main</b> (its sound becomes the mix, mastered to the brand's loudness), and a short clip of your face as <b>Face</b> so frame 0 is you.</p>`}
          ${clips.map(
            (c) => html`<div class="clip" key=${c.id}>
              <${CropBox} c=${c} onChange=${(x) => updClip(c.id, { focusX: x })} />
              <div class="stack" style="gap:8px">
                <div class="row"><b>${c.id}</b><span class="sub" style="margin:0">${c.info ? `${c.info.width}×${c.info.height} · ${c.info.duration.toFixed(1)} s${c.info.hasAudio ? " · audio" : ""}` : "not ingested yet"}</span></div>
                <select value=${c.role} onChange=${(e) => updClip(c.id, { role: e.target.value })}>${ROLES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
                <div class="row"><label class="f">In (s)<input type="number" step="0.1" value=${c.in ?? 0} onInput=${(e) => updClip(c.id, { in: num(e.target.value) ?? 0 })} /></label>
                <label class="f">Out (s)<input type="number" step="0.1" value=${c.out ?? ""} placeholder="end" onInput=${(e) => updClip(c.id, { out: num(e.target.value) })} /></label></div>
                <div class="row"><button class="btn sm ghost" onClick=${() => setClips((cs) => cs.filter((x) => x.id !== c.id))}>Remove</button>${c.sheetUrl && html`<a class="sub" style="margin:0" href=${c.sheetUrl} target="_blank">contact sheet ↗</a>`}</div>
              </div>
            </div>`,
          )}
        </div>

        <div class="card stack">
          <h3>Story</h3>
          <label class="f">Hook (on screen from frame 0)<textarea value=${f.hook.text} onInput=${(e) => set("hook", { ...f.hook, text: e.target.value })}></textarea></label>
          ${v.brandInfo?.hookFormulas?.length > 0 && html`<div class="chips">${v.brandInfo.hookFormulas.map((h) => html`<button class="chip" title="Use this formula" onClick=${() => set("hook", { ...f.hook, text: h, formula: h })}>${h}</button>`)}</div>`}
          <label class="f">Emphasised words (part of the hook)<input type="text" value=${f.hook.emphasis || ""} onInput=${(e) => set("hook", { ...f.hook, emphasis: e.target.value })} /></label>
          <div class="grid3">
            <label class="f">Recipe card at (s)<input type="number" step="0.1" value=${f.blendAt ?? ""} placeholder=${v.plan?.recipeAt != null ? String(v.plan.recipeAt) : "auto"} onInput=${(e) => set("blendAt", num(e.target.value))} /></label>
            <label class="f">Face opens for (s)<input type="number" step="0.1" value=${f.faceSeconds} onInput=${(e) => set("faceSeconds", num(e.target.value) ?? 2.5)} /></label>
            <label class="f">Max length (s)<input type="number" step="1" value=${f.maxSeconds} onInput=${(e) => set("maxSeconds", num(e.target.value) ?? 60)} /></label>
          </div>
          <div class="grid2">
            <label class="f">Lower third title<input type="text" value=${f.lowerThird?.title || ""} placeholder="e.g. Bass swap" onInput=${(e) => set("lowerThird", e.target.value ? { ...(f.lowerThird || {}), title: e.target.value } : null)} /></label>
            <label class="f">Lower third subtitle<input type="text" value=${f.lowerThird?.subtitle || ""} placeholder="e.g. 16 bars" disabled=${!f.lowerThird} onInput=${(e) => set("lowerThird", { ...f.lowerThird, subtitle: e.target.value })} /></label>
          </div>
          <label class="f">End card call to action<input type="text" value=${f.endCard?.cta || ""} onInput=${(e) => set("endCard", { ...f.endCard, cta: e.target.value })} /></label>
          ${v.brandInfo?.ctas?.length > 0 && html`<div class="chips">${v.brandInfo.ctas.map((c) => html`<button class="chip" onClick=${() => set("endCard", { ...f.endCard, cta: c })}>${c}</button>`)}</div>`}
        </div>

        <div class="card stack">
          <div class="row" style="justify-content:space-between"><h3>Recipe card</h3>
            ${rec ? html`<button class="btn sm ghost" onClick=${() => set("recipe", null)}>Remove card</button>` : html`<button class="btn sm" onClick=${() => setRec({ tracks: [{ title: "", artist: "", meta: "" }, { title: "", artist: "", meta: "" }], steps: [""] })}>+ Add recipe card</button>`}
          </div>
          ${rec &&
          html`<div class="stack">
            <div class="grid2"><label class="f">Label<input type="text" value=${rec.label || ""} onInput=${(e) => setRec({ label: e.target.value })} /></label><label class="f">Title<input type="text" value=${rec.title || ""} onInput=${(e) => setRec({ title: e.target.value })} /></label></div>
            ${(rec.tracks || []).map(
              (t, i) => html`<div key=${i}>
                ${i > 0 && html`<label class="f step-in">↓ Transition ${i}<input type="text" value=${rec.steps?.[i - 1] || ""} placeholder="EQ blend, bass swap · 16 bars" onInput=${(e) => { const st = [...(rec.steps || [])]; st[i - 1] = e.target.value; setRec({ steps: st }); }} /></label>`}
                <div class="row"><span class="badge">${i + 1}</span>
                  <input type="text" style="flex:2;width:auto" placeholder="Track title" value=${t.title} onInput=${(e) => setRec({ tracks: rec.tracks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                  <input type="text" style="flex:1.2;width:auto" placeholder="Artist" value=${t.artist} onInput=${(e) => setRec({ tracks: rec.tracks.map((x, j) => (j === i ? { ...x, artist: e.target.value } : x)) })} />
                  <input type="text" style="flex:1;width:auto" placeholder="124 BPM · 5A" value=${t.meta} onInput=${(e) => setRec({ tracks: rec.tracks.map((x, j) => (j === i ? { ...x, meta: e.target.value } : x)) })} />
                  <button class="btn sm ghost" onClick=${() => setRec({ tracks: rec.tracks.filter((_, j) => j !== i), steps: (rec.steps || []).filter((_, j) => j !== Math.max(0, i - 1)) })}>✕</button></div>
              </div>`,
            )}
            <div class="row"><button class="btn sm" onClick=${() => setRec({ tracks: [...(rec.tracks || []), { title: "", artist: "", meta: "" }], steps: [...(rec.steps || []), ""] })}>+ Track</button>
            <label class="f" style="flex:1">Card CTA<input type="text" value=${rec.cta || ""} onInput=${(e) => setRec({ cta: e.target.value })} /></label></div>
          </div>`}
        </div>

        <div class="card stack">
          <div class="row" style="justify-content:space-between"><h3>On-screen text</h3><button class="btn sm" onClick=${() => set("captions", [...f.captions, { text: "", start: f.captions.length ? (f.captions.at(-1).end ?? 0) + 0.5 : 4, end: f.captions.length ? (f.captions.at(-1).end ?? 0) + 3 : 7 }])}>+ Text beat</button></div>
          <p class="sub" style="margin:0">Short lines shown in the brand's caption style, e.g. "bass swap on the drop". Times are seconds in the video.</p>
          ${f.captions.map(
            (c, i) => html`<div class="row" key=${i}>
              <input type="text" style="flex:3;width:auto" value=${c.text} placeholder="text" onInput=${(e) => set("captions", f.captions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <input type="number" style="width:80px" step="0.1" value=${c.start} onInput=${(e) => set("captions", f.captions.map((x, j) => (j === i ? { ...x, start: num(e.target.value) ?? 0 } : x)))} />
              <input type="number" style="width:80px" step="0.1" value=${c.end} onInput=${(e) => set("captions", f.captions.map((x, j) => (j === i ? { ...x, end: num(e.target.value) } : x)))} />
              <button class="btn sm ghost" onClick=${() => set("captions", f.captions.filter((_, j) => j !== i))}>✕</button>
            </div>`,
          )}
        </div>
        <div class="row end"><button class="btn" disabled=${!dirty} onClick=${guard(save)}>Save</button><button class="btn primary" disabled=${busy || !hasMain} onClick=${build}>${dirty ? "Save and rebuild" : v.plan ? "Rebuild from fields" : "Build draft"}</button></div>
      </div>
    </div>
  </div>`;
}

render(html`<${App} />`, document.getElementById("app"));
