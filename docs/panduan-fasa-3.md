# Panduan ujian Fasa 3: Halaman awam dan tempahan

Perlu studio ujian dari Fasa 2 dahulu (`docs/panduan-fasa-2.md`, ujian 1 dan 2). Semua ujian di bawah boleh dibuat dari telefon.

Sebelum mula: buka `https://booking.annurpro.com/api/health`, mesti tunjuk `"versi":"0.3.0"`.

## Ujian 1: Halaman utama studio (S-11)
1. Buka `https://booking.annurpro.com/ujian-annur` (slug studio ujian anda).
2. Semak: nama studio, warna tema, kad "Tempah Sekarang" dan "Semak Status", waktu operasi, lokasi, butang WhatsApp hijau di bawah kanan.
3. Tekan butang WhatsApp: WhatsApp dibuka ke nombor studio.
4. Kongsi pautan dalam WhatsApp: pratonton mesti tunjuk nama studio.

## Ujian 2: Tempah (S-12 hingga S-16)
1. Tekan **Tempah Sekarang**, baca memo, tekan **Saya Faham dan Teruskan**.
2. Pilih tarikh, tekan **Seterusnya**.
3. Pilih 2 slot. Bar bawah tunjuk "2 slot dipilih" dan anggaran harga.
4. Isi nama, telefon, tanda persetujuan, tunggu kotak anti-spam (Turnstile) selesai, tekan **Sahkan Tempahan**.
5. Skrin "Tempahan diterima" dengan Ref ID (contoh AB-K7M2QP). Tekan **Hantar WhatsApp ke studio**: mesej berisi Ref, nama, tarikh, slot, pax dan jumlah.
6. Buka Google Sheet studio > tab **Tempahan**: satu baris baharu, status PENDING, jumlah betul.

## Ujian 3: Slot penuh (tiada double booking)
1. Kembali ke halaman studio dan pilih tarikh yang sama.
2. Dua slot tadi mesti kelabu dengan label "Penuh" dan tidak boleh ditekan.

## Ujian 4: Semak status (S-17)
1. Tekan **Status** di bar bawah.
2. Masukkan Ref ID dan nombor telefon yang sama: status "Menunggu deposit" keluar.
3. Cuba nombor telefon lain dengan Ref yang sama: mesti "Tiada tempahan sepadan".

## Ujian 5: CANCEL melepaskan slot
1. Dalam Sheet, tukar status tempahan tadi kepada **CANCEL** (guna dropdown).
2. Tunggu 5 minit, kemudian buka semula halaman pilih slot untuk tarikh itu: slot kembali boleh dipilih.
   (Dalam Fasa 4, tukar status dari dashboard akan melepaskan slot serta-merta.)

## Ujian 6: Tutup tempahan (S-21)
1. Dalam Sheet tab **Tetapan**, tukar `tempahan_aktif` kepada `FALSE`.
2. Tunggu 1 minit, buka halaman studio: "Tempahan ditutup buat masa ini" dengan butang WhatsApp.
3. Tukar semula kepada `TRUE`.

## Ujian 7: Pautan salah
1. Buka `https://booking.annurpro.com/tiada-studio-ini`: halaman "Halaman tidak dijumpai".

## Hantar kepada Claude
Senarai ujian 1 hingga 7: lulus atau gagal, dengan tangkapan skrin jika gagal.
