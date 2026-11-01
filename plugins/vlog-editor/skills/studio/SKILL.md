---
name: studio
description: Start the vlog-editor studio, a localhost web UI for building brand kits interactively (brief, sources, research, style DNA, rendered directions, refine, sound, final kit). Use when the person asks to open the studio, the web UI, the dashboard, or wants to click through the brand kit instead of chatting.
---

# Studio

A local web app over the same engine and files as the `brand-kit` skill. Judgment steps (style DNA, directions,
refinements, names, discovery, sound) run Claude Code headless (`claude -p`) with the person's own login.

Start it from the workspace root (the folder that holds or will hold `brands/`), in the background, so it keeps
running after this turn:

```bash
node "${CLAUDE_PLUGIN_ROOT}/studio/server.mjs" --open
```

Use the Bash tool's `run_in_background` for this, not a trailing `&`. It prints
`vlog-editor studio → http://localhost:4317`; tell the person the URL. `--port <n>` picks another port and
`--workspace <dir>` another folder. In this repository `npm run studio` does the same.

- It binds to 127.0.0.1 only, and requests that change anything need the `X-Studio: 1` header the UI sends.
- Needs Node 22+, ffmpeg and yt-dlp (`brew install ffmpeg yt-dlp`), and `claude` on PATH for the judgment steps.
  The sidebar shows which tools it found.
- A kit started in the studio can be continued here with `/vlog-editor:brand-kit` and the other way round,
  because both use `brands/<slug>/kit.state.json`.
