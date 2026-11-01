---
name: video
description: Make or edit a short-form vertical video (TikTok, Instagram Reels, YouTube Shorts) with a brand kit, by conversation. Creates the project from clips (main footage with the sound, an optional face clip for frame 0, b-roll), drafts it in the brand's style (hook, recipe card, lower third, on-screen text, end card, loudness-mastered audio), applies requested edits, checks and shows frames, and renders the MP4. Use for "make a video", "edit my video", "new reel", "cut this clip", "change the hook", "render it".
---

# Video

One HyperFrames project per video in `videos/<YYYY-MM-DD-slug>/`, built from a finished brand kit in `brands/<brand>/`.
The studio's **Videos** page (`/vlog-editor:studio`) does the same, with a chat box. Both edit the same files, and
the studio's chat is a resumable Claude Code session per video.

Engine: `node "${CLAUDE_PLUGIN_ROOT}/scripts/video.mjs" <command> …`, run from the workspace root. It prints JSON.

| Command | What it does |
| --- | --- |
| `init --brand brands/<b> --title "…"` | `hyperframes init` (1080×1920) + apply the brand kit + `video.json` |
| `add --project videos/<v> --file <clip> --role main\|face\|broll` | copy a clip into `source/` |
| `ingest --project videos/<v>` | H.264 working copies, contact sheets (`.vlog/sheets/`), master audio at the brand's LUFS |
| `draft --project videos/<v> [--force]` | write `index.html` from `video.json`, then check + key frames (`.vlog/frames/`) |
| `check --project videos/<v>` | `hyperframes check` + key frames |
| `render --project videos/<v>` | MP4 in `renders/`, its loudness, and `edit.json` (the style fingerprint) |
| `undo --project videos/<v>` | restore the version before the last draft or edit (`.vlog/versions/`) |

## video.json is the source

`clips[]` (`role`, `in`, `out`, `focusX` 0–1 for the vertical crop), `hook {text, emphasis}`, `recipe`
(`label, title, tracks[{title, artist, meta}], steps[], cta`), `blendAt` (when the recipe card shows),
`faceSeconds`, `maxSeconds`, `lowerThird {title, subtitle, at}`, `captions [{text, start, end}]` (on-screen text
beats), `endCard {cta, seconds}`.

- Changes those fields express: edit `video.json`, then `draft --force`.
- Anything else (extra overlays, motion, layout, b-roll placement, effects): invoke `/hyperframes` and edit
  `index.html` or `compositions/` directly. `video.json` then becomes `"locked": true`, and `draft` refuses to
  overwrite without `--force`.

## Flow

1. Find the brand (`brands/*/brand.json`); no finished kit → `/vlog-editor:brand-kit` first.
2. Ask for the clips and roles: **main** is the footage whose sound is the mix (for a DJ: the decks), **face**
   opens the video so frame 0 is a person. Ask for the recipe (tracks, technique, bars, BPM, key) when the brand
   has a recipe card.
3. `init` → `add` → `ingest` → write the hook (use the brand's `voice.hookFormulas`), recipe and timings into
   `video.json` → `draft`. Look at the contact sheets to choose `in`/`out`, `focusX` and `blendAt`.
4. Read the key frames (`.vlog/frames/*.png`) and show the person what changed. Fix `check` errors before
   anything else.
5. Iterate on their requests. Render only when they ask; report the file, its length and loudness.

## Rules

- Frame 0 is the thumbnail: a face or the hook on screen, never black, never the logo.
- Keep the brand's rules from `DESIGN.md` (it is in the project root).
- Never delete `source/` clips; never touch other videos.
