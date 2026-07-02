#!/usr/bin/env node
/**
 * book/externalization-check.mjs — verification gates for books published
 * out of the vault. A published derivative must read cleanly to an external
 * reader: no internal project/venture/person names, no vault-internal
 * [[wiki-links]], and no "written for Dom" possessives left over from the
 * private original.
 *
 * Usage:
 *   node book/externalization-check.mjs [file ...]
 *
 * With no arguments, checks The Agent Stack set:
 *   book/sources/the-agent-stack.md
 *   book/dist-agent-stack/index.html
 *   book/dist-agent-stack/print.html
 *
 * Exits 0 when every gate passes, 1 otherwise (each hit printed as
 * file:line: matched-text). Reuse for future books by passing their files.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const GATES = [
  {
    name: 'name scrub (internal projects / ventures / people, wiki-links)',
    re: /infinity billing|sitelync|vips|engagement os|cstech|brittney|spencer|doris|elev8te|\[\[/i,
  },
  {
    name: 'to-Dom audience leaks (the book must address the reader)',
    re: /for its owner|your vault|your notes|your own notes|you saved|you captured|your capture|your core craft|your second brain/i,
  },
  {
    name: 'rendered wiki-link citations (lib/md.mjs <cite class="ref">)',
    re: /<cite class="ref">/i,
    htmlOnly: true,
  },
];

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      join(HERE, 'sources', 'the-agent-stack.md'),
      join(HERE, 'dist-agent-stack', 'index.html'),
      join(HERE, 'dist-agent-stack', 'print.html'),
    ];

let failures = 0;

for (const file of files) {
  if (!existsSync(file)) {
    console.error(`MISSING  ${file}`);
    failures++;
    continue;
  }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const isHtml = /\.html?$/i.test(file);
  for (const gate of GATES) {
    if (gate.htmlOnly && !isHtml) continue;
    // Global, case-insensitive scan, line by line for reportable locations.
    const re = new RegExp(gate.re.source, 'gi');
    lines.forEach((line, i) => {
      let m;
      while ((m = re.exec(line)) !== null) {
        failures++;
        const ctx = line.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).trim();
        console.error(
          `FAIL [${gate.name}] ${relative(process.cwd(), file)}:${i + 1}: …${ctx}…`
        );
        if (m.index === re.lastIndex) re.lastIndex++; // zero-width safety
      }
      re.lastIndex = 0;
    });
  }
}

if (failures) {
  console.error(`\n${failures} gate hit(s). Externalization check FAILED.`);
  process.exit(1);
}
console.log(`Externalization check passed: ${files.length} file(s) clean.`);
