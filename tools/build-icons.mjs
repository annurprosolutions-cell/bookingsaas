// Bina icons/sprite.svg daripada subset ikon Phosphor (regular, lesen MIT).
// Guna: node tools/build-icons.mjs <folder phosphor assets/regular>
// Dapatkan folder: npm pack @phosphor-icons/core@2 && tar -xzf phosphor-icons-core-*.tgz (package/assets/regular)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ICONS = [
  'arrow-left', 'arrow-right', 'arrows-clockwise', 'calendar-blank', 'caret-down', 'caret-left', 'caret-right', 'chat-circle',
  'check', 'check-circle', 'clock', 'copy', 'download-simple', 'envelope', 'eye', 'gear', 'google-logo', 'house', 'image',
  'info', 'link', 'list', 'lock', 'map-pin', 'minus', 'money', 'palette', 'pencil-simple', 'phone', 'plus', 'share-network',
  'sign-out', 'star', 'storefront', 'table', 'ticket', 'trash', 'user', 'users', 'warning', 'warning-circle', 'whatsapp-logo', 'x'
];

const dir = process.argv[2];
if (!dir) {
  console.error('Guna: node tools/build-icons.mjs <phosphor/assets/regular>');
  process.exit(1);
}
const symbols = ICONS.map((name) => {
  const svg = readFileSync(join(dir, name + '.svg'), 'utf8');
  const vb = /viewBox="([^"]+)"/.exec(svg)[1];
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  return `<symbol id="i-${name}" viewBox="${vb}">${inner}</symbol>`;
});
const out = `<svg xmlns="http://www.w3.org/2000/svg"><!-- Phosphor Icons (MIT) https://phosphoricons.com -->${symbols.join('')}</svg>\n`;
writeFileSync(new URL('../icons/sprite.svg', import.meta.url), out);
console.log(`icons/sprite.svg: ${ICONS.length} ikon, ${out.length} bait`);
