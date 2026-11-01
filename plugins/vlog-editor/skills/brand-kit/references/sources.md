# Sources: what to learn from, and how to get it

`scripts/collect.mjs` reads `brands/<slug>/research/sources.json` and downloads each account's most-liked
recent posts. Write that file from the person's answers.

```json
{
  "cookiesFromBrowser": null,
  "defaults": { "top": 8, "scan": 60, "sinceDays": 365, "maxDuration": 180, "rankBy": "likes" },
  "sources": [
    { "kind": "account", "platform": "tiktok", "handle": "@their.own", "role": "self", "top": 12 },
    { "kind": "account", "platform": "tiktok", "handle": "@admired", "role": "reference" },
    { "kind": "account", "platform": "youtube", "handle": "@admired", "role": "reference" },
    { "kind": "urls", "role": "reference", "urls": ["https://www.instagram.com/reel/…"] },
    { "kind": "files", "role": "self", "path": "research/inbox" }
  ]
}
```

| role | meaning | how it is used |
| --- | --- | --- |
| `self` | the person's own account or footage | the baseline: what to keep (recognisability) and what to fix |
| `reference` | accounts the person admires | the target grammar |
| `discovered` | top accounts found in the niche | what wins in the niche right now |

## Per platform

| Platform | Account listing | Download | Metrics |
| --- | --- | --- | --- |
| TikTok | ✅ no login | ✅ | views, likes, comments, shares, saves, track |
| YouTube Shorts | ✅ no login | ✅ | views (likes after download) |
| Instagram | ❌ yt-dlp cannot list profiles | needs login cookies | after download, with cookies |

**Instagram** has three routes; offer them in this order and let the person pick:
1. They paste reel URLs (best: they choose what represents them).
2. Browser: with Claude in Chrome, open `instagram.com/<handle>/reels/`, read the grid (URLs and view counts),
   and add the top ones as a `urls` source.
3. `"cookiesFromBrowser": "chrome"` lets yt-dlp use their logged-in Instagram session. This reads browser
   cookies and macOS will ask for Keychain access. **Only set it after the person says yes in this session**, and
   say what it does first.

## Discovering top accounts in a niche

When the person has no references: search the web for the niche's top creators on each platform
(e.g. `top travel vloggers TikTok Turkey 2026`, `most followed {niche} creators`), prefer sources from the last
12 months, and verify each handle by listing it (`collect.mjs --dry-run`). Offer 6–10 candidates with
follower count and median likes; the person picks 3–5. Mix sizes: 2 giants for grammar, 2–3 mid-size
(50K–500K) accounts that grew recently, whose style is more reachable.

## How much

3–5 reference accounts × 8 posts and the person's own top 12 is enough for a stable dossier
(~50 videos, 5–10 minutes to collect and analyze). More accounts beat more posts per account.

## Rights

Downloads are for private analysis only: they stay in `research/media/` (gitignored) and are never
published or put in a kit. The kit takes grammar from references, never their footage, logos or names.
