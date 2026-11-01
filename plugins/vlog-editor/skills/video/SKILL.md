---
name: video
description: Make or edit videos with a brand kit, by conversation — long horizontal YouTube vlogs (16:9, many clips, chapters, b-roll, picture-in-picture, captions file) and vertical reels/TikToks/Shorts (9:16) cut from the same edit, plus square. Builds a timeline from clips (takes chosen from transcripts and contact sheets), places brand overlays (hook, recipe card, lower thirds, text, end card), masters loudness, checks and shows frames, renders every format. Use for "make a video", "edit my vlog", "YouTube video", "cut a reel from it", "new reel", "change the hook", "render it".
---

# Video

One edit, every format. A video in `videos/<YYYY-MM-DD-slug>/` is a single **timeline** (clip segments in order) with
**overlays** anchored to it, rendered as several **outputs**: a 16:9 YouTube video of the whole edit and any number
of 9:16 reels (or 1:1 squares) that show a window of the same edit. Brand kit: `brands/<brand>/` (none →
`/vlog-editor:brand-kit` first).

Engine: `node "${CLAUDE_PLUGIN_ROOT}/scripts/video.mjs" <command> --project videos/<slug> …` from the workspace root;
it prints JSON.

| Command | What it does |
| --- | --- |
| `init --brand brands/<b> --title "…"` | creates `video.json` (schema `video@2`) with outputs `youtube` + `reel` |
| `add --file <clip> --role a-roll\|decks\|face\|b-roll` | copies into `source/`; a-roll and decks are appended to the timeline (`--no-append` / `--append` to override) |
| `ingest [--transcribe --language en]` | H.264 working copies, paged contact sheets (`.vlog/sheets/<clip>-pNN.jpg`), transcripts of a-roll/face clips (`.vlog/transcripts/<clip>.txt`, timestamped phrases) |
| `plan` | the resolved edit: segment times, overlay times, each output's window, chapters |
| `draft [--output name]` | builds `outputs/<name>/` HyperFrames projects + mastered audio, then check + key frames (`.vlog/frames/<name>/`) |
| `check [--output name]` | `hyperframes check` + key frames again |
| `render [--output name\|all] [--quality draft]` | MP4s in `renders/` at the brand's loudness, plus `.chapters.txt` and `.captions.srt` for 16:9; fingerprints in `edit.json` |
| `undo` | restores the previous `video.json` (then `draft` again) |

## video.json (the only file to edit)

```jsonc
{
  "clips": [{ "id": "talk", "role": "a-roll", "focusX": 0.5, "focusY": 0.5, … }],   // filled by add/ingest
  "timeline": [                                       // plays in order; times are seconds in the clip
    { "id": "s1", "clip": "talk", "in": 3.2, "out": 41.0, "chapter": "Intro", "label": "…", "audio": "clip" },
    { "id": "s2", "clip": "decks", "in": 0, "out": 95, "chapter": "First blend", "focusX": 0.4, "fit": "cover" }
  ],
  "overlays": [                                       // "at": { "seg": "s2", "t": 12 } = 12 s into segment s2
    { "id": "face", "type": "cutaway", "clip": "selfie", "in": 0, "at": { "seg": "s1", "t": 0 }, "dur": 2.5 },
    { "id": "br1", "type": "broll", "clip": "street", "in": 4, "at": { "seg": "s1", "t": 20 }, "dur": 3 },
    { "id": "cam", "type": "pip", "clip": "facecam", "in": 0, "at": { "seg": "s2", "t": 0 }, "dur": 60 },
    { "id": "lt1", "type": "lower-third", "at": { "seg": "s2", "t": 2 }, "dur": 3.5, "title": "…", "subtitle": "…" },
    { "id": "r1", "type": "recipe", "at": { "seg": "s2", "t": 40 }, "dur": 5, "recipe": { "label": "Combo", "title": "…", "tracks": [{ "title": "…", "artist": "…", "meta": "124 BPM · 5A" }], "steps": ["EQ blend · 16 bars"], "cta": "…" } },
    { "id": "t1", "type": "text", "at": { "seg": "s2", "t": 20 }, "dur": 2.5, "text": "bass swap on the drop" }
  ],
  "hook": { "text": "…", "emphasis": "…" },          // shared default hook
  "endCard": { "cta": "…" },
  "outputs": [
    { "name": "youtube", "format": "horizontal", "range": null, "hook": true, "hookSeconds": 4, "endSeconds": 8, "captions": "srt" },
    { "name": "reel", "format": "vertical", "range": { "from": { "seg": "s2", "t": 30 }, "to": { "seg": "s2", "t": 75 } },
      "maxSeconds": 60, "hook": { "text": "…", "emphasis": "…" }, "endSeconds": 2.5, "captions": "burn" }
  ]
}
```

- **Segments**: `audio` `clip` (default) or `mute`; `volume` multiplies; `fit` `cover` (crop, uses `focusX/Y`) or
  `contain` (whole frame over a blurred fill). Auto: portrait footage is never cropped into 16:9/1:1.
- **Overlays**: `cutaway`/`broll` (another clip over the picture, the timeline's sound continues), `pip` (corner
  window), `lower-third`, `recipe`, `text` (on-screen words in the caption style). Anchor to segments so trims
  elsewhere never move them.
- **Outputs**: `range` null → the whole edit (vertical: an automatic `maxSeconds` window around the first recipe
  card). `hook` true / an object / false. `captions` `burn` (spoken words + text beats burned in, for reels) or
  `srt` (a file for YouTube). `cta` overrides the end card's line.

## Long YouTube vlog

1. `init`, then `add` every clip with its role: a-roll (you talking), decks (mixing), face (a camera on you),
   b-roll (anything to cut away to). `ingest --transcribe --language <code>`.
2. Read the transcripts (`.vlog/transcripts/*.txt`) and contact sheets (`clips[].sheets`, `sheetNote` says which
   seconds a page covers). Choose takes: cut false starts, repeats and dead air; keep the story in order.
3. Write `timeline`: one segment per kept piece, each with `in`/`out`, a `label`, and a `chapter` where a new
   topic starts (YouTube needs ≥ 3 chapters, the first at 0:00, each ≥ 10 s).
4. Add overlays: b-roll over long talking stretches, a lower third when a place, person or technique appears, a
   recipe card when a blend lands, a picture-in-picture face cam over long deck segments.
5. `draft`, read every key frame of `youtube`, fix `check` errors, iterate. `render --output youtube` (try
   `--quality draft` first for long videos: rendering takes about real time).

## Reels from the same edit

Add outputs with `format: "vertical"` and a `range` around the best moment: a blend, a reaction, a punchline.
Give each its own `hook`, written for the scroll (frame 0 = thumbnail). Captions `burn`. The same overlays appear
wherever they fall inside the window.

## Rules

- Write copy yourself from what you see and hear: hooks, labels, recipe text, chapters. Use the brand's
  `voice.hookFormulas` as patterns, not fill-in templates.
- Look at the frames after every draft. A passing check does not show how it looks.
- Keep `DESIGN.md` rules (copied into every output). Never delete `source/`; never touch other videos.
- `outputs/*/index.html` are generated: change `video.json` and draft again.
