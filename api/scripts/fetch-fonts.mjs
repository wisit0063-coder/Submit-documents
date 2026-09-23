#!/usr/bin/env node
/**
 * Downloads the four Sarabun faces that pdfmake needs into assets/fonts/.
 *
 * Files that already exist are left alone, so a locally supplied font always
 * wins over the download. Uses the built-in fetch (Node 18+), so it runs in a
 * slim container without curl.
 *
 * Source: google/fonts repository, SIL Open Font License 1.1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/fonts');
const BASE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun';
const FACES = ['Regular', 'Bold', 'Italic', 'BoldItalic'];

// A real TTF is hundreds of KB; anything tiny is an error page, not a font.
const MIN_BYTES = 50_000;

fs.mkdirSync(FONT_DIR, { recursive: true });

let failed = false;

for (const face of FACES) {
  const name = `Sarabun-${face}.ttf`;
  const target = path.join(FONT_DIR, name);

  if (fs.existsSync(target) && fs.statSync(target).size >= MIN_BYTES) {
    console.log(`[fonts] ${name} already present`);
    continue;
  }

  try {
    const response = await fetch(`${BASE_URL}/${name}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_BYTES) throw new Error(`unexpected size ${bytes.length} bytes`);

    fs.writeFileSync(target, bytes);
    console.log(`[fonts] downloaded ${name} (${bytes.length} bytes)`);
  } catch (error) {
    failed = true;
    console.error(`[fonts] could not download ${name}: ${error.message}`);
  }
}

if (failed) {
  console.error('[fonts] PDF export will return FONT_NOT_INSTALLED until all four files exist.');
  process.exit(1);
}
