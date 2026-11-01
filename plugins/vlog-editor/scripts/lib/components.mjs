// Brand components as HyperFrames sub-compositions, laid out per format (vertical 1080×1920, horizontal
// 1920×1080, square 1080×1080) from layoutFor(). Tokens are baked in at build time so each file is
// self-contained; per-use text comes from composition variables (data-variable-values on the host).
// Captions read WORDS between the @words markers; the recipe card reads RECIPE between the @recipe markers.
// Each component's composition id is its file name (brand-hook, …); the video engine copies a component per
// overlay and renames that id, so one video can mount several of the same kind.
import { cssVariables, captionCss, logoCss, logoHtml, recipeCss, layoutFor } from "./brand.mjs";
import { escapeHtml, escapeHtml as esc } from "./util.mjs";

export const COMPONENT_IDS = ["brand-hook", "brand-captions", "brand-lower-third", "brand-end-card", "brand-recipe-card"];

const vars = (list) => escapeAttr(JSON.stringify(list));
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/'/g, "&#39;");
}

function frame(id, { variables = [], css, body, script, fontsCss, b, L, rootVars = "" }) {
  return `<template>
  <style>
${fontsCss}
    #root {
${cssVariables(b).replace(/^/gm, "  ")}
${rootVars}
      position: absolute;
      inset: 0;
      overflow: visible;
    }
${css}
  </style>
  <div id="root" data-composition-id="${id}" data-width="${L.W}" data-height="${L.H}"${variables.length ? ` data-composition-variables='${vars(variables)}'` : ""}>
${body}
  </div>
  <script>
    (function () {
      window.__timelines = window.__timelines || {};
      var V = (window.__hyperframes && window.__hyperframes.getVariables && window.__hyperframes.getVariables()) || {};
      var M = ${JSON.stringify(motionOf(b))};
${script}
      window.__timelines["${id}"] = tl;
    })();
  </script>
</template>
`;
}

function motionOf(b) {
  return { ease: b.motion.ease, d: b.motion.durations, energy: b.motion.energy };
}

/** Hook title: on screen at frame 0 (the thumbnail), settles, emphasis pops, leaves before the scene ends. */
export function hookComponent(b, fontsCss, format = "vertical") {
  const L = layoutFor(b, format);
  const h = L.hook;
  const wf = b.fonts.display.widthFactor ?? 0.5;
  const maxW = L.W - h.left - h.right;
  const scrim =
    h.scrim === "left"
      ? `left: 0; top: 0; bottom: 0; width: ${Math.round(L.W * 0.68)}px; background: linear-gradient(90deg, color-mix(in srgb, var(--color-ground) 82%, transparent) 0%, color-mix(in srgb, var(--color-ground) 60%, transparent) 55%, transparent 100%);`
      : `left: 0; right: 0; top: 0; height: ${Math.round(Math.min(L.H * 0.56, 1050))}px; background: linear-gradient(180deg, color-mix(in srgb, var(--color-ground) 82%, transparent) 0%, color-mix(in srgb, var(--color-ground) 62%, transparent) 50%, transparent 100%);`;
  return frame("brand-hook", {
    b,
    L,
    fontsCss,
    variables: [
      { id: "hook", type: "string", label: "Hook line", default: b.samples.hook, maxLength: 90 },
      { id: "emphasis", type: "string", label: "Emphasised words", default: b.samples.hookEmphasis || "" },
    ],
    css: `
    #root .hook-scrim { position: absolute; ${scrim} }
    #root .hook-wrap { position: absolute; top: ${h.top}px; left: ${h.left}px; right: ${h.right}px; transform-origin: 0% 0%; }
    #root .hook { font-family: var(--font-display); font-weight: var(--display-weight); text-transform: var(--display-transform); letter-spacing: var(--display-tracking); line-height: var(--display-leading); color: var(--color-ink); text-wrap: balance; text-shadow: 0 6px 30px rgba(0,0,0,.35); }
    #root .hook em { font-style: normal; color: var(--color-highlight); display: inline-block; }`,
    body: `    <div class="hook-scrim" id="hook-scrim"></div>
    <div class="hook-wrap" id="hook-wrap"><h1 class="hook" id="hook-text"></h1></div>`,
    script: `
      var text = String(V.hook || ${JSON.stringify(b.samples.hook)});
      var emph = String(V.emphasis || "");
      var el = document.getElementById("hook-text");
      // Size: largest that fits ${h.lines} lines, from the face's width factor (deterministic, no font metrics needed).
      var size = ${h.min}, words = text.split(/\\s+/);
      for (var s = ${h.max}; s >= ${h.min}; s -= 2) {
        var per = ${maxW} / (s * ${wf}), n = 1, cur = 0, bad = false;
        for (var i = 0; i < words.length; i++) { var L = words[i].length + (cur ? 1 : 0); if (words[i].length > per) bad = true; if (cur + L > per && cur > 0) { n++; cur = words[i].length; } else cur += L; }
        if (!bad && n <= ${h.lines}) { size = s; break; }
      }
      el.style.fontSize = size + "px";
      var esc = function (t) { return t.replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); };
      var lo = text.toLocaleLowerCase(), at = emph ? lo.indexOf(emph.toLocaleLowerCase()) : -1;
      el.innerHTML = at < 0 ? esc(text) : esc(text.slice(0, at)) + '<em id="hook-em">' + esc(text.slice(at, at + emph.length)) + "</em>" + esc(text.slice(at + emph.length));
      var dur = (window.__hyperframes && window.__hyperframes.duration) || 2.8;
      var tl = gsap.timeline({ paused: true });
      tl.fromTo("#hook-wrap", { scale: 1.06 }, { scale: 1, duration: M.d.slow, ease: M.ease.enter }, 0);
      // A small lift on the emphasised words: it never changes their width (a scale would eat the next space),
      // and frame 0 — the thumbnail — shows them at rest.
      if (document.getElementById("hook-em")) tl.to("#hook-em", { y: -8, duration: M.d.fast, ease: "power2.out" }, 0.25).to("#hook-em", { y: 0, duration: M.d.base, ease: M.ease.pop });
      tl.to("#hook-wrap", { opacity: 0, y: -40, duration: M.d.base, ease: M.ease.exit }, Math.max(0.6, dur - M.d.base - 0.05));
      tl.to("#hook-scrim", { opacity: 0, duration: M.d.base, ease: M.ease.exit }, Math.max(0.6, dur - M.d.base - 0.05));`,
  });
}

/** Captions: groups of words, one visible at a time, the spoken word marked in the brand's caption style. */
export function captionsComponent(b, fontsCss, format = "vertical", words) {
  const L = layoutFor(b, format);
  const c = L.cap;
  const max = Math.max(...[].concat(b.captions.wordsPerGroup || [3]));
  const sample = words || defaultWords(b.samples.caption);
  return frame("brand-captions", {
    b,
    L,
    fontsCss,
    rootVars: `      --pad-x: ${c.left}px;\n      --rail-right: ${c.right}px;\n      --cap-bottom: ${c.bottom}px;\n      --cap-size: ${c.size}px;`,
    css: `
${captionCss("#root").replace(/^/gm, "    ")}
    #root .cap-group { opacity: 0; visibility: hidden; }`,
    body: `    <div id="cap-layer"></div>`,
    script: `
      // @words-start — the video workflow replaces this array ([{text,start,end}], seconds, scene-local)
      var WORDS = ${JSON.stringify(sample)};
      // @words-end
      var STYLE = ${JSON.stringify(b.captions.style)}, MAXW = ${max}, BASE = ${c.size}, MIN = ${Math.round((b.captions.minSize ?? 48) * (c.size / (b.captions.size || 84)))};
      var ACTIVE = getComputedStyle(document.getElementById("cap-layer")).getPropertyValue("--cap-active").trim() || ${JSON.stringify(b.colors.highlight)};
      var TEXT = ${JSON.stringify(b.colors.captionText)}, ONBOX = ${JSON.stringify(b.derived.onCaptionBox)};
      var BASE_INK = STYLE === "pill" ? ONBOX : TEXT, ACTIVE_INK = STYLE === "highlight" ? ONBOX : ACTIVE;
      var groups = [], cur = [];
      for (var i = 0; i < WORDS.length; i++) {
        var w = WORDS[i], nx = WORDS[i + 1];
        cur.push(w);
        if (cur.length >= (STYLE === "kinetic" ? 1 : MAXW) || /[.!?,;:]$/.test(w.text) || !nx || nx.start - w.end >= 0.15) { groups.push(cur); cur = []; }
      }
      var layer = document.getElementById("cap-layer");
      var cv = document.createElement("canvas").getContext("2d");
      var tl = gsap.timeline({ paused: true });
      groups.forEach(function (g, gi) {
        var el = document.createElement("div");
        el.className = "cap-group"; el.id = "cap-g" + gi; el.setAttribute("data-cap-style", STYLE);
        var line = g.map(function (w) { return w.text; }).join(" ");
        var cs = getComputedStyle(layer), fam = cs.getPropertyValue(STYLE === "kinetic" ? "--font-display" : "--font-caption"), wt = cs.getPropertyValue(STYLE === "kinetic" ? "--display-weight" : "--cap-weight");
        var tr = cs.getPropertyValue("--cap-transform").trim(), shown = tr === "uppercase" ? line.toLocaleUpperCase() : line;
        var scale = STYLE === "kinetic" ? 1.6 : STYLE === "pill" ? 0.72 : STYLE === "clean" ? 0.78 : 1;
        var size = BASE * scale, maxW = ${L.W - c.left - c.right - 40};
        while (size > MIN * scale) { cv.font = wt + " " + size + "px " + fam; if (cv.measureText(shown).width <= maxW * 1.9) break; size -= 2; }
        el.style.setProperty("--cap-size", (size / scale) + "px");
        g.forEach(function (w, wi) {
          var s = document.createElement("span"); s.className = "cap-word"; s.id = "cap-w" + gi + "-" + wi;
          s.innerHTML = '<span class="cap-bg"></span><span class="cap-txt"></span>';
          s.lastChild.textContent = w.text;
          el.appendChild(s); el.appendChild(document.createTextNode(" "));
        });
        layer.appendChild(el);
        var gs = Math.max(0.1, g[0].start - 0.04), next = groups[gi + 1];
        var ge = Math.max(gs + 0.25, next ? Math.min(g[g.length - 1].end + 0.1, next[0].start - 0.03) : g[g.length - 1].end + 0.25);
        tl.set(el, { visibility: "visible" }, gs);
        tl.fromTo(el, { opacity: 0, y: 18, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: M.d.fast, ease: M.ease.pop }, gs);
        g.forEach(function (w, wi) {
          var word = document.getElementById("cap-w" + gi + "-" + wi), bg = word.firstChild, txt = word.lastChild;
          var on = Math.max(gs, w.start), off = Math.min(ge, Math.max(w.end, on + 0.12));
          if (STYLE === "highlight" || STYLE === "clean") { tl.fromTo(bg, { opacity: 0 }, { opacity: 1, duration: 0.06 }, on); tl.to(bg, { opacity: 0, duration: 0.06 }, off); }
          if (STYLE !== "clean") { tl.fromTo(txt, { color: BASE_INK }, { color: ACTIVE_INK, duration: 0.06 }, on); tl.to(txt, { color: BASE_INK, duration: 0.06 }, off); }
          if (STYLE === "outline" || STYLE === "kinetic") { tl.fromTo(word, { scale: 1 }, { scale: 1.12, duration: M.d.fast, ease: M.ease.pop }, on); tl.to(word, { scale: 1, duration: M.d.fast }, off); }
        });
        tl.to(el, { opacity: 0, duration: 0.12, ease: M.ease.exit }, ge - 0.12);
        tl.set(el, { opacity: 0, visibility: "hidden" }, ge);
      });`,
  });
}

export function defaultWords(text, start = 0.15, per = 0.32) {
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => ({ text: t, start: +(start + i * per).toFixed(2), end: +(start + i * per + per - 0.04).toFixed(2) }));
}

/** Lower third: place or topic chip. */
export function lowerThirdComponent(b, fontsCss, format = "vertical") {
  const L = layoutFor(b, format);
  const lt = L.lt;
  const px = (n) => `${Math.round(n * (L.k || 1))}px`;
  return frame("brand-lower-third", {
    b,
    L,
    fontsCss,
    variables: [
      { id: "title", type: "string", label: "Title", default: b.samples.lowerThird?.title || "", maxLength: 40 },
      { id: "subtitle", type: "string", label: "Subtitle", default: b.samples.lowerThird?.subtitle || "", maxLength: 60 },
    ],
    css: `
    #root .lt { position: absolute; left: ${lt.left}px; top: ${lt.top}px; max-width: ${lt.maxWidth}px; display: flex; align-items: stretch; gap: ${px(22)}; padding: ${px(22)} ${px(34)} ${px(24)} ${px(24)}; background: color-mix(in srgb, var(--color-surface) 90%, transparent); border-radius: ${px(26)}; }
    #root .lt-bar { width: ${px(10)}; border-radius: ${px(6)}; background: var(--color-accent); }
    #root .lt-title { font-family: var(--font-display); font-weight: var(--display-weight); text-transform: var(--display-transform); letter-spacing: var(--display-tracking); font-size: ${px(62)}; line-height: 1; color: var(--color-ink); }
    #root .lt-sub { font-family: var(--font-body); font-weight: 700; font-size: ${px(30)}; line-height: 1.2; color: var(--color-muted); margin-top: ${px(8)}; }`,
    body: `    <div class="lt" id="lt"><div class="lt-bar" id="lt-bar"></div><div><div class="lt-title" id="lt-title"></div><div class="lt-sub" id="lt-sub"></div></div></div>`,
    script: `
      document.getElementById("lt-title").textContent = String(V.title || "");
      document.getElementById("lt-sub").textContent = String(V.subtitle || "");
      var dur = (window.__hyperframes && window.__hyperframes.duration) || 3;
      var tl = gsap.timeline({ paused: true });
      tl.fromTo("#lt", { clipPath: "inset(0% 100% 0% 0% round 26px)" }, { clipPath: "inset(0% 0% 0% 0% round 26px)", duration: M.d.base, ease: M.ease.enter }, 0.05);
      tl.fromTo("#lt-title", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: M.d.base, ease: M.ease.enter }, 0.15);
      tl.fromTo("#lt-sub", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: M.d.base, ease: M.ease.enter }, 0.22);
      tl.to("#lt", { clipPath: "inset(0% 0% 0% 100% round 26px)", duration: M.d.base, ease: M.ease.exit }, Math.max(0.8, dur - M.d.base - 0.05));`,
  });
}

/** End card: logo, call to action, handle — the last beat. On YouTube it also leaves room for end-screen elements. */
export function endCardComponent(b, fontsCss, format = "vertical") {
  const L = layoutFor(b, format);
  const e = L.end;
  const handle = b.handles?.tiktok || b.handles?.instagram || b.handles?.youtube || "";
  return frame("brand-end-card", {
    b,
    L,
    fontsCss,
    variables: [
      { id: "cta", type: "string", label: "Call to action", default: b.samples.cta || "", maxLength: 60 },
      { id: "handle", type: "string", label: "Handle", default: handle },
    ],
    css: `
${logoCss("#root").replace(/^/gm, "    ")}
    #root .ec-bg { position: absolute; inset: 0; background: var(--color-ground); }
    #root .ec-glow { position: absolute; inset: 0; background: radial-gradient(${Math.round(Math.min(L.W, L.H) * 0.7)}px ${Math.round(Math.min(L.W, L.H) * 0.7)}px at 50% 42%, color-mix(in srgb, var(--color-primary) 30%, transparent), transparent 70%); }
    #root .ec { position: absolute; left: 96px; right: 96px; top: ${e.top}px; display: flex; flex-direction: column; align-items: center; gap: ${e.gap}px; text-align: center; }
    #root .ec-cta { font-family: var(--font-display); font-weight: var(--display-weight); text-transform: var(--display-transform); letter-spacing: var(--display-tracking); line-height: var(--display-leading); font-size: ${e.cta}px; color: var(--color-ink); }
    #root .ec-handle { font-family: var(--font-body); font-weight: 700; font-size: ${Math.round(40 * (L.k || 1))}px; color: var(--color-muted); }`,
    body: `    <div class="ec-bg"></div><div class="ec-glow" id="ec-glow"></div>
    <div class="ec"><div id="ec-logo">${logoHtml(b, b.logo.style, Math.round((format === "vertical" ? 120 : 104) * (L.k || 1)))}</div><div class="ec-cta" id="ec-cta"></div><div class="ec-handle" id="ec-handle"></div></div>`,
    script: `
      document.getElementById("ec-cta").textContent = String(V.cta || "");
      document.getElementById("ec-handle").textContent = String(V.handle || "");
      var tl = gsap.timeline({ paused: true });
      tl.fromTo("#ec-glow", { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: M.d.slow, ease: M.ease.enter }, 0);
      tl.fromTo("#ec-logo", { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: M.d.base, ease: M.ease.pop }, 0.05);
      tl.fromTo("#ec-cta", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: M.d.base, ease: M.ease.enter }, 0.2);
      tl.fromTo("#ec-handle", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: M.d.base, ease: M.ease.enter }, 0.32);`,
  });
}

/** Recipe card: items joined by steps (DJ: tracks joined by transitions). Data between the @recipe markers. */
export function recipeCardComponent(b, fontsCss, format = "vertical") {
  const L = layoutFor(b, format);
  const r = L.recipe;
  const sample = b.samples.recipe || {
    label: "Recipe",
    title: "Step by step",
    tracks: [{ title: "First", artist: "", meta: "" }, { title: "Second", artist: "", meta: "" }],
    steps: ["then"],
    cta: b.samples.cta || "",
  };
  const place = `left:${r.left == null ? "auto" : r.left + "px"};right:${r.right == null ? "auto" : r.right + "px"};${r.width ? `width:${r.width}px;` : ""}`;
  return frame("brand-recipe-card", {
    b,
    L,
    fontsCss,
    variables: [{ id: "top", type: "number", label: "Top (px)", default: r.top, min: 40, max: L.H - 300 }],
    css: `
${logoCss("#root").replace(/^/gm, "    ")}
${recipeCss("#root", L.k || 1).replace(/^/gm, "    ")}`,
    body: `    <div id="rc-host"></div>`,
    script: `
      // @recipe-start — the video workflow replaces this object ({label, title, tracks:[{title,artist,meta}], steps:[], cta})
      var RECIPE = ${JSON.stringify(sample)};
      // @recipe-end
      var esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
      var LOGO = ${JSON.stringify(logoHtml(b, b.logo.style, Math.round(34 * (L.k || 1))))};
      var rows = [];
      (RECIPE.tracks || []).forEach(function (t, i) {
        if (i > 0) rows.push('<div class="rc-step" id="rc-s' + i + '"><i>↓</i>' + esc((RECIPE.steps || [])[i - 1] || "") + "</div>");
        rows.push('<div class="rc-track" id="rc-t' + i + '"><div class="rc-num">' + (i + 1) + "</div><div><b>" + esc(t.title) + "</b><span>" + esc([t.artist, t.meta].filter(Boolean).join(" · ")) + "</span></div></div>");
      });
      var host = document.getElementById("rc-host");
      host.innerHTML = '<div class="rc" id="rc" style="top:' + Number(V.top || ${r.top}) + 'px;${place}">' + (RECIPE.label ? '<div class="rc-label">' + esc(RECIPE.label) + "</div>" : "") + (RECIPE.title ? '<div class="rc-title">' + esc(RECIPE.title) + "</div>" : "") + rows.join("") + '<div class="rc-foot">' + LOGO + (RECIPE.cta ? "<b>" + esc(RECIPE.cta) + "</b>" : "") + "</div></div>";
      var dur = (window.__hyperframes && window.__hyperframes.duration) || 4;
      var tl = gsap.timeline({ paused: true });
      tl.fromTo("#rc", { opacity: 0, y: 60, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: M.d.base, ease: M.ease.enter }, 0.05);
      var n = (RECIPE.tracks || []).length;
      for (var i = 0; i < n; i++) {
        var at = 0.25 + i * 0.32;
        tl.fromTo("#rc-t" + i, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: M.d.base, ease: M.ease.enter }, at);
        if (i > 0) tl.fromTo("#rc-s" + i, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: M.d.fast, ease: M.ease.pop }, at - 0.14);
      }
      tl.to("#rc", { opacity: 0, y: -40, duration: M.d.base, ease: M.ease.exit }, Math.max(1.2, dur - M.d.base - 0.05));`,
  });
}

/** Every component for one format, keyed by file name. */
export function componentsFor(b, fontsCss, format = "vertical") {
  return {
    "brand-hook.html": hookComponent(b, fontsCss, format),
    "brand-captions.html": captionsComponent(b, fontsCss, format),
    "brand-lower-third.html": lowerThirdComponent(b, fontsCss, format),
    "brand-end-card.html": endCardComponent(b, fontsCss, format),
    "brand-recipe-card.html": recipeCardComponent(b, fontsCss, format),
  };
}

/** Still compositions for logo exports: avatar (1:1 profile picture) and wordmark. */
export function logoStillHtml(b, fontsCss, kind) {
  const isAvatar = kind === "avatar";
  const w = isAvatar ? 1080 : 1600;
  const h = isAvatar ? 1080 : 600;
  const style = isAvatar ? (b.logo.style.startsWith("monogram") ? b.logo.style : b.logo.style.includes("square") ? "monogram-square" : "monogram-circle") : b.logo.style;
  const size = isAvatar ? 620 : 150;
  const bg = isAvatar ? "var(--color-ground)" : "transparent";
  return `<!doctype html>
<html lang="${esc((b.languages || ["en"])[0])}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${w}, height=${h}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
${fontsCss}
      :root {
${cssVariables(b)}
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: ${bg}; }
      #still { position: relative; width: ${w}px; height: ${h}px; display: grid; place-items: center; background: ${bg}; }
${logoCss()}
      ${isAvatar ? "#still .logo-mark { width: 2.4em; height: 2.4em; } #still .logo-mark.is-circle, #still .logo-mark.is-square { border-radius: 0; width: " + w + "px; height: " + h + "px; font-size: " + size + "px; } #still .logo { font-size: 1px; }" : ""}
    </style>
  </head>
  <body>
    <div id="still" data-composition-id="still" data-start="0" data-duration="1" data-width="${w}" data-height="${h}">
      ${isAvatar ? avatarMark(b, size) : logoHtml(b, style, size)}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["still"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

/** Profile-picture mark: wordmark-dot brands get "monogram." on the ground; others a monogram on primary. */
function avatarMark(b, size) {
  if (b.logo.style === "wordmark-dot")
    return `<span class="logo" style="font-size:${Math.round(size * 0.62)}px"><span>${escapeHtml(b.logo.monogram)}<span class="logo-dot"></span></span></span>`;
  return `<span class="logo"><span class="logo-mark is-square" style="font-size:${size}px"><span>${escapeHtml(b.logo.monogram)}</span></span></span>`;
}
