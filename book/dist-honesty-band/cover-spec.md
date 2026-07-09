# Cover spec — *The Honesty Band* (6×9 hardcover)

Interior: `interior.pdf`, **54 pages**, 6×9 in trim, black-and-white.
Cover source: `book/cover-honesty-band.html` → rendered to `cover.pdf` /
`cover-preview.png` via `node book/make-cover.mjs cover-honesty-band.html dist-honesty-band`.

The shipped `cover.pdf` is laid out on the **Lulu casewrap template geometry
verified at upload for The Agent Stack** (14 × 10.75 in flat canvas, 0.25 in
spine, 6.875 in panels). Lulu quantizes its templates, so a 54-page book is
expected to land on the same canvas — but **download Lulu's generated template
for this exact page count at upload and re-render if it differs.**

## Rail 1 — Lulu casewrap (hardcover, 6×9 US Trade)

**Formula spine width** (Lulu standard 60# / ~148 gsm B&W paper):

```
spine = pageCount × 0.0025 in + 0.06 in
      = 54 × 0.0025 + 0.06
      = 0.195 in
```

Formula flat canvas (wrap ≈ 0.75 in/edge): 13.695 × 10.5 in. The shipped
cover instead uses the Lulu-template canvas above (14 × 10.75, spine 0.25) —
the geometry Lulu actually generated for the sibling 48-page volume.

> ⚠️ Confirm against **Lulu's cover calculator / downloadable template at
> upload** for product + page count + paper. Keep text ≥0.5 in from the spine
> folds and wrap edges. No spine text — the spine is below Lulu's ~80-page
> spine-text guidance. Lulu's casewrap minimum is 24 pages — 54 clears it.

## Rail 2 — Amazon KDP (6×9)

**Spine width** (B&W interior):

```
case laminate: spine = 54 × 0.0025   = 0.135 in
paperback:     spine = 54 × 0.002252 = 0.1216 in
```

> ⚠️ **KDP case laminate requires 75–550 pages** — at 54 pages this interior
> is below the hardcover minimum (pad the interior or use KDP paperback).
> Either way, download the sized template from
> **kdp.amazon.com/cover-calculator** for this trim + page count + paper and
> lay the art into it; confirm every dimension against the official
> calculator at upload.

## Cover copy

- **Front:** ✦ ✧ ✦ ornament (amber `#e0a83c`), title *The Honesty Band*,
  subtitle inside the amber "band" rules: SHIPPING AI THAT NEVER OVERCLAIMS,
  author Dom Sadarangani.
- **Back blurb:** as in `cover-honesty-band.html` — the roadmap-as-product
  trap, the honesty-band machinery (tiers, calibration gate, verification
  briefs, rubrics, holdouts, gauges, the interface that disagrees,
  sell-the-lock), provenance line (ten agents, one chapter each).
- **Back meta:** dys5315.github.io/domvault/constellation · PolyForm
  Noncommercial 1.0.0. 2 × 1.2 in ISBN clear zone lower-right.
