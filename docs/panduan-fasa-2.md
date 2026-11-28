# Panduan ujian Fasa 2: Daftar, wizard dan cipta Sheet

Guna **Gmail ujian** dalam tetingkap **Incognito**. Jangan guna emel studio sebenar.

## Sebelum mula (sekali sahaja)
1. Cloudflare > **Workers & Pages** > **annur-booking** > **Settings** > **Variables and Secrets**: padam var `SPIKE_EMAILS` (prototaip sudah dibuang).
2. Dalam Google Drive Gmail ujian: padam Sheet "Annur Booking - Prototaip (BOLEH PADAM)".
3. Pastikan Cloudflare sudah deploy versi terkini: **Workers & Pages** > **annur-booking** > **Deployments**, deployment teratas berstatus hijau. Buka `https://booking.annurpro.com/api/health`, mesti tunjuk `"versi":"0.2.0"`.

## Ujian 1: Daftar studio baharu
1. Buka https://booking.annurpro.com/daftar/
2. Tekan **Teruskan dengan Google**, pilih Gmail ujian. Pada skrin kebenaran, **tanda kotak Google Drive**.
3. Langkah 1: nama studio `Studio Ujian Annur`, pautan `ujian-annur`. Mesti keluar tanda hijau "Tersedia".
4. Langkah 2: isi nombor WhatsApp anda sendiri.
5. Langkah 3: cuba tekan warna oren. Mesti keluar amaran kontras dan butang "Guna warna dicadangkan".
6. Langkah 4: harga `80`, tambah satu add-on (contoh Frame, 30).
7. Langkah 5: tekan **Terbitkan**. Tunggu beberapa saat.
8. Skrin berjaya keluar dengan pautan `booking.annurpro.com/ujian-annur`.

Nota: halaman awam `/ujian-annur` belum wujud (dibina dalam Fasa 3), jadi pautan itu akan tunjuk 404 buat masa ini.

## Ujian 2: Semak Sheet dalam Drive
1. Tekan **Buka Google Sheet saya**.
2. Nama fail: "Annur Booking - Studio Ujian Annur (JANGAN PADAM)".
3. Mesti ada 10 tab: Info, Tetapan, Banner, Slot, Addon, HariSpecial, TarikhTutup, Tempahan, Review, Log.
4. Tab **Slot**: 26 slot (Pagi, Petang, Malam). Tab **Tetapan**: nama studio dan WhatsApp anda. Tab **Log**: satu baris "sistem, setup".
5. Baris 1 setiap tab dibekukan dan lajur `status` dalam Tempahan ada dropdown.

## Ujian 3: KV tiada data pelanggan
1. Cloudflare > **Storage & databases** > **Workers KV** > **annur-booking-registry** > **KV Pairs**.
2. Anda patut nampak kunci `tenant:...`, `slug:ujian-annur`, `owner:<emel ujian>`, `email:<emel ujian>` (trial), `trial:<emel ujian>`.
3. Tiada WhatsApp, alamat atau harga studio. Itu semua dalam Sheet.

## Ujian 4: Log keluar dan masuk semula
1. Dashboard > **Log keluar**.
2. Buka `/daftar/` dan log masuk semula dengan Gmail yang sama. Mesti terus ke dashboard (bukan wizard).

## Ujian 5: Tarik balik akses Google, kemudian sambung semula
1. Buka https://myaccount.google.com/connections (log masuk Gmail ujian).
2. Cari **Annur Booking**, tekan, kemudian **Delete all connections** (atau **Remove access**).
3. Kembali ke dashboard, muat semula halaman. Dalam beberapa saat, banner merah "Sambungan Google terputus" mesti keluar.
4. Tekan **Sambung semula Google**, pilih Gmail ujian, tanda kotak Drive.
5. Banner merah hilang dan lencana "Bersambung" kembali. Sheet lama digunakan semula (tiada Sheet baharu).

## Ujian 6 (pilihan): Sheet ke Tong Sampah
1. Dalam Drive, alihkan Sheet ke Tong Sampah.
2. Muat semula dashboard: mesti keluar amaran "Google Sheet anda berada dalam Tong Sampah".
3. Pulihkan Sheet dari Tong Sampah, muat semula: amaran hilang.

## Ujian 7 (paling akhir, pilihan): Padam akaun
1. Dashboard > **Padam akaun** > taip `ujian-annur` > **Padam akaun**.
2. Skrin "Akaun dipadam" keluar. Sheet masih ada dalam Drive.
3. Dalam KV, `tenant:`, `slug:` dan `owner:` hilang. `email:` dan `trial:` kekal (rekod billing dan elak trial berulang).

## Hantar kepada Claude
Senarai ujian 1 hingga 7: lulus atau gagal. Jika gagal, tangkapan skrin dan teks ralat. Jangan hantar token atau rahsia.
