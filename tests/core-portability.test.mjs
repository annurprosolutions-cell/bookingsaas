// Modul js/core mesti jalan serentak dalam Node, Worker dan pelayar: tiada API Node, tiada kebergantungan luar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../js/core/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));

test('js/core mengandungi enam modul teras + dates', () => {
  assert.deepEqual(files.sort(), ['availability.js', 'dates.js', 'licence.js', 'pricing.js', 'sheet-schema.js', 'validate.js']);
});

test('js/core: import relatif sahaja, tiada node:/require/process/fs/Buffer', () => {
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.ok(m[1].startsWith('./'), `${f} import ${m[1]}`);
    assert.ok(!/\brequire\(/.test(src), f + ' guna require');
    assert.ok(!/\bprocess\./.test(src), f + ' guna process');
    assert.ok(!/\bBuffer\b/.test(src), f + ' guna Buffer');
    assert.ok(!/node:/.test(src), f + ' guna node:');
    assert.ok(!/\b(localStorage|document|window)\b/.test(src.replace(/\/\/.*$/gm, '')), f + ' guna API pelayar');
  }
});

test('js/core: semua modul boleh diimport serentak tanpa kitaran', async () => {
  for (const f of files) {
    const m = await import(new URL(f, dir));
    assert.ok(Object.keys(m).length > 0, f);
  }
});
