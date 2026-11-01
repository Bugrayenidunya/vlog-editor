// brand.json (schema vlog-editor/brand@1): defaults, validation and the CSS/HTML every renderer shares.
import { contrast, escapeHtml, readJson } from "./util.mjs";

export const SCHEMA = "vlog-editor/brand@1";

// Platform UI on 1080×1920 (HyperFrames vertical guide): nothing in the top 168 px, words inside
// 168–1330 px, no text under the right-hand action rail, burned-in captions ~600–700 px from the bottom.
export const DEFAULTS = {
  schema: SCHEMA,
  name: "Untitled",
  tagline: "",
  handles: {},
  languages: ["en"],
  colors: {
    ground: "#0F0F12",
    surface: "#1B1B21",
    ink: "#FFFFFF",
    muted: "#A3A3AD",
    primary: "#FF4D2E",
    accent: "#FFD23F",
    highlight: "#FFD23F",
    captionText: "#FFFFFF",
    captionStroke: "#000000",
    captionBox: "#FFD23F",
  },
  fonts: {
    display: { family: "Anton", weights: [400], transform: "uppercase", tracking: "0", lineHeight: 0.95, widthFactor: 0.46 },
    body: { family: "Inter", weights: [400, 700], tracking: "0", lineHeight: 1.25 },
    caption: { family: "Montserrat", weight: 800, transform: "uppercase", tracking: "0.01em" },
  },
  captions: { style: "highlight", wordsPerGroup: [2, 3], size: 84, minSize: 48, position: "lower", radius: 14, strokeWidth: 8, shadow: true },
  logo: { style: "wordmark-dot", text: null, monogram: null, case: "as-is" },
  motion: {
    energy: "balanced",
    ease: { enter: "power3.out", exit: "power2.in", pop: "back.out(1.7)" },
    durations: { fast: 0.18, base: 0.32, slow: 0.6 },
    transitions: ["punch-in", "hard-cut"],
    pace: { shotSeconds: [1, 2], firstCutBy: 1.5 },
  },
  look: { grade: "neutral", luma: null, contrast: null, saturation: null, warmth: null },
  layout: { width: 1080, height: 1920, safeTop: 168, textBottom: 1330, railRight: 150, padX: 72, captionBottom: 650 },
  sound: { enabled: false, music: { moods: [], genres: [], bpm: null, lufs: -14, vocals: "instrumental" }, sting: { description: "", file: null }, sfx: {}, voice: { style: "" } },
  voice: { tone: [], do: [], dont: [], hookFormulas: [], ctas: [], hashtags: [] },
  samples: { hook: "The one thing nobody tells you", hookEmphasis: "nobody", caption: "this is where everything changed", captionActive: 3, lowerThird: { title: "Somewhere", subtitle: "City, Country" }, cta: "Follow for part 2" },
};

const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
export function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = v === null && isObj(base[k]) ? base[k] : merge(base[k], v);
  return out;
}

export function withDefaults(brand) {
  const b = merge(DEFAULTS, brand || {});
  const lang = (b.languages || ["en"])[0];
  b.logo.text = b.logo.text || b.name;
  b.logo.monogram = b.logo.monogram || initials(b.name, lang);
  b.derived = derive(b);
  return b;
}

export async function loadBrand(file) {
  return withDefaults(await readJson(file));
}

function initials(name, lang = "en") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  // Locale matters: Turkish uppercases i → İ, English → I.
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "?")[0]).toLocaleUpperCase(lang);
}

/** Pick whichever of the candidates reads best on `bg`. */
export function bestOn(bg, candidates) {
  return [...candidates].sort((a, b) => contrast(b, bg) - contrast(a, bg))[0];
}

function derive(b) {
  const c = b.colors;
  const pool = [c.ink, c.ground, "#FFFFFF", "#0B0B0B"];
  return {
    onPrimary: bestOn(c.primary, pool),
    onAccent: bestOn(c.accent, pool),
    onHighlight: bestOn(c.highlight, pool),
    onCaptionBox: bestOn(c.captionBox, pool),
  };
}

const DEFAULT_LOOKS = ["Inter", "Space Grotesk", "Instrument Serif", "Geist", "JetBrains Mono"];

/** Problems worth fixing before a brand ships. level: error | warn */
export function validateBrand(b) {
  const issues = [];
  const c = b.colors;
  const need = (pair, min, label, level = "error") => {
    const r = contrast(pair[0], pair[1]);
    if (r < min) issues.push({ level, msg: `${label} contrast ${r.toFixed(2)}:1 < ${min}:1 (${pair[0]} on ${pair[1]})` });
  };
  need([c.ink, c.ground], 7, "ink on ground", "warn");
  need([c.ink, c.ground], 4.5, "ink on ground");
  need([c.muted, c.ground], 3, "muted on ground", "warn");
  need([b.derived.onPrimary, c.primary], 4.5, "text on primary", "warn");
  need([b.derived.onAccent, c.accent], 4.5, "text on accent", "warn");
  if (b.captions.style === "highlight" || b.captions.style === "pill") need([b.derived.onCaptionBox, c.captionBox], 4.5, "caption text on caption box");
  if (b.captions.style === "outline") need([c.captionText, c.captionStroke], 7, "caption text on stroke", "warn");
  if (DEFAULT_LOOKS.includes(b.fonts.display.family)) issues.push({ level: "warn", msg: `display face ${b.fonts.display.family} is a generated-design default; fine if chosen on purpose` });
  if (!b.name || b.name === "Untitled") issues.push({ level: "warn", msg: "brand has no name yet" });
  return issues;
}

export function fontFamilies(b) {
  const map = new Map();
  const add = (family, weights) => {
    if (!family) return;
    const w = map.get(family) || new Set();
    [].concat(weights || [400]).forEach((x) => w.add(Number(x)));
    map.set(family, w);
  };
  add(b.fonts.display.family, b.fonts.display.weights);
  add(b.fonts.body.family, b.fonts.body.weights);
  add(b.fonts.caption.family, [b.fonts.caption.weight || 800]);
  return [...map.entries()].map(([family, w]) => ({ family, weights: [...w].sort((a, z) => a - z) }));
}

const q = (family) => `"${family}"`;

export function cssVariables(b) {
  const c = b.colors;
  const f = b.fonts;
  const d = b.derived;
  const lines = {
    "color-ground": c.ground,
    "color-surface": c.surface,
    "color-ink": c.ink,
    "color-muted": c.muted,
    "color-primary": c.primary,
    "color-accent": c.accent,
    "color-highlight": c.highlight,
    "color-on-primary": d.onPrimary,
    "color-on-accent": d.onAccent,
    "color-on-highlight": d.onHighlight,
    "font-display": `${q(f.display.family)}, sans-serif`,
    "font-body": `${q(f.body.family)}, sans-serif`,
    "font-caption": `${q(f.caption.family)}, sans-serif`,
    "display-transform": f.display.transform || "none",
    "display-tracking": f.display.tracking || "0",
    "display-leading": f.display.lineHeight ?? 1,
    "display-weight": Math.max(...[].concat(f.display.weights || [400])),
    "cap-text": c.captionText,
    "cap-stroke": c.captionStroke,
    "cap-box": c.captionBox,
    "cap-box-ink": d.onCaptionBox,
    "cap-active": c.highlight,
    "cap-size": `${b.captions.size}px`,
    "cap-weight": f.caption.weight || 800,
    "cap-transform": f.caption.transform || "none",
    "cap-tracking": f.caption.tracking || "0",
    "cap-radius": `${b.captions.radius ?? 12}px`,
    "cap-stroke-width": `${b.captions.strokeWidth ?? 8}px`,
    "safe-top": `${b.layout.safeTop}px`,
    "text-bottom": `${b.layout.textBottom}px`,
    "rail-right": `${b.layout.railRight}px`,
    "pad-x": `${b.layout.padX}px`,
    "cap-bottom": `${b.layout.captionBottom}px`,
  };
  return Object.entries(lines).map(([k, v]) => `  --${k}: ${v};`).join("\n");
}

/**
 * Caption styles. Markup per word: <span class="cap-word"><span class="cap-bg"></span><span class="cap-txt">word</span></span>
 * Active state = .cap-bg opacity 1 + .cap-txt colour — both tweenable, so captions stay seekable.
 */
export function captionCss(scope = "") {
  const s = scope ? scope + " " : "";
  return `
${s}.cap-group { position: absolute; left: var(--pad-x); right: var(--rail-right); bottom: var(--cap-bottom); display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-end; gap: 0.12em 0.22em; text-align: center; overflow: visible; }
${s}.cap-word { position: relative; display: inline-block; font-family: var(--font-caption); font-weight: var(--cap-weight); font-size: var(--cap-size); line-height: 1.04; text-transform: var(--cap-transform); letter-spacing: var(--cap-tracking); color: var(--cap-text); padding: 0.06em 0.16em 0.1em; }
${s}.cap-bg { position: absolute; inset: 0; border-radius: var(--cap-radius); opacity: 0; z-index: 0; }
${s}.cap-txt { position: relative; z-index: 1; }
/* highlight: heavy caps, active word sits on a solid box */
${s}[data-cap-style="highlight"] .cap-word { text-shadow: 0 6px 22px rgba(0,0,0,.45); }
${s}[data-cap-style="highlight"] .cap-bg { background: var(--cap-box); }
${s}[data-cap-style="highlight"] .is-active .cap-bg { opacity: 1; }
${s}[data-cap-style="highlight"] .is-active .cap-txt { color: var(--cap-box-ink); text-shadow: none; }
/* pill: the whole group on a soft pill, active word coloured */
${s}[data-cap-style="pill"] { width: fit-content; margin-inline: auto; background: color-mix(in srgb, var(--cap-box) 92%, transparent); border-radius: 999px; padding: 18px 34px 20px; }
${s}[data-cap-style="pill"] .cap-word { color: var(--cap-box-ink); font-size: calc(var(--cap-size) * 0.72); padding: 0 0.05em; }
${s}[data-cap-style="pill"] .is-active .cap-txt { color: var(--cap-active); }
/* outline: classic stroked caps, active word coloured and scaled */
${s}[data-cap-style="outline"] .cap-txt { -webkit-text-stroke: var(--cap-stroke-width) var(--cap-stroke); paint-order: stroke fill; }
${s}[data-cap-style="outline"] .is-active .cap-txt { color: var(--cap-active); }
${s}[data-cap-style="outline"] .is-active { transform: scale(1.12); }
/* clean: calm sentence case with a soft shadow, active word underlined */
${s}[data-cap-style="clean"] .cap-word { text-shadow: 0 2px 14px rgba(0,0,0,.55); font-size: calc(var(--cap-size) * 0.78); }
${s}[data-cap-style="clean"] .cap-bg { top: auto; bottom: 0.04em; height: 0.14em; border-radius: 99px; background: var(--cap-active); }
${s}[data-cap-style="clean"] .is-active .cap-bg { opacity: 1; }
/* kinetic: one or two huge words, display face */
${s}[data-cap-style="kinetic"] { bottom: calc(var(--cap-bottom) + 40px); }
${s}[data-cap-style="kinetic"] .cap-word { font-family: var(--font-display); font-weight: var(--display-weight); text-transform: var(--display-transform); font-size: calc(var(--cap-size) * 1.6); line-height: var(--display-leading); text-shadow: 0 8px 30px rgba(0,0,0,.5); }
${s}[data-cap-style="kinetic"] .is-active .cap-txt { color: var(--cap-active); }
`.trim();
}

export function captionWordsHtml(words, activeIndex = -1, idPrefix = "") {
  return words
    .map((w, i) => `<span class="cap-word${i === activeIndex ? " is-active" : ""}"${idPrefix ? ` id="${idPrefix}${i}"` : ""}><span class="cap-bg"></span><span class="cap-txt">${escapeHtml(w)}</span></span>`)
    .join(" ");
}

function caseText(text, mode, lang = "en") {
  if (mode === "upper") return text.toLocaleUpperCase(lang);
  if (mode === "lower") return text.toLocaleLowerCase(lang);
  return text;
}

export function logoCss(scope = "") {
  const s = scope ? scope + " " : "";
  return `
${s}.logo { display: inline-flex; align-items: center; gap: 0.32em; font-family: var(--font-display); font-weight: var(--display-weight); letter-spacing: var(--display-tracking); line-height: 1; color: var(--color-ink); white-space: nowrap; }
${s}.logo-dot { display: inline-block; width: 0.2em; height: 0.2em; border-radius: 50%; background: var(--color-accent); margin-left: 0.07em; vertical-align: baseline; }
${s}.logo-underline { display: inline-flex; flex-direction: column; align-items: stretch; gap: 0.08em; }
${s}.logo-underline .logo-bar { height: 0.12em; background: var(--color-accent); border-radius: 0.06em; }
${s}.logo-mark { display: inline-grid; place-items: center; width: 1.6em; height: 1.6em; background: var(--color-primary); color: var(--color-on-primary); font-size: 1em; letter-spacing: 0; }
${s}.logo-mark.is-circle { border-radius: 50%; }
${s}.logo-mark.is-square { border-radius: 22%; }
${s}.logo-mark span { font-size: 0.78em; transform: translateY(0.02em); }
`.trim();
}

/** Logo as HTML (renders with the brand's own fonts in any composition). */
export function logoHtml(b, style = b.logo.style, size = 64, id = "") {
  const text = escapeHtml(caseText(b.logo.text, b.logo.case, (b.languages || ["en"])[0]));
  const mono = escapeHtml(b.logo.monogram);
  const idAttr = id ? ` id="${id}"` : "";
  const st = `font-size:${size}px`;
  const mark = (shape) => `<span class="logo-mark ${shape}"><span>${mono}</span></span>`;
  switch (style) {
    case "wordmark":
      return `<span class="logo"${idAttr} style="${st}">${text}</span>`;
    case "wordmark-underline":
      return `<span class="logo logo-underline"${idAttr} style="${st}"><span>${text}</span><span class="logo-bar"></span></span>`;
    case "monogram-circle":
      return `<span class="logo"${idAttr} style="${st}">${mark("is-circle")}</span>`;
    case "monogram-square":
      return `<span class="logo"${idAttr} style="${st}">${mark("is-square")}</span>`;
    case "lockup-circle":
      return `<span class="logo"${idAttr} style="${st}">${mark("is-circle")}<span>${text}</span></span>`;
    case "lockup-square":
      return `<span class="logo"${idAttr} style="${st}">${mark("is-square")}<span>${text}</span></span>`;
    case "wordmark-dot":
    default:
      return `<span class="logo"${idAttr} style="${st}"><span>${text}<span class="logo-dot"></span></span></span>`;
  }
}

export const LOGO_STYLES = ["wordmark", "wordmark-dot", "wordmark-underline", "monogram-circle", "monogram-square", "lockup-circle", "lockup-square"];
export const CAPTION_STYLES = ["highlight", "pill", "outline", "clean", "kinetic"];

/** Largest display size (px) that fits `text` in `lines` lines of `width` px, from the face's width factor. */
export function fitDisplaySize(text, { width = 920, lines = 3, max = 150, min = 72, widthFactor = 0.5 } = {}) {
  const words = String(text).split(/\s+/).filter(Boolean);
  for (let size = max; size >= min; size -= 2) {
    const perLine = width / (size * widthFactor);
    let n = 1;
    let cur = 0;
    for (const w of words) {
      const len = w.length + (cur ? 1 : 0);
      if (cur + len > perLine && cur > 0) {
        n++;
        cur = w.length;
      } else cur += len;
      if (w.length > perLine) n = Infinity;
    }
    if (n <= lines) return size;
  }
  return min;
}

/** Wrap the emphasis phrase in <em> (case-insensitive, first match). */
export function emphasize(text, phrase) {
  const safe = escapeHtml(text);
  if (!phrase) return safe;
  const p = escapeHtml(phrase);
  const i = safe.toLocaleLowerCase("tr").indexOf(p.toLocaleLowerCase("tr"));
  if (i < 0) return safe;
  return `${safe.slice(0, i)}<em>${safe.slice(i, i + p.length)}</em>${safe.slice(i + p.length)}`;
}

/**
 * Recipe card: an ordered list of items joined by steps (DJ: tracks joined by transitions; any niche: steps).
 * recipe = { label, title, tracks: [{ title, artist, meta }], steps: ["EQ blend, bass swap · 16 bars"], cta }
 */
export function recipeCss(scope = "", k = 1) {
  const s = scope ? scope + " " : "";
  const px = (n) => `${Math.round(n * k)}px`;
  return `
${s}.rc { position: absolute; left: var(--pad-x); right: var(--rail-right); background: var(--color-surface); border-radius: ${px(34)}; padding: ${px(30)} ${px(32)} ${px(24)}; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
${s}.rc-label { font-family: var(--font-body); font-weight: 700; font-size: ${px(28)}; letter-spacing: .14em; text-transform: uppercase; color: var(--color-muted); }
${s}.rc-title { font-family: var(--font-display); font-weight: var(--display-weight); text-transform: var(--display-transform); letter-spacing: var(--display-tracking); font-size: ${px(60)}; line-height: 1.02; color: var(--color-ink); margin: ${px(6)} 0 ${px(20)}; }
${s}.rc-track { display: flex; align-items: center; gap: ${px(20)}; }
${s}.rc-num { flex: none; width: ${px(84)}; height: ${px(84)}; border-radius: ${px(18)}; background: var(--color-primary); color: var(--color-on-primary); display: grid; place-items: center; font-family: var(--font-body); font-weight: 800; font-size: ${px(36)}; }
${s}.rc-track b { display: block; font-family: var(--font-body); font-weight: 700; font-size: ${px(36)}; line-height: 1.15; color: var(--color-ink); }
${s}.rc-track span { display: block; font-family: var(--font-body); font-weight: 500; font-size: ${px(28)}; line-height: 1.3; color: var(--color-muted); }
${s}.rc-step { display: flex; align-items: center; gap: ${px(14)}; margin: ${px(12)} 0 ${px(12)} ${px(20)}; font-family: var(--font-body); font-weight: 700; font-size: ${px(29)}; color: var(--color-accent); }
${s}.rc-step i { font-style: normal; font-size: ${px(34)}; line-height: 1; }
${s}.rc-foot { display: flex; justify-content: space-between; align-items: center; gap: ${px(16)}; margin-top: ${px(20)}; padding-top: ${px(16)}; border-top: 2px solid color-mix(in srgb, var(--color-ink) 10%, transparent); font-family: var(--font-body); font-weight: 700; font-size: ${px(28)}; color: var(--color-muted); }
${s}.rc-foot b { color: var(--color-highlight); }
`.trim();
}

export function recipeHtml(b, r, { idPrefix = "rc", logoSize = 34 } = {}) {
  if (!r) return "";
  const rows = [];
  (r.tracks || []).forEach((t, i) => {
    if (i > 0) rows.push(`<div class="rc-step" id="${idPrefix}-s${i}"><i>↓</i>${escapeHtml(r.steps?.[i - 1] || "")}</div>`);
    rows.push(`<div class="rc-track" id="${idPrefix}-t${i}"><div class="rc-num">${i + 1}</div><div><b>${escapeHtml(t.title)}</b><span>${escapeHtml([t.artist, t.meta].filter(Boolean).join(" · "))}</span></div></div>`);
  });
  return `<div class="rc" id="${idPrefix}">${r.label ? `<div class="rc-label">${escapeHtml(r.label)}</div>` : ""}${r.title ? `<div class="rc-title">${escapeHtml(r.title)}</div>` : ""}${rows.join("")}<div class="rc-foot">${logoHtml(b, b.logo.style, logoSize)}${r.cta ? `<b>${escapeHtml(r.cta)}</b>` : ""}</div></div>`;
}

// ---------------- formats ----------------
// One edit can be rendered in several formats; every brand component lays itself out from this table.
export const FORMATS = {
  vertical: { W: 1080, H: 1920, resolution: "portrait", label: "9:16", platforms: "TikTok, Instagram Reels, YouTube Shorts" },
  horizontal: { W: 1920, H: 1080, resolution: "landscape", label: "16:9", platforms: "YouTube" },
  square: { W: 1080, H: 1080, resolution: "square", label: "1:1", platforms: "Instagram feed" },
  // A 16:9 video shown in a vertical feed (TikTok, Reels): it plays at ~0.56× in the middle of the phone with the
  // app's buttons over its right edge, so type is 1.5× larger and nothing sits under the right-hand icons.
  "horizontal-feed": { W: 1920, H: 1080, resolution: "landscape", label: "16:9 in a vertical feed", platforms: "TikTok, Instagram (horizontal video)" },
};

/** Pixel layout for each component in a format. Vertical keeps the platform-UI safe zones from brand.layout. */
export function layoutFor(b, format = "vertical") {
  const f = FORMATS[format] || FORMATS.vertical;
  const capSize = b.captions?.size ?? 84;
  if (format === "horizontal-feed")
    return {
      ...f,
      name: "horizontal-feed",
      k: 1.5,
      hook: { top: 150, left: 110, right: 640, lines: 3, max: 150, min: 90, scrim: "left" },
      recipe: { top: 110, left: 110, right: null, width: 980 },
      lt: { top: 640, left: 110, maxWidth: 1250 },
      cap: { bottom: 110, left: 140, right: 400, size: Math.round(capSize * 1.15) },
      end: { top: 220, gap: 44, cta: 120 },
      pip: { width: 560, height: 315, right: 300, bottom: 70 },
    };
  if (format === "horizontal")
    return {
      ...f,
      name: "horizontal",
      k: 1,
      // YouTube: no app UI over the frame; keep words inside the 80% title-safe box (96 px / 54 px margins at 90%).
      hook: { top: 300, left: 120, right: 760, lines: 3, max: 118, min: 60, scrim: "left" },
      recipe: { top: 96, left: null, right: 96, width: 660 },
      lt: { top: 720, left: 120, maxWidth: 1100 },
      cap: { bottom: 96, left: 260, right: 260, size: Math.round(capSize * 0.8) },
      end: { top: 290, gap: 44, cta: 84 },
      pip: { width: 480, height: 270, right: 64, bottom: 64 },
    };
  if (format === "square")
    return {
      ...f,
      name: "square",
      k: 1,
      hook: { top: 110, left: 72, right: 72, lines: 3, max: 120, min: 60, scrim: "top" },
      recipe: { top: 400, left: 120, right: 120, width: null },
      lt: { top: 780, left: 72, maxWidth: 936 },
      cap: { bottom: 110, left: 72, right: 72, size: Math.round(capSize * 0.85) },
      end: { top: 250, gap: 40, cta: 80 },
      pip: { width: 300, height: 300, right: 48, bottom: 48 },
    };
  const L = b.layout || DEFAULTS.layout;
  return {
    ...f,
    name: "vertical",
    k: 1,
    hook: { top: 250, left: L.padX, right: L.railRight, lines: 3, max: 150, min: 76, scrim: "top" },
    recipe: { top: 560, left: L.padX, right: L.railRight, width: null },
    lt: { top: 930, left: L.padX, maxWidth: 1080 - L.padX - L.railRight },
    cap: { bottom: L.captionBottom, left: L.padX, right: L.railRight, size: capSize },
    end: { top: 560, gap: 56, cta: 92 },
    pip: { width: 320, height: 568, right: L.railRight, top: L.safeTop + 40 },
  };
}
