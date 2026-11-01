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

## Video pipeline

`video.mjs init` (hyperframes init + apply-brand + video.json) → `add` clips (main = footage whose sound is the mix,
face = opens the video, broll) → `ingest` (H.264 working copies, contact sheets, master audio normalised to the
brand LUFS) → `draft` (index.html from video.json: face J-cut at frame 0, vertical crop by `focusX`, hook,
recipe card at `blendAt`, lower third, text beats, end card) → `check` (+ key frames) → `render` (MP4 +
`edit.json` style fingerprint). Every draft or Claude edit is preceded by a version in `.vlog/versions/` (`undo`).

- Edits to `index.html` beyond the fields set `video.json` `locked: true`; `draft` then needs `--force`.
- In the studio, each video has one persistent Claude Code session (`video.json` `claude.session`, resumed per
  message) whose tools are limited to file edits, `/hyperframes` skills, `npx hyperframes` and `video.mjs`.

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
- [x] Videos: draft from clips in the brand's style, edit by conversation (studio chat or `/vlog-editor:video`), render
- [ ] Performance loop: track published posts and their analytics over time, join them to each video's
      `brand.lock.json` and edit fingerprint, learn which styles win, and propose kit updates
- [ ] Video: b-roll placement, beat-synced cuts, spoken captions from transcripts, per-platform export presets
