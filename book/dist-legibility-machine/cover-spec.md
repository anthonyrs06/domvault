# Cover spec — *The Legibility Machine* (6×9 hardcover)

Interior: `interior.pdf`, **53 pages**, 6×9 in trim, black-and-white.
Cover source: `book/cover-legibility-machine.html` → rendered to `cover.pdf` /
`cover-preview.png` via `node book/make-cover.mjs cover-legibility-machine.html dist-legibility-machine`.

The shipped `cover.pdf` is laid out on the **Lulu casewrap template geometry
verified at upload for The Agent Stack** (14 × 10.75 in flat canvas, 0.25 in
spine, 6.875 in panels). Lulu quantizes its templates, so a 53-page book is
expected to land on the same canvas — but **download Lulu's generated template
for this exact page count at upload and re-render if it differs.**

## Rail 1 — Lulu casewrap (hardcover, 6×9 US Trade)

**Formula spine width** (Lulu standard 60# / ~148 gsm B&W paper):

```
spine = pageCount × 0.0025 in + 0.06 in
      = 53 × 0.0025 + 0.06
      = 0.1925 in
```

Formula flat canvas (wrap ≈ 0.75 in/edge): 13.6925 × 10.5 in. The shipped
cover instead uses the Lulu-template canvas above (14 × 10.75, spine 0.25) —
the geometry Lulu actually generated for the sibling 48-page volume.

> ⚠️ Confirm against **Lulu's cover calculator / downloadable template at
> upload** for product + page count + paper. Keep text ≥0.5 in from the spine
> folds and wrap edges. No spine text — the spine is below Lulu's ~80-page
> spine-text guidance. Lulu's casewrap minimum is 24 pages — 53 clears it.
> Note: Lulu interiors print in even-page signatures; a 53-page PDF gets a
> blank verso added automatically.

## Rail 2 — Amazon KDP (6×9)

**Spine width** (B&W interior):

```
case laminate: spine = 53 × 0.0025   = 0.1325 in
paperback:     spine = 53 × 0.002252 = 0.1194 in
```

> ⚠️ **KDP case laminate requires 75–550 pages** — at 53 pages this interior
> is below the hardcover minimum (pad the interior or use KDP paperback).
> Either way, download the sized template from
> **kdp.amazon.com/cover-calculator** for this trim + page count + paper and
> lay the art into it; confirm every dimension against the official
> calculator at upload.

## Cover copy

- **Front:** ✦ ✧ ✦ ornament (teal `#2dd4bf`), title *The Legibility Machine*,
  subtitle: HOW STANDARDIZED DATA CREATES MARKETS, punched data-strip "tape"
  rule, author Dom Sadarangani.
- **Back blurb:** as in `cover-legibility-machine.html` — illiquid-by-
  illegibility, the five machines (tape, score, provenance, attached
  servicing, surveillance), originate-to-distribute, 2008/holdouts, Kelly,
  the tollbooth; provenance line (ten agents, one chapter each).
- **Back meta:** dys5315.github.io/domvault/constellation · PolyForm
  Noncommercial 1.0.0. 2 × 1.2 in ISBN clear zone lower-right.
