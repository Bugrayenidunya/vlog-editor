---
name: brand-kit
description: Create or update a complete brand kit for a vlog or short-form social account (TikTok, Instagram Reels, YouTube Shorts) from evidence, interactively. Learns from the person's own account, accounts they admire, or top accounts found in their niche; measures pacing, look, palette, captions, hooks and sound; proposes three rendered brand directions; then builds colours, fonts, logo, caption style, motion, sound, voice and HyperFrames components. Use for "brand kit", "brand identity", "make my style", "look like @x but original", restyling a channel, or starting a new account from nothing.
---

# Brand kit

The kit is built from evidence, with the person choosing at every checkpoint. The same flow runs in the
localhost **studio** (`/vlog-editor:studio`), which clicks through it with rendered previews. Both read and
write the same files, so a kit started in one continues in the other.

Engine scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts/` and print JSON on stdout (progress on stderr). Run them
from the workspace root (the folder that holds `brands/`). Everything for one brand lives in `brands/<slug>/`.

## State

`brands/<slug>/kit.state.json` holds the stage and every answer. Read it first; when it exists, say where it
stopped and ask to continue or restart. Update it after each checkpoint.

```json
{ "schema": "vlog-editor/kit-state@1", "slug": "rota", "stage": "brief",
  "brief": { "name": null, "startingPoints": ["self", "references"], "platforms": ["tiktok", "instagram"],
             "languages": ["tr"], "niche": "", "audience": "", "personality": { "energy": 0.7, "polish": 0.5,
             "warmth": 0.6, "playfulness": 0.5 }, "mustHave": "", "avoid": "", "sound": false },
  "traitChoices": {}, "chosenDirection": null, "history": [] }
```

## Flow

Ask with `AskUserQuestion` at every checkpoint (up to 4 questions per call, options with a short
description; free text for names, handles and niche). Show pictures by opening them (`open <png>` on macOS) and
by describing what is in them. Keep messages short: what was found, what is being asked.

1. **Brief** (stage `brief`). Ask together: starting points (multi-select: my account · accounts I admire ·
   find top accounts in my niche · from scratch), platforms, caption languages, and whether a name exists. Then
   in text: handles, niche and audience. Then personality (energy calm↔high, polish raw↔cinematic, warmth
   cool↔warm, playfulness serious↔playful) and sound (opt in or later).
2. **Sources** (stage `sources`). Write `research/sources.json` per `references/sources.md`. For discovery,
   search the web, verify handles with `collect.mjs --dry-run`, and offer candidates (multi-select). For
   Instagram, offer the three routes and never enable browser cookies without a yes in this session.
   Show the dry-run's top posts per account and confirm before downloading.
3. **Collect and analyze** (stage `analyze`).
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/collect.mjs" --brand brands/<slug>` then
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/analyze.mjs" --brand brands/<slug> --transcribe --language <code>`.
   Report failures per source (`error.code`, `hint`) and offer the fallback.
4. **Style DNA** (stage `dna`). Follow `references/style-dna.md`: look at the pictures, write
   `research/style-dna.md` and `.json`. Present the traits grouped by category and ask the person to mark each
   adopt or skip (multi-select per category, recommended ones first). Save `traitChoices`.
5. **Directions** (stage `directions`). Follow `references/directions.md` and `references/brand-schema.md`:
   write three directions, then render
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" --compare brands/<slug>/directions/{A,B,C}/brand.json --out brands/<slug>/directions/compare.png`
   (add `--bg <frame>` with one of their own frames when there is `self` footage). Fix reported issues and
   render again, then open `compare.png` and ask: A, B, C, or mix (say what from which).
6. **Refine** (stage `refine`). Loop: ask what to change (colours · type · captions · logo · motion · it's
   right). Change only that, re-render the board, show it. For a name, offer 5–8 options that fit the voice
   and work as handles. For the logo, render the logo styles as variants and let them pick.
7. **Sound** (stage `sound`, only if opted in). Follow `references/sound.md`.
8. **Build** (stage `build`). `node "${CLAUDE_PLUGIN_ROOT}/scripts/build-kit.mjs" --brand brands/<slug> --from brands/<slug>/directions/<X>/brand.json`
   (add `--footage <their clip>` when they have footage). It writes DESIGN.md, tokens, fonts, components,
   logos and renders `preview/sizzle.mp4` through a real HyperFrames project. Open the board, avatar and sizzle,
   list any `issues`, set stage `done`.

## After the kit

- A video uses the kit with
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/apply-brand.mjs" --brand brands/<slug> --project videos/<video>`: it copies
  DESIGN.md (which `/hyperframes` reads as the design spec), fonts, logos and components, and writes
  `brand.lock.json` so performance can be traced back to the kit version.
- Changing the kit later: edit `brand.json` (or re-run from `refine`) and build again; `version` increments.

## Guardrails

- References give grammar, never identity: no other creator's name, logo, catchphrase or signature graphic.
- Downloaded media stays private in `research/media/` (gitignored).
- Never fabricate numbers: every claim in the DNA and in rationales comes from the dossier or a named picture.
