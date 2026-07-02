# book/ — the shelf

Two full-length books built by the same zero-dependency pipeline
(shared Markdown machinery in [`lib/md.mjs`](lib/md.mjs)):

| Book | Source | Builder | Output dir |
|------|--------|---------|------------|
| *Compression Is the Through-Line* — Frameworks for Seeing One Pattern Everywhere | the 52 published frameworks in [`frameworks/`](../frameworks/) | `build.mjs` | `dist/` |
| *The Agent Stack* — How to Build AI That Actually Ships | single compiled manuscript [`sources/the-agent-stack.md`](sources/the-agent-stack.md) (10 chapters, split on its `## Chapter N — Title` headings) | `build-agent-stack.mjs` | `dist-agent-stack/` |

Each output dir contains:

| Output | What it is |
|--------|------------|
| `index.html` | Self-contained web book (dark, long-form reading layout) |
| `print.html` | Same content restructured as a 6×9 in print interior |
| `interior.pdf` | Print-ready interior PDF (6×9 in, B&W) — frameworks: 108 pp, agent stack: 48 pp |
| `cover.pdf` / `cover-preview.png` | Flat one-piece cover (Lulu casewrap canvas) |
| `cover-spec.md` | Cover spec + copy — Lulu casewrap **and** (agent stack) Amazon KDP case-laminate rails |

## Rebuild

```sh
node book/build.mjs               # frameworks book → book/dist/
node book/build-agent-stack.mjs   # The Agent Stack → book/dist-agent-stack/
```

Zero dependencies. `build.mjs` re-reads `frameworks/` (files with
`publish: false` are skipped); `build-agent-stack.mjs` re-reads
`sources/the-agent-stack.md` (repo-tracked copy of the vault manuscript at
`90-books/the-agent-stack/`, published deliberately).

## Regenerate the interior PDFs

Playwright is not a repo dependency; point the script at any Playwright ≥1.4x
install (its Chromium must be downloaded, e.g. `npx playwright install chromium`):

```sh
npm i --no-save playwright
node book/make-pdf.mjs                    # frameworks (dist/)
node book/make-pdf.mjs dist-agent-stack   # The Agent Stack
# or reuse an existing install:
PLAYWRIGHT_PKG=/path/to/node_modules/playwright node book/make-pdf.mjs dist-agent-stack
```

Re-check the page count afterwards — the spine width in each
`cover-spec.md` depends on it (Lulu: `pages × 0.0025 in + 0.06 in`;
KDP: `pages × 0.0025 in`).

## Regenerate the covers

The canvas size is read from the `@page` rule inside the cover HTML — when a
page count changes, update the spine/panel numbers in the cover HTML first
(they're commented at the top), then:

```sh
node book/make-cover.mjs cover.html dist                          # frameworks
node book/make-cover.mjs cover-agent-stack.html dist-agent-stack  # The Agent Stack
```

## Deploy the web shelf

The deploy dir is unchanged: [`domvault-book/`](domvault-book/) (Vercel
project `domvault-book`). It now serves both books:

- `index.html` — **The Agent Stack** (copied from `dist-agent-stack/index.html`)
- `frameworks.html` — **Compression Is the Through-Line** (the frameworks
  book, formerly `index.html`; copy of `dist/index.html`)

After a rebuild, refresh the copies and deploy:

```sh
cp book/dist-agent-stack/index.html book/domvault-book/index.html
cp book/dist/index.html            book/domvault-book/frameworks.html
npx vercel deploy book/domvault-book --prod --yes --scope acme9
```

(Not run automatically — deploy deliberately.)

## Print rails

**Lulu (hardcover, 6×9 casewrap)** — both books; see `lulu-setup.md` for the
full walkthrough and each `cover-spec.md` for the flat-canvas math
(`spine = pages × 0.0025 + 0.06 in`; wrap ≈ 0.75 in/edge). Upload
`interior.pdf`, then match the cover to Lulu's generated template at upload.

**Amazon KDP (hardcover case laminate, 6×9)** — documented for *The Agent
Stack* in `dist-agent-stack/cover-spec.md`
(`spine = pages × 0.0025 in` for B&W; template from
kdp.amazon.com/cover-calculator; **confirm against the official calculator at
upload**). Note the gate: KDP case laminate requires 75–550 pages — at 48
pages the Agent Stack interior is below the hardcover minimum (pad the
interior or use KDP paperback, `pages × 0.002252 in`).

## License

Content © Dom Sadarangani, PolyForm Noncommercial 1.0.0. Each book's license
page (web, print, and PDF) carries the required notice and a plain-language
provenance note: the frameworks were genericized from Dom's second brain by
AI agents under his direction; *The Agent Stack* was written by ten agents
(one chapter each) grounded in the vault's real notes — a consolidation of
what Dom wrote and what he'd been reading, not new reporting.
