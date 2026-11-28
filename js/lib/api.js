// Panggilan API ke Worker sendiri. Token sesi dihantar sebagai Authorization: Bearer.
import { getSession } from './store.js';

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'x-requested-with': 'XMLHttpRequest' };
  const sesi = getSession();
  if (sesi) headers.authorization = 'Bearer ' + sesi;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    const mesej = navigator.onLine === false ? 'Perlukan sambungan internet.' : 'Gagal, cuba lagi.';
    return { ok: false, status: 0, data: { ok: false, kod: 'rangkaian', mesej } };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, kod: 'respons', mesej: 'Respons tidak sah. Cuba lagi.' };
  }
  return { ok: res.ok && data && data.ok !== false, status: res.status, data };
}
