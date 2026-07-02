// Build the static registry: frameworks/*.md → domvault-registry/universe.json
//
// The git repo IS the durable planet store (planets carry their write-back
// ids in frontmatter). This generator emits the same /universe response the
// Node registry serves, so the Explorer needs no changes. Rebuild + redeploy
// on every publish: `node registry-static/build.mjs` then
// `npx vercel deploy registry-static/domvault-registry --prod --yes --scope acme9`
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'registry-static', 'domvault-registry');
mkdirSync(outDir, { recursive: true });

const fmField = (fm, key) => {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const fmList = (fm, key) => {
  const raw = fmField(fm, key);
  if (!raw || !raw.startsWith('[')) return raw ? [raw] : [];
  return raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
};

const planets = [];
for (const fn of readdirSync(join(root, 'frameworks')).sort()) {
  if (!fn.endsWith('.md')) continue;
  const txt = readFileSync(join(root, 'frameworks', fn), 'utf8');
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) continue;
  const fm = m[1];
  if (fmField(fm, 'publish') !== 'true') continue;
  const title = fmField(fm, 'title');
  const planetId = fmField(fm, 'planet_id');
  if (!title || !planetId) continue;

  // Summary = the epigraph (first blockquote after the H1), unwrapped.
  const body = txt.slice(m[0].length);
  const quote = body.match(/^> ?(.+(?:\n> ?.+)*)/m);
  const summary = quote
    ? quote[1].split('\n').map((l) => l.replace(/^> ?/, '')).join(' ').trim()
    : null;

  planets.push({
    id: planetId,
    title,
    summary,
    author: { handle: 'dom', display: 'Dom Sadarangani', star: 'star_dom' },
    galaxy: fmList(fm, 'galaxy'),
    license: fmField(fm, 'license') || 'PolyForm-Noncommercial-1.0.0',
    links: [],
    origin: fmField(fm, 'origin'),
    content_hash: null,
    published_at: '2026-06-20T15:41:00Z', // the frameworks write-back commit
    version: 1,
    price: null,
    tags: fmList(fm, 'tags'),
  });
}

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
<p>Static, git-backed planet registry. ${planets.length} published planets.</p>
<p><a style="color:#7c5cff" href="/universe">GET /universe</a> &middot;
<a style="color:#7c5cff" href="https://github.com/dys5315/domvault">source</a></p>
<p>Publishing is git-native: planets live in <code>frameworks/</code> with signed
write-back ids; pushing to main is the durable write path.</p></body>`);

console.log(`wrote ${planets.length} planets → registry-static/domvault-registry/`);
