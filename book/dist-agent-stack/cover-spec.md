# Cover spec — *The Agent Stack* (6×9 hardcover)

Interior: `interior.pdf`, **48 pages**, 6×9 in trim, black-and-white.
Cover source: `book/cover-agent-stack.html` → rendered to `cover.pdf` /
`cover-preview.png` via `node book/make-cover.mjs cover-agent-stack.html dist-agent-stack`.

Two print rails are documented below. `cover.pdf` as shipped is built to the
**Lulu casewrap** canvas; for KDP, re-render against KDP's own template.

## Rail 1 — Lulu casewrap (hardcover, 6×9 US Trade)

Lulu case-wrap covers are a single flat image: back cover + spine + front
cover, plus a wrap allowance that folds around the boards.

**Spine width** (Lulu standard 60# / ~148 gsm B&W paper):

```
spine = pageCount × 0.0025 in + 0.06 in
      = 48 × 0.0025 + 0.06
      = 0.18 in
```

**Flat cover canvas** (wrap ≈ 0.75 in per edge for case-wrap):

```
width  = wrap + trimWidth + spine + trimWidth + wrap
       = 0.75 + 6 + 0.18 + 6 + 0.75      = 13.68 in
height = wrap + trimHeight + wrap
       = 0.75 + 9 + 0.75                 = 10.5 in
```

At 300 dpi: **4104 × 3150 px**.

> ⚠️ Confirm all of the above against **Lulu's cover calculator / downloadable
> template at upload time** (Lulu generates an exact template PDF for the
> chosen product + page count + paper). The spine formula and wrap allowance
> here are the working assumption, not verified against Lulu's current spec.
> Keep text at least 0.5 in away from the spine folds and wrap edges.
> Lulu's casewrap minimum is 24 pages — 48 clears it.

## Rail 2 — Amazon KDP case laminate (hardcover, 6×9)

KDP hardcovers ("case laminate") use a one-piece cover laid out on KDP's own
template.

**Spine width** (B&W interior):

```
spine = pageCount × 0.0025 in
      = 48 × 0.0025
      = 0.12 in
```

Full cover dimensions (bleed, board wrap, hinge and barcode zones) come from
KDP's official calculator — download the sized template at
**kdp.amazon.com/cover-calculator** for this trim + page count + paper, and lay
the art into it.

> ⚠️ Confirm the spine formula and every dimension against the **official KDP
> cover calculator at upload** — KDP rejects covers that miss its template by
> small margins.
>
> ⚠️ **Page-count gate:** KDP case-laminate hardcovers require **75–550
> pages**; at 48 pages this interior is *below KDP's hardcover minimum*. To
> use the KDP rail, either pad the interior with front/back matter to ≥75
> pages, or publish as a **KDP paperback** instead (B&W white-paper spine
> formula: `pages × 0.002252 in` ≈ 0.108 in — again, confirm in the
> calculator).

## Spine copy

**None.** At 0.18 in (Lulu) / 0.12 in (KDP) the spine is too narrow for
reliable type — Lulu recommends spine text only around 80+ pages. The spine
panel in `cover-agent-stack.html` is deliberately blank; if the page count
ever grows past ~80, add the rotated one-liner back (see `cover.html` in the
frameworks book for the pattern).

## Front cover copy

- **Title:** The Agent Stack
- **Subtitle:** How to Build AI That Actually Ships
- **Author:** Dom Sadarangani

Treatment matches the shelf: near-black field (`#05060e`), pale ink
(`#e8ecff`), violet accent (`#7c5cff`), serif title, small mono label for the
subtitle, faint star field. No other imagery.

## Back cover copy (~110 words, drawn from the book's own argument)

> The demo takes an afternoon; making it trustworthy takes months — and the
> model was never the hard part. Production AI is ten percent model, ninety
> percent plumbing. This book walks the ninety in the order you meet it
> building a real agent: memory that updates instead of hoards, retrieval that
> admits what it hasn't indexed, knowledge that keeps its structure,
> orchestration as many small minds behind one honest gate, evals that expect
> to be gamed, an attention budget spent on purpose. Underneath them all, one
> discipline: don't trust the model — make the structure carry the guarantee.
>
> Fittingly, an agent stack wrote it — ten agents, one chapter each, grounded
> in the author's own working notes.

Below the blurb, small mono type:

```
dys5315.github.io/domvault/constellation
PolyForm Noncommercial 1.0.0
```

(No ISBN barcode is assumed; both Lulu and KDP place their own in the
lower-right clear zone already reserved on the back cover — 2×1.2 in.)
