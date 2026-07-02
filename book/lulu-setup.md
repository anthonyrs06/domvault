# Hardcover print + dropshipping — Lulu setup

Everything below is ready except the steps that need the account owner.
Print files: `book/dist/interior.pdf` (108pp, 6×9in B&W) + `book/dist/cover.pdf`
(13.83×10.5in casewrap flat, built to the spec in `cover-spec.md`).

## Why Lulu

Print-on-demand hardcover with **built-in dropshipping**: a buyer orders from
the Lulu bookstore page (or your own site via Lulu Direct), Lulu prints one
copy and ships it to them, you collect the margin. No inventory, no shipping
labels, free to set up — you pay nothing until someone orders (except an
optional proof copy, recommended).

## Path A — Lulu bookstore listing (fastest; do this tonight)

1. Create/sign in at lulu.com → **Create** → **Print Book**.
2. Product: **Hardcover (casewrap)**, 6×9 in (US Trade), **B&W on standard
   (60#) cream or white**, 108 pages.
3. Upload `interior.pdf`. Lulu re-renders and shows a preview — page count
   must read 108.
4. Cover: choose "upload a one-piece cover". Lulu shows the **exact template
   size for your page count** — if it differs slightly from 13.83×10.5,
   regenerate: tweak the panel widths in `book/cover.html` to Lulu's numbers
   and rerun the render command in `book/README.md` (one-line change; the
   spine text auto-centers). Our spine assumption: 0.33in.
5. ISBN: use Lulu's **free ISBN** (needed for their bookstore; the barcode
   lands in the clear zone already reserved bottom-right of the back cover).
6. Pricing: Lulu shows the print cost (~$11–14 for this spec). Suggested list
   $29–34 → roughly $15–20 margin per copy. You set it; changeable later.
7. Distribution: enable **Lulu bookstore** (their page = the dropship
   storefront). Skip "global distribution" (Amazon/Ingram) for now — it adds
   review delays and margin cuts; revisit if the book gets traction.
8. **Order one proof copy** before sharing the link — POD covers deserve one
   physical check (spine alignment especially).
9. Copy the product URL.

## Path B — Lulu Direct (your own storefront, later)

Lulu Direct plugs the same product into Shopify/WooCommerce or the **Lulu
Print API** (REST, sandbox available) so orders placed on a site you control
are printed + dropshipped automatically. Natural fit once there's a
`buy` page on domvault-book.vercel.app or cstechpartner.com. Needs: Lulu
API keys (free developer account), then a small order-forwarding endpoint —
~an evening of work against their sandbox. Do Path A first; B reuses the
same product files.

## After the listing exists

- Add a "Buy the hardcover" link to the web book: add the anchor to the cover
  section in `book/build.mjs`, rebuild, redeploy:
  `node book/build.mjs && npx vercel deploy book/domvault-book --prod --yes --scope acme9`.
- Comment the product link under tonight's LinkedIn book post (better reach
  than editing the post).

## What only Dom can do
1. Lulu account login (or create one) — then either do steps 2–9 in ~20
   minutes, or hand me the session the way we did LinkedIn and I'll drive.
2. Approve the proof copy order (a few dollars + shipping).
