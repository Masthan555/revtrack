// Regenerates PWA icons from icons/icon.svg.
// Run: npm run build:icons
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svg = readFileSync(resolve(root, 'icons/icon.svg'));

const outputs = [
  { size: 192, path: 'icons/icon-192.png' },
  { size: 512, path: 'icons/icon-512.png' },
  { size: 180, path: 'icons/apple-touch-icon.png' },
];

for (const { size, path } of outputs) {
  await sharp(svg).resize(size, size).png().toFile(resolve(root, path));
  console.log(`✓ ${path} (${size}×${size})`);
}
