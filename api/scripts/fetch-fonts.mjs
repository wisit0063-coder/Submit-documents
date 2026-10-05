#!/usr/bin/env node
/**
 * Makes sure the four faces pdfmake needs are sitting in assets/fonts/.
 *
 * The memo is set in TH SarabunPSK, the face named in the government typing
 * rules, and those files are committed to the repository: the national fonts
 * have no stable URL to fetch from, and their licence (DIP & SIPA) grants the
 * right to redistribute them. So in a normal checkout this script finds
 * everything already in place and downloads nothing.
 *
 * The download path is kept for the fallback face only. If someone deletes the
 * committed fonts, Google's Sarabun still gets the build to a working PDF -
 * but the result is NOT the government face and reads about 1.47x larger at the
 * same point size, so the sizes in pdf.service.ts will look wrong. Restore the
 * real files rather than shipping that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/fonts');
const BASE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun';
const FACES = ['Regular', 'Bold', 'Italic', 'BoldItalic'];

// A real TTF is hundreds of KB; anything tiny is an error page, not a font.
const MIN_BYTES = 50_000;

const present = (name) => {
  const file = path.join(FONT_DIR, name);
  return fs.existsSync(file) && fs.statSync(file).size >= MIN_BYTES;
};

fs.mkdirSync(FONT_DIR, { recursive: true });

const government = FACES.map((face) => `THSarabunPSK-${face}.ttf`);
const missingGovernment = government.filter((name) => !present(name));

if (missingGovernment.length === 0) {
  console.log('[fonts] TH SarabunPSK present - nothing to download');
  process.exit(0);
}

console.warn(
  `[fonts] TH SarabunPSK is missing (${missingGovernment.join(', ')}). ` +
    'Falling back to Google Sarabun, which is NOT the government face.',
);

let failed = false;

for (const face of FACES) {
  const name = `Sarabun-${face}.ttf`;
  const target = path.join(FONT_DIR, name);

  if (present(name)) {
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
