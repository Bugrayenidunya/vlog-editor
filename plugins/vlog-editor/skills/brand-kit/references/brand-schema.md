# brand.json — schema `vlog-editor/brand@1`

One file is the source of truth for a brand. Directions are full brand.json files in
`brands/<slug>/directions/<A|B|C>/brand.json`; the chosen one is copied to `brands/<slug>/brand.json` by
`build-kit.mjs --from`. Unset fields fall back to `scripts/lib/brand.mjs` DEFAULTS, so write every field that
carries a decision and leave the rest out.

```jsonc
{
  "schema": "vlog-editor/brand@1",
  "name": "Rota",                       // brand name as written in the wordmark
  "tagline": "Slow travel, fast cuts",  // ≤ 6 words
  "positioning": "…",                   // one sentence: for whom, what, unlike whom
  "niche": "…", "audience": "…",
  "handles": { "tiktok": "@…", "instagram": "@…", "youtube": "@…" },
  "languages": ["tr", "en"],            // caption/voice languages, first = primary (drives fonts' latin-ext check)
  "personality": { "energy": 0.8, "polish": 0.4, "warmth": 0.6, "playfulness": 0.5 },   // 0–1

  "direction": { "id": "A", "label": "Punchy on-trend", "summary": "≤ 12 words shown on the board",
                 "rationale": "why this direction, citing measured evidence" },

  "colors": {                           // hex only. Contrast is validated: ink/ground ≥ 4.5 (aim 7)
    "ground": "#101014", "surface": "#1C1C22", "ink": "#FFFFFF", "muted": "#A6A6B0",
    "primary": "#FF5A1F",               // brand surfaces, logo mark
    "accent": "#FFD400",                // small marks: bars, dots, rules
    "highlight": "#FFD400",             // the one emphasised word (hook + spoken caption word)
    "captionText": "#FFFFFF", "captionStroke": "#000000", "captionBox": "#FFD400"
  },
  "fonts": {                            // Google Fonts family names, exact spelling; downloaded locally
    "display": { "family": "Anton", "weights": [400], "transform": "uppercase", "tracking": "0",
                 "lineHeight": 0.95, "widthFactor": 0.42 },   // widthFactor: avg glyph width / size (condensed ≈ 0.42, normal ≈ 0.5, wide ≈ 0.58)
    "body":    { "family": "Inter", "weights": [400, 700] },
    "caption": { "family": "Montserrat", "weight": 900, "transform": "uppercase" }
  },
  "captions": {
    "style": "highlight",               // highlight | pill | outline | clean | kinetic
    "wordsPerGroup": [2, 3],            // 2–3 high energy · 3–5 conversational · 4–6 calm
    "size": 84, "minSize": 48, "radius": 14, "strokeWidth": 8
  },
  "logo": { "style": "wordmark-dot", "text": null, "monogram": null, "case": "upper" },
  // style: wordmark | wordmark-dot | wordmark-underline | monogram-circle | monogram-square | lockup-circle | lockup-square
  // case: as-is | upper | lower ; text defaults to name, monogram to initials
  "motion": {
    "energy": "high",                   // calm | balanced | high
    "ease": { "enter": "power3.out", "exit": "power2.in", "pop": "back.out(1.7)" },   // GSAP eases
    "durations": { "fast": 0.18, "base": 0.32, "slow": 0.6 },
    "transitions": ["punch-in", "whip", "flash"],
    "pace": { "shotSeconds": [0.8, 1.4], "firstCutBy": 1.2 }
  },
  "look": { "grade": "warm-contrast", "luma": 120, "contrast": 60, "saturation": 0.32, "warmth": 18 },
  // numbers on the scale of `hyperframes measure look` (luma 0–255, saturation 0–1, warmth ±)
  "layout": { "safeTop": 168, "textBottom": 1330, "railRight": 150, "padX": 72, "captionBottom": 650 },
  "sound": {
    "enabled": true,
    "music": { "moods": ["upbeat"], "genres": ["house"], "bpm": [118, 128], "lufs": -14, "vocals": "instrumental" },
    "sting": { "description": "two-note pluck rising into a soft whoosh", "file": null },
    "sfx": { "whoosh": null, "pop": null, "click": null, "riser": null },
    "voice": { "style": "close-mic, conversational, slightly fast" }
  },
  "voice": {
    "tone": ["candid", "warm", "a little cheeky"],
    "hookFormulas": ["Nobody tells you this about {place}", "I tried {thing} for {n} days"],
    "ctas": ["Follow for part 2", "Save this for your trip"],
    "hashtags": ["#travelturkey", "#slowtravel"]
  },
  "rules": { "do": ["…"], "dont": ["…"] },
  "samples": {                          // what boards and the sizzle show — write them in the brand's language
    "hook": "Nobody tells you this about Kapadokya", "hookEmphasis": "Kapadokya",
    "caption": "bu an her şeyi değiştirdi", "captionActive": 2,
    "lowerThird": { "title": "Göreme", "subtitle": "Kapadokya, TR" }, "cta": "Follow for part 2",
    "recipe": {                         // optional: a card of items joined by steps — shown on boards and as a component
      "label": "Combo", "title": "Up the wheel",          // DJ: tracks joined by transitions; any niche: steps
      "tracks": [ { "title": "At Night (Purple Disco Machine Remix)", "artist": "Shakedown", "meta": "122 BPM · 4A" },
                  { "title": "Lola's Theme", "artist": "The Shapeshifters", "meta": "124 BPM · 5A" } ],
      "steps": ["EQ blend, bass swap · 16 bars"], "cta": "Save it in Mixnote"
    }
  },
  "evidence": { "styleDna": "research/style-dna.md", "summary": ["Top-half posts cut 0.4 s faster (1.1 s vs 1.5 s)"] }
}
```

## Hard rules

- Hex colours only. `validateBrand` (run by `board.mjs` and `build-kit.mjs`) reports contrast problems; fix
  every `error`, weigh every `warn`.
- Fonts must exist on Google Fonts under that exact name. `board.mjs` reports a missing family as an error.
  When `languages` includes Turkish or another latin-ext language, choose families with latin-ext
  (`fonts.json` → `latinExt`).
- `samples` are shown on boards: write them like real posts in the brand's primary language, not lorem.
- Never put another creator's name, logo, catchphrase or signature graphic into a brand. References give
  grammar (pace, type scale, palette roles), never identity.
