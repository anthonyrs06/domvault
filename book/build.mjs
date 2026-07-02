#!/usr/bin/env node
/**
 * book/build.mjs — builds "Compression Is the Through-Line" from frameworks/.
 *
 * Zero dependencies. Reads every published framework, groups chapters into
 * parts by primary galaxy, and emits:
 *   book/dist/index.html  — the web book (dark, cosmic, long-form reading)
 *   book/dist/print.html  — 6x9in print interior (black on white)
 *
 * Usage: node book/build.mjs
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frameworks');
const DIST = join(dirname(fileURLToPath(import.meta.url)), 'dist');

const BOOK = {
  title: 'Compression Is the Through-Line',
  subtitle: 'Frameworks for Seeing One Pattern Everywhere',
  author: 'Dom Sadarangani',
  source: 'Compiled from the Domvault Constellation',
  sourceUrl: 'https://dys5315.github.io/domvault/constellation/',
  sourceUrlShort: 'dys5315.github.io/domvault/constellation',
  license: 'PolyForm Noncommercial 1.0.0',
  licenseUrl: 'https://polyformproject.org/licenses/noncommercial/1.0.0/',
  requiredNotice: 'Required Notice: Copyright (c) 2026 Dom Sadarangani (Domvault / Constellation)',
  year: 2026,
};

const THESIS_SLUG = 'compression-is-the-through-line';

// ---------------------------------------------------------------------------
// Frontmatter parsing (simple regex parse — the corpus is uniform YAML)
// ---------------------------------------------------------------------------

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      meta[key] = val;
    }
  }
  return { meta, body: raw.slice(m[0].length) };
}

// ---------------------------------------------------------------------------
// Minimal Markdown → HTML (covers exactly what the corpus uses: headings,
// blockquotes, bold/italic/code, bullet + numbered lists, tables, hr, links)
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text) {
  // 1. Pull out code spans so no formatting applies inside them.
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // 2. Escape everything else.
  s = escapeHtml(s);
  // 3. Links, bold, italic (corpus uses *...* and **...** only).
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label, href) => `<a href="${href}">${label}</a>`
  );
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(>—–-])\*([^*\n]+)\*(?=[\s).,;:!?—–-]|$)/g, '$1<em>$2</em>');
  // 4. Restore code spans.
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  return s;
}

function mdToHtml(md, { headingShift = 0 } = {}) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;

  const isBlank = (l) => /^\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) { i++; continue; }

    // Horizontal rule
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(6, h[1].length + headingShift);
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote (consecutive `>` lines; blank `>` lines split paragraphs)
    if (/^\s*>/.test(line)) {
      const paras = [];
      let cur = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const content = lines[i].replace(/^\s*>\s?/, '');
        if (isBlank(content)) {
          if (cur.length) { paras.push(cur.join(' ')); cur = []; }
        } else {
          cur.push(content.trim());
        }
        i++;
      }
      if (cur.length) paras.push(cur.join(' '));
      out.push(
        `<blockquote>${paras.map((p) => `<p>${inline(p)}</p>`).join('')}</blockquote>`
      );
      continue;
    }

    // Table (| header | ... followed by |---|---| separator)
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(
          lines[i]
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim())
        );
        i++;
      }
      const header = rows[0];
      const body = rows.slice(2); // rows[1] is the separator
      const thead = `<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Unordered list (items may wrap onto indented continuation lines)
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, '').trim());
          i++;
        } else if (!isBlank(lines[i]) && /^\s+\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      out.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, '').trim());
          i++;
        } else if (!isBlank(lines[i]) && /^\s+\S/.test(lines[i]) && items.length) {
          items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      out.push(`<ol>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ol>`);
      continue;
    }

    // Paragraph — merge consecutive plain lines
    const para = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{1,6}\s|\s*>|\s*[-*]\s+|\s*\d+\.\s+|\s*\|)/.test(lines[i]) &&
      !/^\s*(---+|\*\*\*+|___+)\s*$/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Load and organize chapters
// ---------------------------------------------------------------------------

// Matches both per-file attribution footers used in the corpus:
//   "*Genericized from Dom's second brain, shared under PolyForm Noncommercial 1.0.0.*"
//   "*Genericized example from the Domvault engine. Original mental model © Dom
//    Sadarangani, shared under PolyForm Noncommercial 1.0.0.*"
const FOOTER_RE = /\n---+\s*\n\s*\*Genericized [^\n]*PolyForm Noncommercial 1\.0\.0\.\*\s*$/;

function loadChapters() {
  const chapters = [];
  const excluded = [];
  for (const file of readdirSync(SRC).sort()) {
    if (!file.endsWith('.md')) continue;
    if (file === 'README.md') { excluded.push({ file, reason: 'directory index, not a framework' }); continue; }
    const raw = readFileSync(join(SRC, file), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    if (String(meta.publish) !== 'true') {
      excluded.push({ file, reason: `publish: ${meta.publish ?? 'missing'}` });
      continue;
    }
    let text = body;
    // Drop the H1 (duplicate of the frontmatter title) …
    text = text.replace(/^\s*#\s+.*\r?\n/, '');
    // … and the repeated per-file attribution footer (stated once, on the
    // license page, instead of 52 times).
    text = text.replace(FOOTER_RE, '\n');
    // Split the epigraph (leading blockquote) from the body so both outputs
    // can style it as an epigraph.
    let epigraph = null;
    const epi = text.match(/^\s*((?:>.*\r?\n?)+)/);
    if (epi) {
      epigraph = mdToHtml(epi[1]).replace(/^<blockquote>|<\/blockquote>$/g, '');
      text = text.slice(epi[0].length);
    }
    chapters.push({
      slug: file.replace(/\.md$/, ''),
      title: meta.title,
      galaxy: Array.isArray(meta.galaxy) ? meta.galaxy : [meta.galaxy].filter(Boolean),
      origin: meta.origin,
      epigraphHtml: epigraph,
      bodyHtml: mdToHtml(text, { headingShift: 1 }), // source ## → h3
    });
  }
  return { chapters, excluded };
}

function humanizeGalaxy(slug) {
  return slug
    .split('-')
    .map((w) => (w === 'ai' ? 'AI' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function organize(chapters) {
  const thesis = chapters.find((c) => c.slug === THESIS_SLUG);
  if (!thesis) throw new Error(`thesis chapter ${THESIS_SLUG} not found`);
  const rest = chapters.filter((c) => c !== thesis);

  const byGalaxy = new Map();
  for (const c of rest) {
    const primary = c.galaxy[0] || 'frameworks';
    if (!byGalaxy.has(primary)) byGalaxy.set(primary, []);
    byGalaxy.get(primary).push(c);
  }

  const parts = [...byGalaxy.entries()]
    .map(([slug, chs]) => ({
      slug,
      name: humanizeGalaxy(slug),
      chapters: chs.sort((a, b) => a.title.localeCompare(b.title, 'en')),
    }))
    .sort(
      (a, b) =>
        b.chapters.length - a.chapters.length || a.name.localeCompare(b.name, 'en')
    );

  // Sequential chapter numbers across the whole book (intro unnumbered).
  let n = 0;
  for (const part of parts) for (const c of part.chapters) c.number = ++n;

  return { thesis, parts };
}

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

const AI_NOTE =
  `The thinking here is Dom&rsquo;s; the drafting was AI-assisted. Every chapter in this book ` +
  `is marked <code>origin: ai-generated</code> in its source file: each framework was ` +
  `genericized from Dom&rsquo;s private second brain by an AI agent working under his ` +
  `direction, then curated by him for publication. The same is true of the software the book ` +
  `came from &mdash; in the project&rsquo;s own words: &ldquo;I designed and directed it, but ` +
  `an AI agent wrote most of the code.&rdquo;`;

function licenseBodyHtml() {
  return `
<p>&copy; ${BOOK.year} ${BOOK.author}. All chapters are shared under the
<a href="${BOOK.licenseUrl}">PolyForm Noncommercial License 1.0.0</a>.</p>
<p>In plain English: you may read, copy, share, and adapt this material for any
noncommercial purpose, provided attribution stays intact. Commercial use requires
the author&rsquo;s written permission. The full license text is at
<a href="${BOOK.licenseUrl}">polyformproject.org/licenses/noncommercial/1.0.0</a>.</p>
<p class="notice"><code>${escapeHtml(BOOK.requiredNotice)}</code></p>
<p>Each chapter was genericized from Dom&rsquo;s second brain and published as a
framework in the Domvault Constellation
(<a href="${BOOK.sourceUrl}">${BOOK.sourceUrlShort}</a>), where every node is
content-addressed and signed so authorship is provable and forks carry lineage
back to the origin.</p>
<h3>A note on how this was written</h3>
<p>${AI_NOTE}</p>`;
}

// ---------------------------------------------------------------------------
// Web book (index.html)
// ---------------------------------------------------------------------------

function renderWeb({ thesis, parts }) {
  const tocParts = parts
    .map(
      (p, idx) => `
      <li class="toc-part"><span class="label">Part ${idx + 1}</span> ${p.name}
        <ol>
          ${p.chapters
            .map((c) => `<li><a href="#${c.slug}"><span class="n">${c.number}</span> ${inline(c.title)}</a></li>`)
            .join('\n          ')}
        </ol>
      </li>`
    )
    .join('\n');

  const chapterHtml = (c, kicker) => `
    <article class="chapter" id="${c.slug}">
      <header>
        <p class="kicker">${kicker}</p>
        <h2>${inline(c.title)}</h2>
      </header>
      ${c.epigraphHtml ? `<blockquote class="epigraph">${c.epigraphHtml}</blockquote>` : ''}
      ${c.bodyHtml}
    </article>`;

  const partsHtml = parts
    .map(
      (p, idx) => `
    <section class="part" id="part-${p.slug}">
      <div class="part-title">
        <p class="kicker">Part ${idx + 1}</p>
        <h1>${p.name}</h1>
      </div>
      ${p.chapters.map((c) => chapterHtml(c, `Chapter ${c.number} · ${p.name}`)).join('\n')}
    </section>`
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

  /* TOC */
  #toc { border-top: 1px solid var(--line); padding-top: 2.5rem; margin-bottom: 4rem; }
  #toc h2 { font-weight: 400; letter-spacing: .02em; }
  #toc > ol { list-style: none; padding: 0; margin: 0; }
  #toc .toc-part { margin: 1.6rem 0; font-size: 1.15rem; }
  #toc .toc-part .label { margin-right: .6em; }
  #toc .toc-part > ol { list-style: none; padding-left: 0; margin: .5rem 0 0; border-left: 1px solid var(--line); }
  #toc .toc-part > ol li { font-size: .98rem; margin: .35rem 0; padding-left: 1rem; }
  #toc .n { margin-right: .55em; color: var(--glow); }
  #toc a { color: var(--fg); }
  #toc a:hover { color: var(--accent); }
  .toc-intro { font-size: 1.15rem; }
  .toc-intro a, .toc-license a { color: var(--fg); }
  .toc-license { margin-top: 1.6rem; font-size: 1.05rem; }

  /* Parts & chapters */
  .part-title { padding: 6rem 0 1rem; border-top: 1px solid var(--line); margin-top: 5rem; }
  .part-title h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); font-weight: 400; margin: .4rem 0 0; }
  .chapter { margin-top: 5rem; }
  .chapter header h2 { font-size: clamp(1.45rem, 4vw, 1.9rem); font-weight: 400; line-height: 1.25; margin: .4rem 0 1.2rem; }
  .chapter h3 { font-size: 1.12rem; font-weight: 700; margin: 2.2rem 0 .6rem; color: var(--accent); }
  blockquote.epigraph {
    margin: 0 0 2rem;
    padding: .2rem 0 .2rem 1.2rem;
    border-left: 2px solid var(--glow);
    color: var(--muted);
    font-style: italic;
  }
  blockquote { margin: 1.5rem 0; padding-left: 1.2rem; border-left: 2px solid var(--line); color: var(--muted); }
  ul, ol { padding-left: 1.4rem; }
  li { margin: .4rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; font-size: .92em; }
  th, td { border: 1px solid var(--line); padding: .5rem .7rem; text-align: left; vertical-align: top; }
  th { background: var(--panel); font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: .78rem; letter-spacing: .05em; }
  strong { color: #fff; }

  /* License */
  #license { margin-top: 7rem; border-top: 1px solid var(--line); padding-top: 2.5rem; }
  #license h2 { font-weight: 400; }
  #license h3 { font-size: 1.05rem; color: var(--accent); }
  #license .notice code { display: inline-block; padding: .5em .8em; }

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

  <nav id="toc" aria-label="Table of contents">
    <h2>Contents</h2>
    <ol>
      <li class="toc-intro"><span class="label">Introduction</span> <a href="#${thesis.slug}">${inline(thesis.title)}</a></li>
${tocParts}
      <li class="toc-license"><span class="label">Colophon</span> <a href="#license">License &amp; Attribution</a></li>
    </ol>
  </nav>

  <section class="part" id="introduction">
    ${chapterHtml(thesis, 'Introduction')}
  </section>
${partsHtml}

  <section id="license">
    <h2>License &amp; Attribution</h2>
    ${licenseBodyHtml()}
  </section>
</main>
<a class="toc-link" href="#toc">Contents</a>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Print interior (print.html) — 6x9in, black on white
// ---------------------------------------------------------------------------

function renderPrint({ thesis, parts }) {
  const chapterHtml = (c, kicker) => `
  <article class="chapter">
    <header>
      <p class="kicker">${kicker}</p>
      <h2>${inline(c.title)}</h2>
    </header>
    ${c.epigraphHtml ? `<blockquote class="epigraph">${c.epigraphHtml}</blockquote>` : ''}
    ${c.bodyHtml}
  </article>`;

  const partsHtml = parts
    .map(
      (p, idx) => `
  <section class="part-page">
    <p class="kicker">Part ${idx + 1}</p>
    <h1>${p.name}</h1>
  </section>
${p.chapters.map((c) => chapterHtml(c, `Chapter ${c.number}`)).join('\n')}`
    )
    .join('\n');

  const tocParts = parts
    .map(
      (p, idx) => `
    <li class="toc-part"><span class="kicker">Part ${idx + 1}</span> ${p.name}
      <ol>
        ${p.chapters.map((c) => `<li><span class="n">${c.number}</span> ${inline(c.title)}</li>`).join('\n        ')}
      </ol>
    </li>`
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
  .half-title, .title-page, .copyright-page, .toc-page, .part-page {
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
  .toc-page > ol > li { margin: .75em 0; }
  .toc-page .toc-part { font-size: 11pt; }
  .toc-page .toc-part .kicker { display: inline; margin-right: .6em; }
  .toc-page .toc-part > ol { margin: .3em 0 0 1em; font-size: 9.5pt; }
  .toc-page .toc-part > ol li { margin: .18em 0; }
  .toc-page .n { display: inline-block; min-width: 1.6em; font-family: 'Courier New', Courier, monospace; font-size: 8pt; color: #444; }

  /* Parts & chapters */
  .part-page { text-align: center; }
  .part-page h1 { margin-top: 3in; font-size: 20pt; }
  .chapter { page-break-before: always; break-before: page; }
  .chapter header { margin-bottom: 1.4em; }
  .chapter header h2 { font-size: 15pt; line-height: 1.25; margin: 0; }
  .chapter h3 { font-size: 11pt; font-weight: 700; margin: 1.6em 0 .5em; }
  blockquote.epigraph {
    margin: 0 0 1.6em; padding: 0 0 0 1em;
    border-left: 1.5pt solid #000; font-style: italic; color: #222;
  }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: .75pt solid #777; color: #222; }
  ul, ol { padding-left: 1.3em; margin: .6em 0; }
  li { margin: .25em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 8.5pt; page-break-inside: avoid; }
  th, td { border: .75pt solid #555; padding: .35em .5em; text-align: left; vertical-align: top; }
  th { font-family: 'Courier New', Courier, monospace; font-size: 7.5pt; letter-spacing: .05em; }
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
  <div>${licenseBodyHtml()}</div>
</section>

<nav class="toc-page">
  <h2>Contents</h2>
  <ol>
    <li class="toc-part"><span class="kicker">Introduction</span> ${inline(thesis.title)}</li>
${tocParts}
  </ol>
</nav>

${chapterHtml(thesis, 'Introduction')}
${partsHtml}

</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { chapters, excluded } = loadChapters();
const org = organize(chapters);

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'index.html'), renderWeb(org));
writeFileSync(join(DIST, 'print.html'), renderPrint(org));

console.log(`Book: ${BOOK.title}`);
console.log(`Introduction: ${org.thesis.title}`);
for (const [i, p] of org.parts.entries()) {
  console.log(`Part ${i + 1}: ${p.name} (${p.chapters.length} chapters)`);
}
console.log(`Total chapters: ${chapters.length} (1 introduction + ${chapters.length - 1} in parts)`);
if (excluded.length) {
  console.log('Excluded:');
  for (const e of excluded) console.log(`  - ${e.file}: ${e.reason}`);
}
console.log(`Wrote ${join(DIST, 'index.html')}`);
console.log(`Wrote ${join(DIST, 'print.html')}`);
