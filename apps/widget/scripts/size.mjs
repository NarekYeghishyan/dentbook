// Бюджет бандла формы — 50 КБ gzip (CLAUDE.md, Шаг 6). Больше — сборка считается упавшей.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = 50;
const bundle = readFileSync(new URL('../dist/dentbook-widget.js', import.meta.url));
const kb = gzipSync(bundle).length / 1024;
console.log(`dentbook-widget.js: ${kb.toFixed(1)} KB gzip / limit ${LIMIT_KB} KB`);
if (kb > LIMIT_KB) process.exit(1);
