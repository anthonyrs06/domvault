#!/usr/bin/env node
/**
 * book/make-pdf.mjs — renders book/dist/print.html to book/dist/interior.pdf
 * (6x9in, print-ready interior) using Playwright's bundled Chromium.
 *
 * Playwright is NOT a dependency of this repo. Either:
 *   npx --yes playwright@latest install chromium   # once
 *   PLAYWRIGHT_PKG=/path/to/node_modules/playwright node book/make-pdf.mjs
 * or install it ad hoc: npm i --no-save playwright && node book/make-pdf.mjs
 */

import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const input = pathToFileURL(join(HERE, 'dist', 'print.html')).href;
const output = join(HERE, 'dist', 'interior.pdf');

const pkg = process.env.PLAYWRIGHT_PKG ?? 'playwright';
const { chromium } = await import(
  pkg.startsWith('/') ? pathToFileURL(join(pkg, 'index.mjs')).href : pkg
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(input, { waitUntil: 'networkidle' });
await page.pdf({
  path: output,
  width: '6in',
  height: '9in',
  printBackground: false,
  preferCSSPageSize: true,
});
await browser.close();
console.log(`Wrote ${output}`);
