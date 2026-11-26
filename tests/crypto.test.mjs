import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  b64urlEncode, b64urlDecode, randomId, decodeEncKey, encryptText, decryptText,
  signSession, verifySession, safeEqual
} from '../worker/lib/crypto.js';
import { ENC_KEY, SESSION_SECRET } from './helpers.mjs';

test('base64url pergi-balik', () => {
  const u8 = new Uint8Array([0, 255, 251, 62, 63, 1, 2]);
  const s = b64urlEncode(u8);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(Array.from(b64urlDecode(s)), Array.from(u8));
});

test('randomId: panjang dan abjad', () => {
  const id = randomId(12);
  assert.equal(id.length, 12);
  assert.match(id, /^[a-z2-7]{12}$/);
  const ref = randomId(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  assert.match(ref, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.notEqual(randomId(12), randomId(12));
});

test('TOKEN_ENC_KEY mesti tepat 32 bait', () => {
  assert.ok(decodeEncKey(ENC_KEY));
  assert.equal(decodeEncKey(b64urlEncode(new Uint8Array(31))), null);
  assert.equal(decodeEncKey(b64urlEncode(new Uint8Array(33))), null);
  assert.equal(decodeEncKey(''), null);
  assert.equal(decodeEncKey('bukan base64!!'), null);
  // base64 standard dengan padding juga diterima
  assert.ok(decodeEncKey(Buffer.from(new Uint8Array(32).fill(9)).toString('base64')));
});

test('AES-GCM: enkripsi dan dekripsi refresh token', async () => {
  const t = await encryptText('1//rahsia-refresh-token', ENC_KEY);
  assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!t.includes('rahsia'));
  assert.equal(await decryptText(t, ENC_KEY), '1//rahsia-refresh-token');
  // IV rawak: dua enkripsi berbeza
  assert.notEqual(await encryptText('x', ENC_KEY), await encryptText('x', ENC_KEY));
});

test('AES-GCM: kunci salah atau data diusik ditolak', async () => {
  const t = await encryptText('abc', ENC_KEY);
  const lain = b64urlEncode(new Uint8Array(32).fill(1));
  await assert.rejects(() => decryptText(t, lain));
  const [iv, ct] = t.split('.');
  const usik = iv + '.' + (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
  await assert.rejects(() => decryptText(usik, ENC_KEY));
  await assert.rejects(() => encryptText('abc', 'pendek'));
});

test('sesi HMAC: sah, diusik, tamat', async () => {
  const now = Date.UTC(2026, 10, 26, 2, 0, 0);
  const tok = await signSession({ tid: 'abc', email: 'a@b.com', exp: now / 1000 + 60 }, SESSION_SECRET);
  const p = await verifySession(tok, SESSION_SECRET, now);
  assert.equal(p.tid, 'abc');
  assert.equal(await verifySession(tok, SESSION_SECRET, now + 61000), null, 'tamat');
  assert.equal(await verifySession(tok, 'x'.repeat(48), now), null, 'kunci lain');
  const [body, sig] = tok.split('.');
  const bodyLain = b64urlEncode(new TextEncoder().encode(JSON.stringify({ tid: 'lain', email: 'a@b.com', exp: now / 1000 + 60 })));
  assert.equal(await verifySession(bodyLain + '.' + sig, SESSION_SECRET, now), null, 'payload diusik');
  assert.equal(await verifySession(body, SESSION_SECRET, now), null);
  assert.equal(await verifySession('', SESSION_SECRET, now), null);
  await assert.rejects(() => signSession({ exp: 1 }, 'pendek'));
});

test('safeEqual', async () => {
  assert.equal(await safeEqual('abc', 'abc'), true);
  assert.equal(await safeEqual('abc', 'abd'), false);
  assert.equal(await safeEqual('abc', 'abcd'), false);
  assert.equal(await safeEqual('abc', undefined), false);
});
