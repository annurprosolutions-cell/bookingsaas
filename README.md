# Annur Booking

Sistem tempahan slot sesi fotografi untuk studio (multi-tenant). Setiap studio dapat halaman tempahan di `booking.annurpro.com/<slug>`, dashboard sendiri, dan **pangkalan data dalam Google Sheet milik studio**. Platform hanya menyimpan registry dan licence dalam Cloudflare KV.

Stack: PWA vanilla HTML/CSS/JS (tanpa build step) + satu Cloudflare Worker (static assets + API) + KV `REGISTRY` + Durable Object `TenantLock` (kunci anti double booking) + Google Sheets API (skop `drive.file`) + BCL untuk langganan.

## Status
- Fasa 0 (asas dan prototaip risiko): siap. Lihat `docs/panduan-fasa-0.md`.
- Fasa 1 (teras logik): siap. Modul tulen dalam `js/core/` dengan ujian unit.

## Struktur
| Laluan | Isi | Awam? |
|---|---|---|
| `index.html`, `config.js`, `css/`, `js/` | Frontend | Ya |
| `js/core/` | Logik tulen dikongsi pelayar, Worker dan Node: `dates`, `validate`, `pricing`, `availability`, `licence`, `sheet-schema` | Ya (tiada rahsia) |
| `platform/` | Konsol pemilik platform (Fasa 0: semak setup) | Ya (API dilindungi `ADMIN_TOKEN`) |
| `spike/` | Prototaip Fasa 0, dibuang selepas lulus | Ya (aktif hanya bila `SPIKE_EMAILS` diisi) |
| `worker/` | Kod Worker (`index.mjs`, `lib/`, `tenant-lock.js`) | Tidak |
| `tests/` | Ujian `node --test`; `tests/fixtures/` = KV dan Google/Sheets palsu | Tidak |
| `tools/jana-rahsia.html` | Penjana rahsia, dibuka secara lokal | Tidak |
| `docs/` | Panduan | Tidak |
| `_headers` | Header keselamatan dan CSP untuk fail statik | - |

Apa sahaja yang tidak disenaraikan dalam `.assetsignore` akan diterbitkan secara awam.

## Ujian
```bash
npm test
```
Tiada kebergantungan npm. Perlukan Node 20+.

Uji Worker secara lokal (pilihan): `npx wrangler dev` dengan fail `.dev.vars` (jangan commit) dan binding KV sementara.

## Deploy
Push ke `main`. Cloudflare Workers Builds deploy dalam ~30 saat. Naikkan `version` dalam `config.js` dan `worker/version.js` setiap release. Rollback: Cloudflare > Workers > annur-booking > Deployments.

Rahsia (`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `TOKEN_ENC_KEY`, `ADMIN_TOKEN`, `BCL_WEBHOOK_KEY`, `BCL_API_TOKEN`, `TURNSTILE_SECRET`) hanya dipasang di dashboard Cloudflare, tidak pernah dalam repo. `OWNER_EMAILS` dipasang di dashboard (jenis Text) dan dikekalkan oleh `keep_vars`.
