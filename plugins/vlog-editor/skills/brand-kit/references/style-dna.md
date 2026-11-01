# Style DNA: from measurements and pictures to traits

Input: `brands/<slug>/research/dossier.md` (numbers), `dossier.json` (per video), and the pictures it lists
(first-frame grids, palette swatches, each video's `hook.jpg` and `overview.jpg`), plus the brief in
`brands/<slug>/kit.state.json`.

Output: `research/style-dna.md` for people and `research/style-dna.json` for the next step and the studio.

## How to read

1. **Look before you conclude.** Open the first-frame grid of each group, then the hook strips of the top
   5 videos by likes and the 3 weakest. Numbers say how fast and how bright; only the pictures show caption
   style, text placement, faces, framing, on-screen text in the first second, colour roles and type.
2. **Measured vs seen.** Every trait says where it came from: a number from the dossier (quote it) or what you
   saw in named pictures. Never present a guess as a measurement.
3. **Consensus vs signature.** A trait shared by most references is *grammar* (adopt it). A trait unique to
   one account is that creator's *signature* (do not copy it; note it as inspiration only).
4. **Leaders vs the rest.** Where `leadersVsRest` exists, a difference that holds across accounts is the
   strongest evidence you have. Say how big it is and how many videos it rests on; under ~12 videos call it
   weak.
5. **Self vs references.** When there is a `self` group: what is already recognisable (keep), where it
   lags the references on a measured trait (fix), and what it does that nobody else does (protect).
6. **Whitespace.** What does no reference do (palette family, caption style, format, tone)? Those are the
   openings for a brand that does not look like everyone else in the niche.

## What to cover

Hook (what is on screen at 0 s; text, face, result), editing pace (median shot, first cut, cuts per minute),
captions (style, case, size, position, words per group, emphasis), typography, colour (ground, text,
accents; grade warmth and saturation), look (luma, contrast), format (talking head, POV, montage, split
screen, green screen), sound (music share, loudness, voice pace), length, voice and CTA patterns from
transcripts and descriptions, hashtags.

## style-dna.json

```json
{
  "summary": "Three sentences a person can act on.",
  "traits": [
    {
      "id": "first-cut-under-1s",
      "category": "editing",
      "label": "First cut before 1 s",
      "evidence": "leaders 0.8 s vs rest 1.6 s (n=24); 4 of 5 accounts",
      "kind": "measured",
      "strength": "strong",
      "source": "references",
      "recommend": "adopt"
    }
  ],
  "self": { "keep": ["…"], "fix": ["…"], "protect": ["…"] },
  "whitespace": ["No reference uses a warm, light ground; all are dark and cool"],
  "signatures": [{ "account": "@x", "what": "…", "note": "inspiration only, do not copy" }],
  "palette": { "observed": ["#…"], "notes": "…" },
  "sound": { "musicShare": 0.7, "lufs": -15, "notes": "…" },
  "openQuestions": ["Keep the bilingual captions?"]
}
```

`category`: hook · editing · captions · type · color · look · format · sound · length · voice.
`kind`: measured | seen. `strength`: strong | medium | weak. `source`: references | self | both.
`recommend`: adopt (grammar worth taking) · keep (already theirs, works) · fix (theirs, lags) ·
avoid (hurts, or another creator's signature) · optional (taste).

Aim for 12–20 traits. The person will mark each one adopt / skip; their choices are saved in
`kit.state.json` → `traitChoices` and drive the directions.

## style-dna.md

Short sections: Summary · What wins in this niche (with numbers) · Your account today (when `self` exists) ·
Openings (whitespace) · Signatures not to copy · Sound · Open questions. Link the pictures by path.
