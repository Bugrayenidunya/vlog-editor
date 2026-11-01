# vlog-editor

A studio for vlogs and short-form social video (TikTok, Instagram Reels, YouTube Shorts). It builds a complete
**brand kit from evidence**: your own account, accounts you admire, or the top accounts in your niche. It then
uses that kit to make videos with [HeyGen HyperFrames](https://github.com/heygen-com/hyperframes)
(HTML + GSAP compositions → MP4).

It comes with two interfaces that share one engine:

- **Studio**: a localhost web UI you click through (`npm run studio`)
- **Claude Code skills**: chat in the terminal (`/vlog-editor:brand-kit`, `/vlog-editor:video`)

## Brand kit, from nothing

1. **Brief**: starting points, niche, audience, languages, and personality sliders.
2. **Sources**: your accounts, accounts you admire, or "find top accounts in my niche" (Claude searches the web).
   Each account's most-liked recent posts are ranked and downloaded.
3. **Research**: pacing (cuts, first cut, shot length), look (luma, contrast, saturation, warmth), palette,
   sound (music or voice, loudness), hook transcripts, thumbnails. It compares your account with the
   references, and the top half of posts with the rest.
4. **Style DNA**: Claude reads the numbers and the pictures and returns 12–20 traits with evidence. Each trait
   is marked measured or seen and labelled as winning grammar or one creator's signature. You choose adopt or
   skip for each.
5. **Directions**: three distinct, rendered brand directions (on-trend, the opening nobody uses, the boldest you).
6. **Refine**: edit tokens directly or ask Claude ("warmer palette", "less shouty captions"), get name ideas,
   compare variants.
7. **Sound** (optional): music bed, sting, sound effects, voice.
8. **Kit**: `DESIGN.md` (HyperFrames' design spec), tokens, local fonts (Turkish-safe), logo and profile
   picture, caption/hook/lower-third/end-card components, and a rendered sizzle reel.

## Videos, edited by conversation

1. **New video** (studio sidebar): pick the brand and upload clips. **Main** is the footage whose sound is the mix,
   **face** opens the video so frame 0 is you, and **b-roll** is optional.
2. **Build draft**: the clips become a vertical video in your brand's style:
   - the face clip at frame 0 while the mix already plays
   - the footage cropped to 9:16 (drag the crop box)
   - the hook, the recipe card at the blend, a lower third, on-screen text and the end card
   - audio mastered to the brand's loudness (−14 LUFS)
3. **Edit with Claude**: type what to change ("show the card when the blend starts", "crop toward the mixer").
   Each video keeps one Claude Code session that remembers earlier edits, checks every change and refreshes the
   frames. **Live editor** opens HyperFrames' own timeline editor; **Undo** restores the previous version.
4. **Render MP4**: 1080×1920, H.264, loudness-checked, plus an `edit.json` style fingerprint for the coming
   performance loop.

## Install as a Claude Code plugin

```bash
claude plugin marketplace add heygen-com/hyperframes      # required dependency
claude plugin marketplace add Bugrayenidunya/vlog-editor
claude plugin install vlog-editor@vlog-editor
```

Then use `/vlog-editor:brand-kit` to chat, or `/vlog-editor:studio` to open the web UI.

## Requirements

- Node.js 22+, FFmpeg, yt-dlp (`brew install ffmpeg yt-dlp`), Google Chrome
- Claude Code (`claude` on PATH) for the judgment steps
- `npx hyperframes doctor` checks the rendering side

## Working in this repo

```bash
git clone https://github.com/Bugrayenidunya/vlog-editor && cd vlog-editor
npm install                                       # pinned HyperFrames CLI
npm run studio                                    # http://localhost:4317
claude                                            # project settings offer to install the HyperFrames plugin
npm run new:reel -- videos/2026-11-02-my-video    # scaffold a 1080×1920 reel
```

| Path | What lives there |
| --- | --- |
| `plugins/vlog-editor/scripts/` | The engine: collect, analyze, fonts, board, build-kit, apply-brand |
| `plugins/vlog-editor/skills/` | Claude Code skills and their reference docs |
| `plugins/vlog-editor/studio/` | The localhost studio (zero dependencies) |
| `brands/<brand>/` | Brand kits and their research |
| `videos/<date-slug>/` | One HyperFrames project per video |

Downloaded reference videos and their frames are for private analysis and stay out of git.

## Roadmap

- [x] HyperFrames setup and plugin scaffold
- [x] Brand kit: engine, skill, studio
- [x] Videos: brand-styled drafts from clips, Claude chat editing, live HyperFrames editor, render
- [ ] Performance loop: track published posts' analytics, learn which styles and edits win, update the kit
- [ ] Video: b-roll placement, beat-synced cuts, spoken captions, per-platform export presets
