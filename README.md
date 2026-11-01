# vlog-editor

A studio for vlogs and short-form social video (TikTok, Instagram Reels, YouTube Shorts). It builds a complete
**brand kit from evidence**: your own account, accounts you admire, or the top accounts in your niche. It then
uses that kit to make videos with [HeyGen HyperFrames](https://github.com/heygen-com/hyperframes)
(HTML + GSAP compositions → MP4).

It comes with two interfaces that share one engine:

- **Studio**: a localhost web UI you click through (`npm run studio`)
- **Claude Code skills**: chat in the terminal (`/vlog-editor:brand-kit`)

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
- [ ] Performance loop: track published posts' analytics, learn which styles and edits win, update the kit
- [ ] Video workflows: footage → transcript → cut → captions → render → export per platform
