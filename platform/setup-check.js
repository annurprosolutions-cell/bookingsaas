// Halaman semak setup (BSD 6.2). Token tidak disimpan di mana-mana.
(function () {
  const f = document.getElementById('f');
  const tok = document.getElementById('tok');
  const go = document.getElementById('go');
  const ringkas = document.getElementById('ringkas');
  const senarai = document.getElementById('senarai');

  const LABEL = { ok: ['OK', 'b-ok'], kemudian: ['Kemudian', 'b-warn'], tiada: ['Tiada', 'b-bad'], salah: ['Semak', 'b-bad'] };

  function row(item) {
    const el = document.createElement('div');
    el.className = 'row';
    const b = document.createElement('span');
    const [txt, cls] = LABEL[item.status] || ['?', 'b-warn'];
    b.className = 'badge ' + cls;
    b.textContent = txt;
    const info = document.createElement('div');
    const n = document.createElement('div');
    n.className = 'nama';
    n.textContent = item.nama;
    const m = document.createElement('div');
    m.className = 'muted';
    m.textContent = item.jenis + ' · ' + item.nota;
    info.append(n, m);
    el.append(b, info);
    return el;
  }

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    go.textContent = 'Menyemak...';
    senarai.textContent = '';
    ringkas.textContent = '';
    try {
      const res = await fetch('/api/platform/setup-check', {
        headers: { authorization: 'Bearer ' + tok.value.trim() },
        cache: 'no-store'
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        ringkas.textContent = j.mesej || 'Gagal (' + res.status + ')';
        return;
      }
      ringkas.textContent = j.ok
        ? 'Semua yang wajib sudah hijau. Platform sedia untuk langkah seterusnya. (versi ' + j.versi + ')'
        : 'Belum lengkap: ' + j.gagal.join(', ');
      for (const it of j.items) senarai.append(row(it));
    } catch {
      ringkas.textContent = 'Gagal sambung ke server. Cuba lagi.';
    } finally {
      go.disabled = false;
      go.textContent = 'Semak sekarang';
    }
  });
})();
