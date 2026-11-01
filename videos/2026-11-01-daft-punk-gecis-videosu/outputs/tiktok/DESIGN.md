---
version: "alpha"
name: "itsbgra — Brand (vertical video)"
description: "Blends that finally clicked A DJ learning in public who turns every blend that works into a recipe beginners can copy — and save in Mixnote."
unit: "the frame — vertical 1080×1920 (TikTok, Reels, Shorts) · horizontal 1920×1080 (YouTube) · square 1080×1080"
principle: "Your two best posts are Mixnote cards (633 and 208 likes), so the brand speaks the app's language: warm near-black cards, gold step arrows, white bold titles. The adopted grammar is executed straight: you at frame 0, top hook, fast in then long blend, loud master."
colors:
  ground: "#141210"
  surface: "#24211E"
  ink: "#FFFFFF"
  muted: "#A8A29A"
  primary: "#F29A38"
  accent: "#E8B04A"
  highlight: "#F2B84B"
  on-primary: "#0B0B0B"
  on-accent: "#0B0B0B"
  caption-text: "#FFFFFF"
  caption-stroke: "#000000"
  caption-box: "#24211E"
typography:
  hook-title:
    fontFamily: "Plus Jakarta Sans"
    px: "76–150 (fit to 3 lines)"
    weight: 800
    lineHeight: 1.02
    tracking: "-0.02em"
    upper: false
  caption:
    fontFamily: "Plus Jakarta Sans"
    px: 84
    minPx: 48
    weight: 800
    upper: false
    tracking: "0.01em"
  lower-third-title:
    fontFamily: "Plus Jakarta Sans"
    px: 62
    weight: 800
    upper: false
  lower-third-sub:
    fontFamily: "Inter"
    px: 30
    weight: 700
  end-card-cta:
    fontFamily: "Plus Jakarta Sans"
    px: 92
    weight: 800
    upper: false
  body:
    fontFamily: "Inter"
    px: 36
    weight: 400
    lineHeight: 1.25
spacing:
  safe-top: "168px"
  text-band: "168–1330px"
  rail-right: "150px"
  pad-x: "72px"
  caption-bottom: "650px"
components:
  captions:
    file: "compositions/brand/brand-captions.html"
    style: "pill"
    wordsPerGroup: "3–5"
    description: "Mount once on a host with data-track-kind=\"captions\"; fill WORDS between the @words markers from transcript.json."
  hook-title:
    file: "compositions/brand/brand-hook.html"
    variables: "hook, emphasis"
    description: "On screen at frame 0 (the thumbnail); first 2–3 s."
  lower-third:
    file: "compositions/brand/brand-lower-third.html"
    variables: "title, subtitle"
    description: "Place or topic chip at y 930, above the caption band."
  end-card:
    file: "compositions/brand/brand-end-card.html"
    variables: "cta, handle"
    description: "Last 2–3 s: logo, call to action, handle."
  recipe-card:
    file: "compositions/brand/brand-recipe-card.html"
    variables: "top"
    description: "Items joined by steps (tracks joined by transitions: technique · bars, BPM · key). Fill RECIPE between the @recipe markers."
  logo:
    style: "wordmark-dot"
    text: "itsbgra"
    monogram: "bg"
    files: "assets/brand/avatar.png, assets/brand/wordmark.png"
formats:
  vertical:
    canvas: "1080×1920"
    platforms: "TikTok, Instagram Reels, YouTube Shorts"
    hook: "top 250px, left 72px, right 150px, ≤ 3 lines, 76–150px"
    recipe-card: "top 560px, 72px from the sides"
    lower-third: "top 930px, left 72px"
    captions: "bottom 650px, 84px base"
    components: "components/vertical/ → compositions/brand/"
  horizontal:
    canvas: "1920×1080"
    platforms: "YouTube"
    hook: "top 300px, left 120px, right 760px, ≤ 3 lines, 60–118px"
    recipe-card: "right panel: top 96px, right 96px, 660px wide"
    lower-third: "top 720px, left 120px"
    captions: "bottom 96px, 67px base"
    components: "components/horizontal/ → compositions/brand/"
  square:
    canvas: "1080×1080"
    platforms: "Instagram feed"
    hook: "top 110px, left 72px, right 72px, ≤ 3 lines, 60–120px"
    recipe-card: "top 400px, 120px from the sides"
    lower-third: "top 780px, left 72px"
    captions: "bottom 110px, 71px base"
    components: "components/square/ → compositions/brand/"
  horizontal-feed:
    canvas: "1920×1080"
    platforms: "TikTok, Instagram (horizontal video)"
    hook: "top 150px, left 110px, right 640px, ≤ 3 lines, 90–150px"
    recipe-card: "top 110px, 110px from the sides"
    lower-third: "top 640px, left 110px"
    captions: "bottom 110px, 97px base"
    components: "components/horizontal-feed/ → compositions/brand/"
motion:
  energy: "balanced"
  ease:
    enter: "power3.out"
    exit: "power2.in"
    pop: "back.out(1.6)"
  durations:
    fast: 0.18
    base: 0.34
    slow: 0.6
  transitions: ["hard cut on the downbeat", "card slide-up", "crossfade on the blend"]
  shot-seconds: [6, 24]
  first-cut-by: 4
look:
  grade: "clean warm-neutral"
  luma: 100
  contrast: 60
  saturation: 0.24
  warmth: 6
sound:
  enabled: true
  music:
    moods: ["groovy", "feel-good", "late-night"]
    genres: ["house", "nu-disco"]
    bpm: [120, 128]
    lufs: -14
    vocals: "the mix itself; no extra bed under a blend"
  sting:
    description: "a 0.8 s vinyl-stop into one filtered house chord stab"
    file: null
  sfx:
    whoosh: "filter sweep up into the drop"
    pop: "soft cue-button click for each card row"
    click: "jog-wheel tick"
    riser: "white-noise riser over the last 8 bars"
  voice:
    style: "no voice-over; on-screen text carries the teaching"
---

# itsbgra — Brand

## Overview

**Blends that finally clicked.** A DJ learning in public who turns every blend that works into a recipe beginners can copy — and save in Mixnote. Niche: DJ journey and transitions. Audience: new and beginner DJs worldwide.

Personality: energy 6/10 · polish 7/10 · warmth 7/10 · playfulness 5/10. Languages: en.

## Colors

The ground is `#141210` with `#FFFFFF` ink. `#F29A38` (primary) carries brand surfaces and the logo mark; `#E8B04A` (accent) is for small marks, bars and dots; `#F2B84B` (highlight) marks the one word that matters — in hook titles and on the spoken caption word. Over footage, text sits on footage with a shadow or on a brand surface; never put long text on the highlight colour.

## Typography

**Plus Jakarta Sans** for hooks, titles and the call to action. **Inter** for everything read in passing (handles, subtitles, labels). Captions use **Plus Jakarta Sans 800**. Nothing meant to be read under 28 px; hooks are cut to fit three lines, never shrunk below 76 px.

## Captions

Style **pill**, 3–5 words per group, one group at a time, bottom edge 650 px from the frame bottom, clear of the right-hand action rail. Speech is always captioned: many viewers watch muted.

## Formats

One edit renders as several formats; every brand component has a layout per format (`components/<format>/`).

- **Vertical 1080×1920** (TikTok, Reels, Shorts): the platform draws over the frame. Nothing in the top 168 px, words inside 168–1330 px, nothing under the right-hand action rail (150 px). Frame 0 is the thumbnail: a face or the hook, never the logo. Keep cuts to 60 s or less, built around one payoff.
- **Horizontal 1920×1080** (YouTube): no app UI, so words stay inside the 80% title-safe box. The hook sits on the left third over a side scrim; the recipe card is a right-hand panel, so the footage stays visible. Long videos get chapters, from segment labels, and a captions file (SRT) uploaded instead of burned-in captions. The end card runs 5–20 s to leave room for YouTube's end-screen elements.
- **Square 1080×1080** (Instagram feed): centred layouts, the same type ramp at about 85%.

Footage that does not match the frame is cropped when that loses little (landscape decks into vertical, using the clip's focus point). Otherwise it is placed whole over a blurred, darkened copy of itself (a vertical selfie in 16:9).

## Motion and editing

balanced energy. Shots of 6–24 s; the first cut lands by 4 s. Transitions: hard cut on the downbeat, card slide-up, crossfade on the blend. Eases: enter `power3.out`, exit `power2.in`, pop `back.out(1.6)`. Frame 0 is the thumbnail and the hook: a face, the result, or the hook title already on screen — never black, never the logo.

## Look

Grade: **clean warm-neutral**. luma ≈ 100, contrast ≈ 60, saturation ≈ 0.24, warmth ≈ 6 (targets measured with `npx hyperframes measure look`). Apply grades with `npx hyperframes media-treatment`, never CSS filters.

## Sound

Music: groovy, feel-good, late-night house / nu-disco, 120–128 BPM, the mix itself; no extra bed under a blend, mixed to -14 LUFS. Sting: a 0.8 s vinyl-stop into one filtered house chord stab. Source music and effects with `/media-use`; cut on the beat (`npx hyperframes beats`).

## Voice

Tone: honest, encouraging, practical, learning in public.

Hook formulas:
- If you're a beginner DJ, steal this {bars}-bar blend
- {Song A} → {Song B}: the blend that finally clicked
- I practised this {technique} all week — here's the recipe
- The {technique} mistake I kept making (and the fix)

Calls to action:
- Save it in Mixnote
- The full recipe is in Mixnote
- Which blend should I learn next?

Hashtags: #djtransition #djmix #housemusic #djlife #mixnote

## Do

- Frame 0 is you: your face, or you at the decks, filling the 9:16 frame
- Shoot vertical: a phone above the decks plus one front angle; never letterbox landscape footage
- Name the blend in the hook text: "Song A → Song B", and speak to beginners ("If you're a beginner DJ…")
- Hook in the first 4 s, then let the blend play in long takes (8–24 s)
- Show the recipe card once the blend lands: technique · bars, BPM · key
- Master to about −14 LUFS; photo posts use the official track sound
- Close on "Save it in Mixnote"

## Don't

- No blue/violet LED room as the look
- No copied templates (a purple title box with a "DJ Mix Tutorial" pill)
- No "Day N" numbering as the hook
- No voice-over needed: on-screen text carries the teaching
- Never quieter than the references: −20 LUFS or lower reads as broken

## Evidence

- Recipe cards are your top 2 posts: 633 and 208 likes vs a median of 11 for your videos
- About 30 of 37 reference thumbnails show a person; 0 of your 11 do
- Your videos: luma 33 and −31 LUFS vs references' 97 and −16.8 (letterboxed and quiet)
- References' top half cut first at 3.7 s (vs 5.0 s) and then hold 24 s shots (vs 16.5 s)
- 6 of @offtherackjack's top 8 open by naming the beginner

Full analysis: `research/style-dna.md`.
