# Directions: three brands that could all work

Input: the brief (`kit.state.json` → `brief`), `research/style-dna.json` with the person's `traitChoices`,
and `references/brand-schema.md`.

Output: `brands/<slug>/directions/A/brand.json`, `B/brand.json`, `C/brand.json` (complete, schema
`vlog-editor/brand@1`) and `directions/directions.json`:

```json
{ "directions": [ { "id": "A", "label": "Punchy on-trend", "summary": "…", "rationale": "…", "risk": "…" } ] }
```

## Three different brands, not three palettes

Each direction answers the same brief differently. They differ in at least four of: ground (dark / light /
colour), display face (condensed sans / grotesk / serif / rounded), caption style, motion energy, logo
style, sound. A useful spread:

- **A — on-trend.** The adopted grammar, executed at its best. Lowest risk, least distinct.
- **B — the opening.** Built on a whitespace finding: looks unlike the niche on purpose, keeps the grammar
  that wins (pace, hook, captions always on).
- **C — the person.** Built from their personality sliders, `self.keep` / `self.protect` and their own taste;
  the boldest expression of who they are.

Rename the labels to say what each one is ("Warm editorial", not "Direction B").

## Rules

- Every adopted trait appears in all three, in each direction's own way. Skipped traits appear in none.
  Avoided traits and other creators' signatures never appear.
- `rationale` cites evidence ("leaders cut 0.4 s faster → shots 0.8–1.4 s"). `risk` says honestly what could
  go wrong ("light ground loses contrast over bright beach footage").
- Colours: ink on ground ≥ 7:1, caption text on caption box ≥ 4.5:1. Highlight is for one word at a time.
  On dark grounds avoid full-frame linear gradients (H.264 banding).
- Fonts: real Google Fonts names, latin-ext when the languages need it (Turkish: ğ ş ı İ). Avoid
  Inter / Space Grotesk / Geist as the *display* face unless the brief asks for neutral; they are where generated
  design lands by default. Set `widthFactor` honestly (condensed ≈ 0.42, normal ≈ 0.5, wide ≈ 0.58) so hook
  titles fit.
- Captions: `wordsPerGroup` follows energy (2–3 high, 3–5 conversational, 4–6 calm).
- `samples` in the brand's primary language, written like real posts in the niche, using the brand's hook
  formulas. `hookEmphasis` is a substring of `hook`.
- `voice`: 3–5 hook formulas, 3 CTAs, 5–8 hashtags (mix niche-specific and broad).
- `sound.enabled` true only when the brief opted into sound; derive moods, genres and BPM from the dossier's
  sound stats and tracks.
- `name`: the brief's name if given. Otherwise a working name per direction (short, pronounceable in the
  primary language, plausible as a handle) and say so in `summary`.

## After writing

The engine renders boards (`scripts/board.mjs --compare …`) and reports `issues`. Fix every error (missing font,
contrast) in the brand.json and render again before showing the person.

## Refining

A refinement request changes only what it names, in the chosen direction's brand.json (or a copy in
`directions/R1/`, `R2/`… when the person wants to compare). Keep everything else identical so the boards are
comparable.
