// Semakan kontrak repo: config awam sepadan dengan wrangler.jsonc, fail sensitif tidak diterbitkan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

function parseJsonc(text) {
  // buang komen baris (//) yang bukan dalam rentetan
  const noComments = text
    .split('\n')
    .map((line) => {
      let inStr = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"' && line[i - 1] !== '\\') inStr = !inStr;
        if (!inStr && c === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
  return JSON.parse(noComments);
}

test('wrangler.jsonc: binding dan migrasi DO SQLite', () => {
  const w = parseJsonc(read('wrangler.jsonc'));
  assert.equal(w.name, 'annur-booking');
  assert.equal(w.main, 'worker/index.mjs');
  assert.deepEqual(w.durable_objects.bindings, [{ name: 'TENANT_LOCK', class_name: 'TenantLock' }]);
  assert.deepEqual(w.migrations[0].new_sqlite_classes, ['TenantLock']);
  assert.ok(w.assets.run_worker_first.includes('/api/*'));
  assert.equal(w.keep_vars, true);
  // Tiada rahsia atau emel peribadi dalam vars
  const larangan = ['GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'TOKEN_ENC_KEY', 'ADMIN_TOKEN', 'BCL_WEBHOOK_KEY',
    'BCL_API_TOKEN', 'TURNSTILE_SECRET', 'OWNER_EMAILS', 'SPIKE_EMAILS'];
  for (const k of larangan) assert.ok(!(k in w.vars), k + ' tidak patut dalam vars (repo awam)');
});

test('config.js sepadan dengan vars wrangler.jsonc', () => {
  const w = parseJsonc(read('wrangler.jsonc'));
  const c = read('config.js');
  const cid = /googleClientId:\s*'([^']*)'/.exec(c)[1];
  const site = /turnstileSiteKey:\s*'([^']*)'/.exec(c)[1];
  assert.equal(cid, w.vars.GOOGLE_CLIENT_ID);
  assert.equal(site, w.vars.TURNSTILE_SITE_KEY);
});

test('.assetsignore menyorok kod Worker, ujian, alat dan dokumen', () => {
  const lines = read('.assetsignore').split('\n').map((s) => s.trim());
  for (const p of ['worker/', 'tests/', 'tools/', 'docs/', 'package.json', 'README.md', 'wrangler.jsonc', '.git', 'node_modules/', '.dev.vars', 'manual-pemilik/']) {
    assert.ok(lines.includes(p), p + ' mesti ada dalam .assetsignore');
  }
});
