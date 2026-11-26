import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMutex } from '../worker/lib/mutex.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Model "slot kapasiti 1": semak -> await (panggilan Sheets) -> tanda terisi
function tempah(state) {
  return async () => {
    if (state.terisi >= 1) return false;
    await sleep(5);
    state.terisi++;
    return true;
  };
}

test('tanpa mutex: perlumbaan berlaku (bukti ujian bermakna)', async () => {
  const s = { terisi: 0 };
  const r = await Promise.all(Array.from({ length: 20 }, () => tempah(s)()));
  assert.ok(r.filter(Boolean).length > 1);
});

test('dengan mutex: 20 serentak, tepat 1 berjaya', async () => {
  const lock = createMutex();
  const s = { terisi: 0 };
  const r = await Promise.all(Array.from({ length: 20 }, () => lock(tempah(s))));
  assert.equal(r.filter(Boolean).length, 1);
  assert.equal(s.terisi, 1);
});

test('mutex: ralat dalam satu tugasan tidak menyekat yang seterusnya', async () => {
  const lock = createMutex();
  const urutan = [];
  const a = lock(async () => { urutan.push('a'); throw new Error('gagal'); });
  const b = lock(async () => { urutan.push('b'); return 'ok'; });
  await assert.rejects(a);
  assert.equal(await b, 'ok');
  assert.deepEqual(urutan, ['a', 'b']);
  await sleep(0);
  assert.equal(lock.pending(), 0);
});
