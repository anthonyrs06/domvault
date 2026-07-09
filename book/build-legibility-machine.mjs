#!/usr/bin/env node
/**
 * book/build-legibility-machine.mjs — builds "The Legibility Machine" from the single
 * compiled manuscript in book/sources/legibility-machine.md.
 *
 * Zero dependencies (shares book/lib/md.mjs with build.mjs). The manuscript
 * is one file with `## Chapter N — Title` headings; this splits it into ten
 * chapters and emits:
 *   book/dist-legibility-machine/index.html  — the web book (dark, cosmic, long-form)
 *   book/dist-legibility-machine/print.html  — 6x9in print interior (black on white)
 *
 * Usage: node book/build-legibility-machine.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, escapeHtml, inline, mdToHtml } from './lib/md.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'sources', 'legibility-machine.md');
const DIST = join(HERE, 'dist-legibility-machine');

const BOOK = {
  title: 'The Legibility Machine',
  subtitle: 'How Standardized Data Creates Markets',
  author: 'Dom Sadarangani',
  source: 'AI-drafted from the author’s working notes',
  sourceUrl: 'https://dys5315.github.io/domvault/constellation/',
  sourceUrlShort: 'dys5315.github.io/domvault/constellation',
  license: 'PolyForm Noncommercial 1.0.0',
  licenseUrl: 'https://polyformproject.org/licenses/noncommercial/1.0.0/',
  requiredNotice:
    'Required Notice: Copyright (c) 2026 Dom Sadarangani (Domvault / The Legibility Machine)',
  year: 2026,
  // Sibling volume, served next to index.html in the deploy dir.
  shelf: {
    href: 'index.html',
    title: 'The Agent Stack',
    desc: 'how to build AI that actually ships',
  },
};

// ---------------------------------------------------------------------------
// Tiny LaTeX → HTML (covers exactly what the manuscript uses: one displayed
// Kalman-gain fraction and inline single-letter variables like $Q$).
// ---------------------------------------------------------------------------

function texSpan(t) {
  return t
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\sigma/g, 'σ')
    .replace(/\^\{?\*\}?/g, '<sup>*</sup>')
    .replace(/\^2/g, '²')
    .replace(/_\{([^}]*)\}/g, '<sub>$1</sub>')
    .replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>')
    .trim();
}

function displayMathHtml(tex) {
  // Unwrap \text{} first so \frac arguments only nest braces one level deep.
  let s = tex.trim().replace(/\\text\{([^}]*)\}/g, '$1');
  const fracs = [];
  s = s.replace(
    /\\frac\{((?:[^{}]|\{[^{}]*\})*)\}\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_, num, den) => {
      fracs.push(
        `<span class="frac"><span class="num">${texSpan(num)}</span>` +
          `<span class="den">${texSpan(den)}</span></span>`
      );
      return `FRAC${fracs.length - 1}END`;
    }
  );
  s = texSpan(s);
  s = s.replace(/FRAC(\d+)END/g, (_, i) => fracs[Number(i)]);
  return `<div class="equation"><span class="math">${s}</span></div>`;
}

// ---------------------------------------------------------------------------
// Parse the manuscript
// ---------------------------------------------------------------------------

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function chapterBodyToHtml(text) {
  // Protect math from the Markdown pass, splice the rendered HTML back in.
  const blocks = [];
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    blocks.push(displayMathHtml(tex));
    return `\n\nMATHBLOCK${blocks.length - 1}\n\n`;
  });
  const inlines = [];
  text = text.replace(/\$([A-Za-z\\][A-Za-z0-9^*_{}\\]{0,16})\$/g, (_, tex) => {
    inlines.push(`<em class="mvar">${texSpan(tex)}</em>`);
    return `MATHINLINE${inlines.length - 1}`;
  });
  let html = mdToHtml(text); // manuscript sections use ### → h3 natively
  html = html.replace(/<p>MATHBLOCK(\d+)<\/p>/g, (_, i) => blocks[Number(i)]);
  html = html.replace(/MATHINLINE(\d+)/g, (_, i) => inlines[Number(i)]);
  return html;
}

function loadBook() {
  const raw = readFileSync(SRC, 'utf8');
  const { body } = parseFrontmatter(raw);

  const heads = [...body.matchAll(/^## Chapter (\d+) — (.+)$/gm)];
  if (!heads.length) throw new Error('no "## Chapter N — Title" headings found');

  // Front section: title/subtitle (already in BOOK) + the engine's headnote.
  const front = body.slice(0, heads[0].index);
  const headMatch = front.match(/^(?:>.*\r?\n?)+/m);
  const headnoteHtml = headMatch
    ? mdToHtml(headMatch[0]).replace(/^<blockquote>|<\/blockquote>$/g, '')
    : null;

  const chapters = heads.map((m, idx) => {
    const start = m.index + m[0].length;
    const end = idx + 1 < heads.length ? heads[idx + 1].index : body.length;
    let text = body.slice(start, end).trim();
    // Drop the `---` separator that precedes the next chapter heading.
    text = text.replace(/\n---+\s*$/, '').trim();
    // Peel off a trailing per-chapter sources line (`---` + `*Sources: …*`).
    let sourcesHtml = null;
    const sm = text.match(/\n---+\s*\n(\*Sources:[^\n]*\*)\s*$/);
    if (sm) {
      sourcesHtml = inline(sm[1].replace(/^\*|\*$/g, ''));
      text = text.slice(0, sm.index).trim();
    }
    return {
      number: Number(m[1]),
      title: m[2].trim(),
      slug: slugify(m[2]),
      bodyHtml: chapterBodyToHtml(text),
      sourcesHtml,
    };
  });

  return { headnoteHtml, chapters };
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

const PROVENANCE_1 =
  `Plainly: AI drafted this book, on purpose. Each of the ten chapters was drafted ` +
  `end-to-end by a single AI agent &mdash; ten agents, one chapter each &mdash; running ` +
  `inside the author&rsquo;s self-hosted note system (the Domvault) and grounded in its ` +
  `real notes: frameworks Dom Sadarangani wrote, and captures of what he had been ` +
  `reading. The book consolidates that material; it is not new reporting, and it should ` +
  `not be read as if it were. Dom built the system, set the argument, and directed and ` +
  `reviewed the result.`;

const PROVENANCE_2 = (shelfLink) =>
  `This edition has been edited for an outside reader: where the text says ` +
  `&ldquo;my vault&rdquo; or &ldquo;my notes,&rdquo; that is the author&rsquo;s system ` +
  `speaking; where it says &ldquo;you,&rdquo; it means you, the builder. Its sibling ` +
  `volume, ${shelfLink}, was written the same way, one agent per chapter, from the ` +
  `same working notes.`;

function licenseBodyHtml({ web }) {
  const shelfLink = web
    ? `<a href="${BOOK.shelf.href}"><em>${BOOK.shelf.title}</em></a>`
    : `<em>${BOOK.shelf.title}</em>`;
  return `
<p>&copy; ${BOOK.year} ${BOOK.author}. Shared under the
<a href="${BOOK.licenseUrl}">PolyForm Noncommercial License 1.0.0</a>.</p>
<p>In plain English: you may read, copy, share, and adapt this material for any
noncommercial purpose, provided attribution stays intact. Commercial use requires
the author&rsquo;s written permission. The full license text is at
<a href="${BOOK.licenseUrl}">polyformproject.org/licenses/noncommercial/1.0.0</a>.</p>
<p class="notice"><code>${escapeHtml(BOOK.requiredNotice)}</code></p>
<h3>How this book was written</h3>
<p>${PROVENANCE_1}</p>
<p>${PROVENANCE_2(shelfLink)} The vault&rsquo;s public face is the Domvault
Constellation (<a href="${BOOK.sourceUrl}">${BOOK.sourceUrlShort}</a>), where every
node is content-addressed and signed so authorship is provable.</p>`;
}

// ---------------------------------------------------------------------------
// Web book (index.html)
// ---------------------------------------------------------------------------

function renderWeb({ headnoteHtml, chapters }) {
  const toc = chapters
    .map(
      (c) =>
        `      <li><a href="#${c.slug}"><span class="n">${c.number}</span> ${inline(c.title)}</a></li>`
    )
    .join('\n');

  const chaptersHtml = chapters
    .map(
      (c) => `
  <article class="chapter" id="${c.slug}">
    <header>
      <p class="kicker">Chapter ${c.number}</p>
      <h2>${inline(c.title)}</h2>
    </header>
    ${c.bodyHtml}
    ${c.sourcesHtml ? `<p class="sources">${c.sourcesHtml}</p>` : ''}
  </article>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${BOOK.title} — ${BOOK.author}</title>
<meta name="description" content="${BOOK.subtitle}. ${BOOK.source}.">
<style>
  :root {
    --bg: #05060e;
    --fg: #e8ecff;
    --muted: #8b93c0;
    --panel: #0d1126;
    --line: #2a3260;
    --accent: #9db0ff;
    --glow: #7c5cff;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--bg);
    background-image:
      radial-gradient(1200px 600px at 70% -10%, rgba(124,92,255,.14), transparent 60%),
      radial-gradient(900px 500px at 10% 30%, rgba(157,176,255,.06), transparent 60%);
    background-attachment: fixed;
    color: var(--fg);
    font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    font-size: 1.075rem;
    line-height: 1.75;
  }
  main { max-width: 68ch; margin: 0 auto; padding: 0 1.25rem 6rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: .85em;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: .08em .35em;
  }
  hr { border: none; border-top: 1px solid var(--line); margin: 2.5rem auto; width: 8rem; }
  .kicker, .label, .n {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: .72rem;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* Cover */
  .cover { min-height: 88vh; display: flex; flex-direction: column; justify-content: center; padding: 4rem 0 3rem; }
  .cover .stars { color: var(--glow); letter-spacing: .5em; font-size: .8rem; margin-bottom: 2.25rem; }
  .cover h1 { font-size: clamp(2.1rem, 6vw, 3.4rem); line-height: 1.12; margin: 0 0 1rem; font-weight: 400; }
  .cover .subtitle { font-size: clamp(1.05rem, 2.6vw, 1.3rem); color: var(--muted); font-style: italic; margin: 0 0 2.5rem; }
  .cover .author { font-size: 1.1rem; margin: 0 0 .5rem; }
  .cover .compiled { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: .78rem; color: var(--muted); }

  /* Headnote (the engine's own preface blockquote) */
  .headnote { margin: 0 0 4rem; }
  blockquote.epigraph {
    margin: 0 0 2rem;
    padding: .2rem 0 .2rem 1.2rem;
    border-left: 2px solid var(--glow);
    color: var(--muted);
    font-style: italic;
  }

  /* TOC */
  #toc { border-top: 1px solid var(--line); padding-top: 2.5rem; margin-bottom: 4rem; }
  #toc h2 { font-weight: 400; letter-spacing: .02em; }
  #toc > ol { list-style: none; padding: 0; margin: 0; border-left: 1px solid var(--line); }
  #toc > ol > li { font-size: 1.02rem; margin: .45rem 0; padding-left: 1rem; }
  #toc .n { margin-right: .55em; color: var(--glow); }
  #toc a { color: var(--fg); }
  #toc a:hover { color: var(--accent); }
  .toc-license, .toc-shelf { margin-top: 1.6rem !important; font-size: .98rem !important; }
  .toc-license .label, .toc-shelf .label { margin-right: .6em; }

  /* Chapters */
  .chapter { margin-top: 5.5rem; border-top: 1px solid var(--line); padding-top: 3rem; }
  .chapter header h2 { font-size: clamp(1.45rem, 4vw, 1.9rem); font-weight: 400; line-height: 1.25; margin: .4rem 0 1.2rem; }
  .chapter h3 { font-size: 1.12rem; font-weight: 700; margin: 2.2rem 0 .6rem; color: var(--accent); }
  blockquote { margin: 1.5rem 0; padding-left: 1.2rem; border-left: 2px solid var(--line); color: var(--muted); }
  ul, ol { padding-left: 1.4rem; }
  li { margin: .4rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; font-size: .92em; }
  th, td { border: 1px solid var(--line); padding: .5rem .7rem; text-align: left; vertical-align: top; }
  th { background: var(--panel); font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: .78rem; letter-spacing: .05em; }
  strong { color: #fff; }
  cite.ref { font-style: italic; color: var(--accent); }
  .sources { margin-top: 2.5rem; font-size: .9rem; color: var(--muted); font-style: italic; }
  em.mvar { font-family: Georgia, serif; }

  /* Equation */
  .equation { margin: 1.9rem 0; text-align: center; font-size: 1.06em; }
  .equation .frac { display: inline-block; vertical-align: middle; text-align: center; margin: 0 .3em; }
  .equation .frac .num { display: block; padding: 0 .55em .14em; border-bottom: 1px solid var(--muted); }
  .equation .frac .den { display: block; padding: .14em .55em 0; }
  .equation sub { font-size: .72em; }

  /* License */
  #license { margin-top: 7rem; border-top: 1px solid var(--line); padding-top: 2.5rem; }
  #license h2 { font-weight: 400; }
  #license h3 { font-size: 1.05rem; color: var(--accent); }
  #license .notice code { display: inline-block; padding: .5em .8em; }

  /* Shelf footer */
  .shelf { margin-top: 4rem; border-top: 1px solid var(--line); padding-top: 2rem; color: var(--muted); }
  .shelf p { margin: .4rem 0; }

  /* Floating contents link */
  .toc-link {
    position: fixed; right: 1rem; bottom: 1rem; z-index: 10;
    background: var(--panel); border: 1px solid var(--line); border-radius: 999px;
    padding: .45rem .9rem;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: .74rem;
    letter-spacing: .1em; text-transform: uppercase; color: var(--muted);
  }
  .toc-link:hover { color: var(--accent); text-decoration: none; border-color: var(--accent); }

  @media (max-width: 600px) {
    body { font-size: 1rem; }
    main { padding: 0 1rem 5rem; }
    table { display: block; overflow-x: auto; }
  }
</style>
</head>
<body>
<main>
  <header class="cover" id="cover">
    <p class="stars" aria-hidden="true">✦ ✧ ✦</p>
    <h1>${BOOK.title}</h1>
    <p class="subtitle">${BOOK.subtitle}</p>
    <p class="author">${BOOK.author}</p>
    <p class="compiled">${BOOK.source} — <a href="${BOOK.sourceUrl}">${BOOK.sourceUrlShort}</a></p>
  </header>

${headnoteHtml ? `  <section class="headnote">
    <blockquote class="epigraph">${headnoteHtml}</blockquote>
  </section>
` : ''}
  <nav id="toc" aria-label="Table of contents">
    <h2>Contents</h2>
    <ol>
${toc}
      <li class="toc-license"><span class="label">Colophon</span> <a href="#license">License &amp; Provenance</a></li>
      <li class="toc-shelf"><span class="label">Also on the shelf</span> <a href="${BOOK.shelf.href}"><em>${BOOK.shelf.title}</em> (${BOOK.shelf.desc})</a></li>
    </ol>
  </nav>
${chaptersHtml}

  <section id="license">
    <h2>License &amp; Provenance</h2>
    ${licenseBodyHtml({ web: true })}
  </section>

  <footer class="shelf">
    <p class="kicker">Also on the shelf</p>
    <p><a href="${BOOK.shelf.href}"><em>${BOOK.shelf.title}</em></a> — ${BOOK.shelf.desc}.</p>
  </footer>
</main>
<a class="toc-link" href="#toc">Contents</a>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Print interior (print.html) — 6x9in, black on white
// ---------------------------------------------------------------------------

function renderPrint({ headnoteHtml, chapters }) {
  const toc = chapters
    .map(
      (c) => `    <li><span class="n">${c.number}</span> ${inline(c.title)}</li>`
    )
    .join('\n');

  const chaptersHtml = chapters
    .map(
      (c) => `
<article class="chapter">
  <header>
    <p class="kicker">Chapter ${c.number}</p>
    <h2>${inline(c.title)}</h2>
  </header>
  ${c.bodyHtml}
  ${c.sourcesHtml ? `<p class="sources">${c.sourcesHtml}</p>` : ''}
</article>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${BOOK.title} — print interior</title>
<style>
  @page {
    size: 6in 9in;
    margin: 0.75in 0.625in;
  }
  /* Mirrored margins: a slightly larger inner (gutter) edge. Ignored by
     engines without :left/:right support; the base rule above then applies. */
  @page :right { margin: 0.75in 0.55in 0.75in 0.7in; }
  @page :left  { margin: 0.75in 0.7in 0.75in 0.55in; }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 10.5pt;
    line-height: 1.5;
    color: #000;
    background: #fff;
  }
  p, li, blockquote { orphans: 3; widows: 3; }
  h1, h2, h3 { page-break-after: avoid; break-after: avoid; font-weight: 400; }
  a { color: #000; text-decoration: none; }
  code { font-family: 'Courier New', Courier, monospace; font-size: .9em; }
  hr { border: none; border-top: 1px solid #999; width: 6em; margin: 1.5em auto; }
  .kicker {
    font-family: 'Courier New', Courier, monospace;
    font-size: 7.5pt; letter-spacing: .18em; text-transform: uppercase; color: #444;
    margin: 0 0 .4em;
  }

  /* Front matter */
  .half-title, .title-page, .copyright-page, .toc-page, .epigraph-page {
    page-break-before: always; break-before: page;
  }
  .half-title { page-break-before: avoid; break-before: avoid; }
  .half-title, .title-page { text-align: center; }
  .half-title h1 { margin-top: 2.8in; font-size: 15pt; letter-spacing: .04em; }
  .title-page h1 { margin-top: 2.2in; font-size: 22pt; line-height: 1.2; margin-bottom: .3in; }
  .title-page .subtitle { font-style: italic; font-size: 11.5pt; margin-bottom: .9in; }
  .title-page .author { font-size: 13pt; margin-bottom: 1.4in; }
  .title-page .compiled { font-family: 'Courier New', Courier, monospace; font-size: 8pt; color: #333; }
  .copyright-page {
    font-size: 8.5pt; line-height: 1.55;
    /* pin the block to the bottom of a single 6x9 page (9in - 1.5in margins) */
    height: 7.4in; display: flex; flex-direction: column; justify-content: flex-end;
    page-break-inside: avoid; break-inside: avoid;
  }
  .copyright-page .notice code { font-size: 7.5pt; }
  .copyright-page h3 { font-size: 9.5pt; font-weight: 700; margin: 1.2em 0 .3em; }

  /* TOC */
  .toc-page h2 { font-size: 15pt; margin-bottom: 1em; }
  .toc-page ol { list-style: none; margin: 0; padding: 0; }
  .toc-page > ol > li { margin: .6em 0; font-size: 11pt; }
  .toc-page .n { display: inline-block; min-width: 1.6em; font-family: 'Courier New', Courier, monospace; font-size: 8pt; color: #444; }

  /* Epigraph page (the engine's headnote) */
  .epigraph-page blockquote {
    margin: 2.2in 0 0; padding: 0 0 0 1em;
    border-left: 1.5pt solid #000; font-style: italic; color: #222; font-size: 10pt;
  }

  /* Chapters */
  .chapter { page-break-before: always; break-before: page; }
  .chapter header { margin-bottom: 1.4em; }
  .chapter header h2 { font-size: 15pt; line-height: 1.25; margin: 0; }
  .chapter h3 { font-size: 11pt; font-weight: 700; margin: 1.6em 0 .5em; }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: .75pt solid #777; color: #222; }
  ul, ol { padding-left: 1.3em; margin: .6em 0; }
  li { margin: .25em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 8.5pt; page-break-inside: avoid; }
  th, td { border: .75pt solid #555; padding: .35em .5em; text-align: left; vertical-align: top; }
  th { font-family: 'Courier New', Courier, monospace; font-size: 7.5pt; letter-spacing: .05em; }
  cite.ref { font-style: italic; }
  .sources { margin-top: 1.8em; font-size: 8.5pt; color: #333; font-style: italic; }
  em.mvar { font-style: italic; }

  /* Equation */
  .equation { margin: 1.4em 0; text-align: center; page-break-inside: avoid; }
  .equation .frac { display: inline-block; vertical-align: middle; text-align: center; margin: 0 .3em; }
  .equation .frac .num { display: block; padding: 0 .5em .1em; border-bottom: .75pt solid #000; }
  .equation .frac .den { display: block; padding: .1em .5em 0; }
  .equation sub { font-size: .72em; }
</style>
</head>
<body>

<section class="half-title">
  <h1>${BOOK.title}</h1>
</section>

<section class="title-page">
  <h1>${BOOK.title}</h1>
  <p class="subtitle">${BOOK.subtitle}</p>
  <p class="author">${BOOK.author}</p>
  <p class="compiled">${BOOK.source}<br>${BOOK.sourceUrlShort}</p>
</section>

<section class="copyright-page">
  <div>${licenseBodyHtml({ web: false })}</div>
</section>

<nav class="toc-page">
  <h2>Contents</h2>
  <ol>
${toc}
  </ol>
</nav>

${headnoteHtml ? `<section class="epigraph-page">
  <blockquote>${headnoteHtml}</blockquote>
</section>
` : ''}
${chaptersHtml}

</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const book = loadBook();

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'index.html'), renderWeb(book));
writeFileSync(join(DIST, 'print.html'), renderPrint(book));

console.log(`Book: ${BOOK.title} — ${BOOK.subtitle}`);
for (const c of book.chapters) console.log(`Chapter ${c.number}: ${c.title}`);
console.log(`Total chapters: ${book.chapters.length}`);
console.log(`Wrote ${join(DIST, 'index.html')}`);
console.log(`Wrote ${join(DIST, 'print.html')}`);
