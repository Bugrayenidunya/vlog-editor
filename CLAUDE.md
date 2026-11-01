# vlog-editor

A studio for vlogs and short-form social video (TikTok and Instagram Reels first, YouTube Shorts too).
Videos are HTML compositions rendered to MP4 by **HeyGen HyperFrames**.

There is **one engine with two interfaces**, all shipped as a reusable Claude Code plugin in `plugins/vlog-editor/`:

- **Engine** (`scripts/*.mjs`): zero-dependency Node scripts with JSON on stdout and progress on stderr.
- **Skills** (`skills/*/SKILL.md`): the conversational interface in Claude Code (`/vlog-editor:brand-kit`,
  `/vlog-editor:video`, `/vlog-editor:studio`).
- **Studio** (`studio/`): a localhost web UI (`npm run studio`). Its judgment steps run Claude Code headless
  (`claude -p`) with the same reference docs the skills use.

Both interfaces read and write the same workspace folders: `brands/` and `videos/`.

## Layout

```
.claude-plugin/marketplace.json          marketplace that publishes plugins/vlog-editor
.claude/settings.json                    enables hyperframes@hyperframes for anyone who opens this repo
plugins/vlog-editor/
  scripts/      collect · analyze · fonts · board · build-kit · apply-brand · video   (+ lib/: util, brand, components)
  skills/       brand-kit (references/: brand-schema, sources, style-dna, directions, sound) · video · studio
  studio/       server.mjs (API, SSE jobs) · lib/ (steps, video-steps, claude) · public/ (Preact + htm, no build)
brands/<slug>/  kit.state.json · brand.json · DESIGN.md · tokens.css · fonts/ · logo/ · components/ · preview/
                research/ (sources, manifest, dossier, style-dna) · directions/<A|B|C|R1…>/brand.json
videos/<YYYY-MM-DD-slug>/  video.json (source of truth) · index.html (generated or hand-edited) · compositions/brand/
                           source/ (clips) · assets/ (working copies, master audio) · renders/ · edit.json · .vlog/
```

## Brand kit pipeline

`collect` (accounts ranked by likes, URLs, files) → `analyze` (HyperFrames `measure cuts/look`, `audio`,
k-means palette, contact sheets, transcripts) → **style DNA** (Claude) → **3 directions** (Claude, brand.json
each) → `board` (rendered 1080×1920 boards + `hyperframes compare`) → refine → sound → `build-kit` (DESIGN.md,
tokens, local fonts, logos, components, sizzle render) → `apply-brand` into a video project.

- `brand.json` is the source of truth; schema in `skills/brand-kit/references/brand-schema.md`, defaults
  and validation in `scripts/lib/brand.mjs`.
- `DESIGN.md` is HyperFrames' native design-spec format. Once it is copied into a video project, `/hyperframes`
  treats its frontmatter as binding, which is how every video picks up the brand.
- Components are HyperFrames sub-compositions with tokens baked in. Captions take a `WORDS` array between
  the `@words-start` and `@words-end` markers.

## Video pipeline (one edit, every format)

`videos/<slug>/video.json` (schema `vlog-editor/video@2`) holds the clip library, a **timeline** of segments
(clip + in/out, chapters), **overlays** anchored to segments (`{seg, t}`: cutaway, broll, pip, lower-third,
recipe, text) and **outputs** (`youtube` 16:9 = the whole edit; reels 9:16 = a window via `range`; square 1:1).
`video.mjs draft` turns each output into its own HyperFrames project in `outputs/<name>/` (components from
`brands/<b>/components/<format>/`, media hard-linked, audio assembled per output and normalised to the brand LUFS);
`render` writes MP4s, YouTube `chapters.txt` + `captions.srt`, and `edit.json` fingerprints, re-mastering the
delivered audio if the render mix drifts. v1 videos migrate automatically (old root project → `.vlog/legacy-v1/`).

- Brand components lay themselves out per format from `layoutFor()` in `scripts/lib/brand.mjs`.
- Portrait footage is never cropped into 16:9/1:1 (contain over a blurred fill); landscape footage is cropped into
  9:16 at the clip's `focusX`.
- The studio's video page predates video@2 and is not maintained; work happens in chat via `/vlog-editor:video`.

## HyperFrames is the renderer

- **Before writing or editing any composition, invoke the `/hyperframes` skill.** It comes from the
  `hyperframes@hyperframes` plugin. Related skills are `hyperframes-cli`, `hyperframes-registry`,
  `media-use` and `figma`.
- New video: `npm run new:reel -- videos/2026-11-02-my-slug` (1080×1920, `--skip-skills`, because the plugin
  supplies the skills), then `apply-brand.mjs --brand brands/<slug> --project videos/<slug>`.
- Work loop: `npx hyperframes check` → `npx hyperframes snapshot --at …` (look at the frames) → `render`.
  For an agent-run preview use `npx hyperframes preview --background`.
- Frame 0 is the thumbnail on TikTok and Reels (`check` → `first_frame_empty`).

## Conventions

- The engine must stay dependency-free so the plugin works anywhere. HyperFrames resolves from a
  `node_modules` pin above cwd, else `npx hyperframes@<HF_VERSION>` (`scripts/lib/util.mjs`).
- Plugin skills and scripts are brand-agnostic and never hardcode our brand.
- Downloaded reference media and frames stay private (gitignored under `brands/*/research/`).
- Validate before committing: `npm run validate:plugin`. Bump `plugins/vlog-editor/.claude-plugin/plugin.json`
  `version` on release.
- HyperFrames CLI pin: root `package.json` `devDependencies.hyperframes` and `HF_VERSION` in `util.mjs`.
  Bump them together.

## Roadmap

- [x] HyperFrames, plugin and marketplace scaffold
- [x] Brand kit engine, skill and studio
- [x] Videos: one edit → long 16:9 YouTube vlog + 9:16 reels (+ square), brand overlays, chapters/SRT, mastered audio
- [ ] Performance loop: track published posts and their analytics over time, join them to each video's
      `brand.lock.json` and edit fingerprint, learn which styles win, and propose kit updates
- [ ] Video: music beds with ducking, transitions, beat-synced cuts, silence/filler auto-trim suggestions
