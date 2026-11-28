// localStorage dibalut try/catch (mod peribadi, storan disekat). Hanya untuk kemudahan per pelawat.
export function get(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function forget(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* abaikan */
  }
}

const SESI = 'annur_sesi_v1';
export const getSession = () => get(SESI, null);
export const setSession = (token) => set(SESI, token);
export const clearSession = () => forget(SESI);
