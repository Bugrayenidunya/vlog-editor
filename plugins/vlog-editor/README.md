# vlog-editor (Claude Code plugin)

Brand kits, editing skills and automated workflows for vertical short-form video (TikTok,
Instagram Reels, YouTube Shorts), rendered with HeyGen HyperFrames.

It depends on `hyperframes@hyperframes`. Add HeyGen's marketplace first:

```bash
claude plugin marketplace add heygen-com/hyperframes
claude plugin marketplace add Bugrayenidunya/vlog-editor
claude plugin install vlog-editor@vlog-editor
```

The skills work on the current project directory. They read brand kits from `brands/<brand>/` and
video projects from `videos/<slug>/`, so the plugin carries no brand of its own and can be reused
for any brand.
