# Sonic identity (optional)

Only when the person opts in. Evidence comes from the dossier: `sound.kinds` (music / voice / mixed / sfx share),
loudness (LUFS), BPM where measured, and `tracks` (TikTok reports the track and artist of each post).

## What to decide

- **Music bed**: 2–3 moods, 1–2 genres, a BPM range, vocals (instrumental is the default under speech),
  target loudness (social platforms normalise around −14 LUFS; speech-led videos keep music 12–18 dB under
  the voice).
- **Sting**: a 0.5–1.5 s sound under the end card or the logo, described in words (instrument, gesture,
  length). It is the audio logo; it repeats in every video.
- **SFX palette**: whoosh (transitions), pop (caption or sticker in), click (UI and lists), riser (into the
  reveal). Same family across the brand: all organic or all synthetic.
- **Voice**: delivery notes for voiceover (pace in words per second from transcripts, register, energy).

## Getting the files

Use `/media-use` from HyperFrames: `npx hyperframes media-use resolve --type bgm|sfx --intent "<words>"`.
The HeyGen music catalog needs a free HeyGen sign-in (`npx hyperframes auth login`); 21 sound effects are
bundled offline; Openverse sounds need credit (CC BY). Ask before signing in or generating anything that
uses credits. Place chosen files in `brands/<slug>/sound/` and set `sound.sting.file` / `sound.sfx.*` to the
file names.

Trending sounds on TikTok are a per-video choice, not a brand asset: the kit sets the bed and the sting;
the video workflow may still use a trend.
