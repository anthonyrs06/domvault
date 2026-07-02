# book/ — *Compression Is the Through-Line*

A book compiled from the 52 published frameworks in [`frameworks/`](../frameworks/).
The thesis framework (`compression-is-the-through-line.md`) is the introduction;
the remaining 51 chapters are grouped into parts by their primary `galaxy`
(ordered by descending chapter count, alphabetical within a part).

| Output | What it is |
|--------|------------|
| `dist/index.html` | Self-contained web book (dark, long-form reading layout) |
| `dist/print.html` | Same content restructured as a 6×9 in print interior |
| `dist/interior.pdf` | Print-ready interior PDF (108 pages, 6×9 in, B&W) |
| `dist/cover-spec.md` | Hardcover cover spec + copy for Lulu case-wrap |

## Rebuild

```sh
node book/build.mjs
```

Zero dependencies — it re-reads `frameworks/`, so new/edited frameworks are
picked up automatically (files with `publish: false` are skipped).

## Regenerate the interior PDF

Playwright is not a repo dependency; point the script at any Playwright ≥1.4x
install (its Chromium must be downloaded, e.g. `npx playwright install chromium`):

```sh
npm i --no-save playwright && node book/make-pdf.mjs
# or reuse an existing install:
PLAYWRIGHT_PKG=/path/to/node_modules/playwright node book/make-pdf.mjs
```

Re-check the page count afterwards — the spine width in `dist/cover-spec.md`
depends on it (`pages × 0.0025 in + 0.06 in`).

## Deploy the web book

```sh
npx vercel deploy book/dist --prod --yes --scope acme9
```

Suggested Vercel project name: `domvault-book`. (Not run automatically —
deploy deliberately.)

## Publish on Lulu (hardcover, 6×9 case-wrap)

1. lulu.com → Create → Print Book → **Hardcover, Case-wrap, 6×9 in (US Trade)**,
   B&W interior on standard (60#) paper.
2. Upload `dist/interior.pdf`. Lulu will validate margins/bleed (interior uses
   0.75 in top/bottom, ~0.55–0.7 in mirrored side margins, no bleed).
3. Note the final page count Lulu reports, then use **Lulu's cover calculator /
   template download** for the exact cover canvas; lay out the cover per
   `dist/cover-spec.md`.
4. Upload the cover, review the online proof spread-by-spread (especially the
   spine text fit), and order a single physical proof before publishing.

## License

Content © Dom Sadarangani, PolyForm Noncommercial 1.0.0 — same as the source
frameworks. The book's own license page (in both HTML outputs and the PDF)
carries the required notice and the AI-assistance disclosure.
