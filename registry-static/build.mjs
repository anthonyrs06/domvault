// Build the static registry: frameworks/*.md → domvault-registry/universe.json
//
// The git repo IS the durable planet store (planets carry their write-back
// ids in frontmatter). This generator emits the same /universe response the
// Node registry serves, so the Explorer needs no changes. Rebuild + redeploy
// on every publish: `node registry-static/build.mjs` then
// `npx vercel deploy registry-static/domvault-registry --prod --yes --scope acme9`
//
// v3 additions (the edges are the product):
//   links   — per-planet outbound planet ids, mined from the markdown itself
//             (see mineLinks below). string[] to stay validate.ts-compatible.
//   content — the full markdown body. These files are already public in this
//             repo, so shipping them in the manifest is no new disclosure.
// Mining lives in exported pure functions so constellation/links.test.ts can
// verify it; the build only runs when this file is executed directly.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fmField = (fm, key) => {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const fmList = (fm, key) => {
  const raw = fmField(fm, key);
  if (!raw || !raw.startsWith('[')) return raw ? [raw] : [];
  return raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
};

/** Parse one frameworks/*.md file into a doc, or null if unpublishable. */
export function parseFramework(fn, txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  if (fmField(fm, 'publish') !== 'true') return null;
  const title = fmField(fm, 'title');
  const planetId = fmField(fm, 'planet_id');
  if (!title || !planetId) return null;
  const body = txt.slice(m[0].length).trim();
  // Summary = the epigraph (first blockquote after the H1), unwrapped.
  const quote = body.match(/^> ?(.+(?:\n> ?.+)*)/m);
  const summary = quote
    ? quote[1].split('\n').map((l) => l.replace(/^> ?/, '')).join(' ').trim()
    : null;
  return { fn, fm, title, planetId, body, summary };
}

// ---------------------------------------------------------------------------
// Link mining. Priority order:
//   1. explicit references — "## Related" entries, [[wiki-links]], and markdown
//      links to sibling .md files — resolved by title or slug;
//   2. full-title mentions of one framework inside another's body;
//   3. distinctive concept-phrase mentions: a title's non-stopword bigrams
//      (e.g. "kalman filter", "graph rag", "money node") or its corpus-unique
//      long unigrams (e.g. "apophenia", "streetlight") appearing in another
//      body. Phrases common across many bodies are dropped as generic, plus a
//      small curated blocklist of words the caps don't catch.
// Everything is deterministic — same corpus in, same edges out.
// ---------------------------------------------------------------------------
const STOP = new Set(('a an the is are was were of for to in on as and or your you it its this that ' +
  'with like one needs need be at by from vs dont don t s not no what when how why do does').split(' '));
// Survive the frequency caps but carry no conceptual signal between two notes.
const GENERIC = new Set(['function', 'machine', 'analysis', 'domains', 'intelligence', 'management',
  'managing', 'testing', 'production', 'protocol', 'construction', 'applications', 'parameters',
  'workflow', 'problem', 'predictable', 'ranking', 'primitive', 'coverage', 'case study']);

const norm = (s) => String(s).toLowerCase().replace(/[’‘']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slugOf = (fn) => fn.replace(/\.md$/, '');

/** Non-stopword adjacent bigrams of a title (its concept phrases). */
export function conceptPhrases(title) {
  const raw = norm(title).split(' ');
  const out = [];
  for (let i = 0; i < raw.length - 1; i++) {
    if (!STOP.has(raw[i]) && !STOP.has(raw[i + 1])) out.push(raw[i] + ' ' + raw[i + 1]);
  }
  return out;
}

/**
 * Mine undirected planet↔planet links from a doc corpus.
 * @param {Array<{fn,title,planetId,body}>} docs
 * @returns {Map<string, Set<string>>} planetId → linked planetIds (mirrored)
 */
export function mineLinks(docs) {
  const byTitle = new Map(docs.map((d) => [norm(d.title), d]));
  const bySlug = new Map(docs.map((d) => [slugOf(d.fn), d]));
  const bodies = docs.map((d) => ' ' + norm(d.body) + ' ');
  const bodyDf = new Map();
  const bdf = (ph) => {
    if (!bodyDf.has(ph)) bodyDf.set(ph, bodies.filter((b) => b.includes(' ' + ph + ' ')).length);
    return bodyDf.get(ph);
  };
  const MAX_BIGRAM_DF = Math.max(4, Math.round(docs.length * 0.15));
  const MAX_UNIGRAM_DF = 4;
  const titleDf = new Map();
  for (const d of docs) for (const t of new Set(norm(d.title).split(' '))) titleDf.set(t, (titleDf.get(t) || 0) + 1);

  const adj = new Map(docs.map((d) => [d.planetId, new Set()]));
  const connect = (a, b) => {
    if (a === b) return;
    adj.get(a.planetId).add(b.planetId);
    adj.get(b.planetId).add(a.planetId);
  };

  for (const d of docs) {
    // 1. explicit references (Related sections, wiki-links, sibling .md links)
    const related = d.body.match(/^## Related\n([\s\S]*?)(?=\n## |$)/m);
    for (const src of [related ? related[1] : '', d.body]) {
      if (!src) continue;
      for (const [, t] of src.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
        const hit = byTitle.get(norm(t)) || bySlug.get(t.trim());
        if (hit) connect(d, hit);
      }
      for (const [, t] of src.matchAll(/\]\((?:\.\/)?([a-z0-9-]+)\.md(?:#[^)]*)?\)/g)) {
        const hit = bySlug.get(t);
        if (hit) connect(d, hit);
      }
    }
    if (related) {
      // bare "- Some Title" bullets under ## Related resolve by title too
      for (const [, t] of related[1].matchAll(/^[-*]\s+(.+)$/gm)) {
        const hit = byTitle.get(norm(t.replace(/\[|\]|\(.*\)/g, '')));
        if (hit) connect(d, hit);
      }
    }
  }

  // 2 + 3. title / concept-phrase mentions
  for (let bi = 0; bi < docs.length; bi++) {
    const b = docs[bi];
    const phrases = [
      norm(b.title), // full-title mention always counts
      ...conceptPhrases(b.title).filter((p) => !GENERIC.has(p) && bdf(p) <= MAX_BIGRAM_DF),
      ...norm(b.title).split(' ').filter((t) =>
        !STOP.has(t) && !GENERIC.has(t) && t.length >= 7 && titleDf.get(t) === 1 && bdf(t) <= MAX_UNIGRAM_DF),
    ];
    for (let ai = 0; ai < docs.length; ai++) {
      if (ai === bi) continue;
      const nb = bodies[ai];
      if (phrases.some((p) => nb.includes(' ' + p + ' '))) connect(docs[ai], b);
    }
  }
  return adj;
}

// ---------------------------------------------------------------------------
// Build (runs only when executed directly: `node registry-static/build.mjs`)
// ---------------------------------------------------------------------------
export function buildUniverse(root) {
  const docs = [];
  for (const fn of readdirSync(join(root, 'frameworks')).sort()) {
    if (!fn.endsWith('.md')) continue;
    const doc = parseFramework(fn, readFileSync(join(root, 'frameworks', fn), 'utf8'));
    if (doc) docs.push(doc);
  }
  const adj = mineLinks(docs);
  const planets = docs.map((d) => ({
    id: d.planetId,
    title: d.title,
    summary: d.summary,
    author: { handle: 'dom', display: 'Dom Sadarangani', star: 'star_dom' },
    galaxy: fmList(d.fm, 'galaxy'),
    license: fmField(d.fm, 'license') || 'PolyForm-Noncommercial-1.0.0',
    links: [...adj.get(d.planetId)].sort(),
    origin: fmField(d.fm, 'origin'),
    content_hash: null,
    published_at: '2026-06-20T15:41:00Z', // the frameworks write-back commit
    version: 1,
    price: null,
    tags: fmList(d.fm, 'tags'),
    content: d.body,
  }));
  const edgeCount = [...adj.values()].reduce((n, s) => n + s.size, 0) / 2;
  return { planets, edgeCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = join(root, 'registry-static', 'domvault-registry');
  mkdirSync(outDir, { recursive: true });
  const { planets, edgeCount } = buildUniverse(root);

  writeFileSync(join(outDir, 'universe.json'), JSON.stringify({ planets }, null, 2));
  writeFileSync(join(outDir, 'vercel.json'), JSON.stringify({
    rewrites: [{ source: '/universe', destination: '/universe.json' }],
    headers: [{
      source: '/(.*)',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Cache-Control', value: 'public, max-age=300, must-revalidate' },
      ],
    }],
  }, null, 2));
  writeFileSync(join(outDir, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>Domvault Registry (static)</title>
<body style="font-family:ui-monospace,monospace;background:#05060e;color:#e8ecff;padding:2rem">
<h1>Domvault Registry</h1>
<p>Static, git-backed planet registry. ${planets.length} published planets, ${edgeCount} mined connections.</p>
<p><a style="color:#7c5cff" href="/universe">GET /universe</a> &middot;
<a style="color:#7c5cff" href="https://github.com/dys5315/domvault">source</a></p>
<p>Publishing is git-native: planets live in <code>frameworks/</code> with signed
write-back ids; pushing to main is the durable write path.</p></body>`);

  console.log(`wrote ${planets.length} planets (${edgeCount} links) → registry-static/domvault-registry/`);
}
