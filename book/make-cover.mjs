#!/usr/bin/env node
/**
 * book/make-cover.mjs — renders a flat cover HTML to PDF (+ PNG preview)
 * using Playwright's bundled Chromium. The canvas size is read from the
 * `@page { size: Win Hin; }` rule in the cover HTML.
 *
 * Usage:
 *   node book/make-cover.mjs cover.html dist                    # frameworks
 *   node book/make-cover.mjs cover-agent-stack.html dist-agent-stack
 *
 * Playwright is NOT a repo dependency; see make-pdf.mjs for options
 * (PLAYWRIGHT_PKG env var, or `npm i --no-save playwright`).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const coverFile = join(HERE, process.argv[2] ?? 'cover.html');
const distDir = join(HERE, process.argv[3] ?? 'dist');

const m = readFileSync(coverFile, 'utf8').match(
  /@page\s*\{\s*size:\s*([\d.]+)in\s+([\d.]+)in/
);
if (!m) throw new Error(`no "@page { size: ...in ...in }" rule in ${coverFile}`);
const [w, h] = [Number(m[1]), Number(m[2])];

const pkg = process.env.PLAYWRIGHT_PKG ?? 'playwright';
const { chromium } = await import(
  pkg.startsWith('/') ? pathToFileURL(join(pkg, 'index.mjs')).href : pkg
);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Math.round(w * 96), height: Math.round(h * 96) },
});
await page.goto(pathToFileURL(coverFile).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: join(distDir, 'cover.pdf'),
  width: `${w}in`,
  height: `${h}in`,
  printBackground: true,
  preferCSSPageSize: true,
});
await page.screenshot({ path: join(distDir, 'cover-preview.png'), fullPage: true });
await browser.close();
console.log(`Wrote ${join(distDir, 'cover.pdf')} (${w}in × ${h}in)`);
console.log(`Wrote ${join(distDir, 'cover-preview.png')}`);
