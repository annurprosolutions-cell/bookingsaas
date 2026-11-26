# Panduan Fasa 0: Akaun, rahsia dan prototaip

Untuk pemilik platform. Ikut susunan. Setiap langkah ada tanda **[Hantar ke Claude]** (nilai awam, selamat ditampal dalam chat) atau **[JANGAN tampal dalam chat]** (rahsia).

Nilai yang **selamat** dihantar dalam chat: Google Client ID, Cloudflare KV namespace ID, Turnstile Site Key, BCL form ID, URL `workers.dev`.
Nilai yang **tidak boleh** dihantar: Client secret, Turnstile Secret Key, semua nilai dari `jana-rahsia.html`, token API BCL.

Gunakan akaun Google **AnnurPro** (bukan akaun peribadi) untuk Google Cloud dan Search Console. Pastikan password manager dan 2FA sudah aktif di Google, Cloudflare, GitHub dan BCL.

---

## Bahagian 1: Boleh buat sekarang (tak bergantung pada kod)

### Langkah 1. Google Cloud (IPD 0.2)

**1a. Projek baharu**
1. Buka https://console.cloud.google.com dan log masuk dengan akaun AnnurPro.
2. Di bar atas, klik nama projek (sebelah logo Google Cloud) > **New Project**.
3. Project name: `Annur Booking` > **Create**. Tunggu notifikasi, kemudian klik **Select Project**.

**1b. Hidupkan API**
1. Menu ☰ > **APIs & Services** > **Library**.
2. Cari `Google Sheets API` > klik > **Enable**.
3. Kembali ke Library, cari `Google Drive API` > klik > **Enable**.

**1c. Skrin persetujuan (Google Auth Platform)**
Google telah menukar nama menu ini. Jika anda nampak "OAuth consent screen", ia akan membuka "Google Auth Platform".
1. Menu ☰ > **APIs & Services** > **OAuth consent screen** > **Get started**.
2. App name: `Annur Booking`. User support email: emel AnnurPro. **Next**.
3. Audience: **External**. **Next**.
4. Contact information: emel AnnurPro. **Next**.
5. Tanda setuju polisi > **Continue** > **Create**.
6. Menu kiri **Branding**:
   - Application home page: `https://booking.annurpro.com`
   - Application privacy policy link: `https://booking.annurpro.com/privasi`
   - Application terms of service link: `https://booking.annurpro.com/terma`
   - Authorized domains: **+ Add domain** > `annurpro.com`
   - **Jangan muat naik logo dulu** (logo mencetuskan semakan tambahan; kita hantar nama dahulu dalam Fasa 8).
   - **Save**.
   - Nota: halaman `/privasi` dan `/terma` belum wujud. Itu tidak mengapa sekarang, ia dibina dalam Fasa 6 sebelum verification.
7. Menu kiri **Data Access** > **Add or remove scopes**:
   - Tanda `openid` dan `.../auth/userinfo.email`.
   - Di bawah sekali, kotak **Manually add scopes**, tampal: `https://www.googleapis.com/auth/drive.file` > **Add to table**.
   - **Update** > **Save**.
   - Semak: ketiga-tiga skop berada di bahagian "non-sensitive scopes". Jika `drive.file` masuk "sensitive", beritahu Claude.
8. Menu kiri **Audience** > bawah "Publishing status" tekan **Publish app** > **Confirm**. Status menjadi **In production**.

**1d. OAuth Client**
1. Menu kiri **Clients** > **+ Create client**.
2. Application type: **Web application**. Name: `Annur Booking Web`.
3. **Authorized JavaScript origins** > **+ Add URI** > `https://booking.annurpro.com`
   (URL `workers.dev` ditambah dalam Langkah 8 nanti.)
4. **Authorized redirect URIs**: biarkan kosong.
5. **Create**. Satu kotak muncul dengan **Client ID** dan **Client secret**.
6. **Client secret: [JANGAN tampal dalam chat]**. Salin terus ke password manager SEKARANG (Google mungkin tidak tunjuk lagi selepas kotak ini ditutup). Boleh juga tekan **Download JSON** dan simpan fail itu di tempat selamat.
7. **Client ID: [Hantar ke Claude]**. Ia berakhir dengan `.apps.googleusercontent.com`.

### Langkah 2. Cloudflare KV (IPD 0.4, sebahagian)
1. Buka https://dash.cloudflare.com dan pilih akaun AnnurPro.
2. Menu kiri **Storage & databases** > **Workers KV** > **Create instance** (atau **Create namespace**).
3. Namespace name: `annur-booking-registry` > **Create**.
4. Dalam senarai, salin nilai lajur **ID** (32 aksara). **[Hantar ke Claude]**

Kenapa tidak bind di dashboard: setiap deploy dari GitHub menggunakan `wrangler.jsonc` sebagai sumber kebenaran dan akan memadam binding yang hanya dibuat di dashboard. Jadi Claude letak ID ini dalam `wrangler.jsonc`.

### Langkah 3. Turnstile (IPD 0.6)
1. Di dashboard Cloudflare, menu kiri cari **Turnstile** (guna kotak carian di atas jika tak nampak).
2. **Add widget**. Widget name: `Annur Booking`.
3. Hostname management > **Add hostnames** > `booking.annurpro.com`. (Hostname `workers.dev` ditambah dalam Langkah 8.)
4. Widget Mode: **Managed**. Pre-clearance: **No**. **Create**.
5. **Site Key: [Hantar ke Claude]**.
6. **Secret Key: [JANGAN tampal dalam chat]**. Simpan dalam password manager. Ia dipasang dalam Langkah 9.

### Langkah 4. Search Console (IPD 0.3)
Langkau jika `annurpro.com` sudah disahkan (contohnya untuk Kedai AnnurPro) dengan akaun Google yang sama.
1. Buka https://search.google.com/search-console > **Add property**.
2. Pilih **Domain** > `annurpro.com` > **Continue**.
3. Jika ada pilihan "Cloudflare" sebagai pembekal domain, tekan **Start verification** dan ikut arahan (automatik).
   Jika tiada: salin rekod TXT `google-site-verification=...`, kemudian di Cloudflare > `annurpro.com` > **DNS** > **Records** > **Add record**: Type `TXT`, Name `@`, Content (tampal) > **Save**. Kembali ke Search Console > **Verify** (boleh ambil beberapa minit).

### Langkah 5. Form BCL (IPD 0.8)
Pilihan paling mudah: benarkan Claude buat melalui connector BCL (salin daripada form Kedai AnnurPro, tukar nama, harga dan medan, dan **matikan webhook** yang tersalin supaya tidak menghantar ke Kedai).
Jika mahu buat sendiri di BCL:
- Tajuk: `ANNUR BOOKING - LANGGANAN`
- Item 1: `ANNUR BOOKING BULANAN` RM100, kuantiti dibenarkan
- Item 2: `ANNUR BOOKING TAHUNAN` RM1,000, kuantiti dibenarkan
- Custom field wajib: `E-mel Google untuk sistem` (teks bantuan: "Guna emel Google yang sama dengan akaun yang anda guna untuk login Annur Booking")
- Custom field pilihan: `Nama studio`
- Webhook: **belum** (diset dalam Fasa 5)
- Selepas siap: **form ID [Hantar ke Claude]**.

**Hantar kepada Claude:** Client ID, KV ID, Turnstile Site Key, (BCL form ID jika siap), dan kebenaran untuk push ke branch `main`.

---

## Bahagian 2: Selepas Claude kemas kini repo dan push ke `main`

### Langkah 6. Sambung repo ke Cloudflare Workers (IPD 0.4)
1. Dashboard Cloudflare > menu kiri **Workers & Pages** (bawah Compute) > **Create application**.
2. Pilih **Import a repository** > **Get started**.
3. Jika diminta, sambung GitHub: pasang aplikasi "Cloudflare Workers and Pages", pilih **Only select repositories** > `bookingsaas` > **Install & Authorize**.
4. Pilih repo `annurprosolutions-cell/bookingsaas` > **Begin setup** / **Next**.
5. **Project name: `annur-booking`** (mesti sama tepat, kalau tidak build gagal).
6. Build command: **kosong**. Deploy command: `npx wrangler deploy` (lalai). Path: `/`.
7. **Create and deploy**. Tunggu 1 hingga 2 minit sehingga status hijau.
8. Salin URL `https://annur-booking.<nama-anda>.workers.dev` dan buka. Anda patut nampak "Annur Booking - Sedang dibina". **[Hantar URL ke Claude]**

### Langkah 7. Domain sendiri (IPD 0.5)
1. **Workers & Pages** > **annur-booking** > tab **Settings** > **Domains & Routes** > **+ Add** > **Custom domain**.
2. Taip `booking.annurpro.com` > **Add domain**.
3. Tunggu beberapa minit, kemudian buka https://booking.annurpro.com.
   Jika ralat "record already exists": di DNS `annurpro.com`, padam rekod lama bernama `booking` dahulu (pastikan ia tidak digunakan), kemudian cuba lagi.

### Langkah 8. Tambah URL workers.dev
1. Google Cloud > Google Auth Platform > **Clients** > klik `Annur Booking Web` > **Authorized JavaScript origins** > **+ Add URI** > tampal URL `https://annur-booking.<nama-anda>.workers.dev` (tanpa `/` di hujung) > **Save**.
2. Cloudflare > **Turnstile** > widget `Annur Booking` > **Settings** / **Edit** > tambah hostname `annur-booking.<nama-anda>.workers.dev` > **Save**.

### Langkah 9. Pasang rahsia (IPD 0.7)
1. Buka GitHub > repo `bookingsaas` > folder `tools` > `jana-rahsia.html` > ikon **Download raw file** (anak panah ke bawah, kanan atas). Buka fail yang dimuat turun dalam Chrome (dua kali klik).
2. Untuk setiap nilai: Cloudflare > **Workers & Pages** > **annur-booking** > **Settings** > **Variables and Secrets** > **+ Add**:

| Variable name | Type | Value dari mana | Simpan dalam password manager? |
|---|---|---|---|
| `TOKEN_ENC_KEY` | Secret | jana-rahsia.html | **Ya, wajib** |
| `SESSION_SECRET` | Secret | jana-rahsia.html | Tidak perlu |
| `ADMIN_TOKEN` | Secret | jana-rahsia.html | **Ya, wajib** |
| `BCL_WEBHOOK_KEY` | Secret | jana-rahsia.html | **Ya, wajib** |
| `GOOGLE_CLIENT_SECRET` | Secret | password manager (Langkah 1d) | sudah ada |
| `TURNSTILE_SECRET` | Secret | password manager (Langkah 3) | sudah ada |
| `OWNER_EMAILS` | Text | emel Google AnnurPro anda (jika lebih dari satu, pisah dengan koma) | - |
| `SPIKE_EMAILS` | Text | emel **Gmail ujian** (untuk prototaip sahaja, dipadam selepas lulus) | - |

3. Selepas setiap satu (atau selepas semua), tekan **Deploy**.
4. `BCL_API_TOKEN` belum perlu. Ia dipasang dalam Fasa 5.

### Langkah 10. Semak setup (IPD 0.10)
1. Buka https://booking.annurpro.com/platform/
2. Taip `ADMIN_TOKEN` (salin dari password manager) > **Semak sekarang**.
3. Semua patut **OK**, kecuali `BCL_API_TOKEN` (**Kemudian**) dan `BCL_FORM_ID` jika form BCL belum siap.
4. Tangkap skrin dan hantar kepada Claude (skrin ini tidak menunjukkan sebarang nilai rahsia).

---

## Bahagian 3: Prototaip risiko (IPD 0.9)

Guna **Gmail ujian** (sama dengan `SPIKE_EMAILS`). Paling senang: buka tetingkap Incognito dan log masuk Gmail ujian di situ.

1. Buka https://booking.annurpro.com/spike/
2. **Ujian 1: Login Google & cipta Sheet.** Pilih Gmail ujian. Pada skrin kebenaran, pastikan kotak **Google Drive** ditanda. Keputusan patut tunjuk: Refresh token DITERIMA, Sheet DICIPTA, Drive API nampak fail YA. Buka pautan Sheet untuk lihat.
   - Jika keluar "Google tidak beri refresh token": tekan Login sekali lagi (sistem sudah tarik balik akses supaya Google tanya semula).
   - Jika keluar skrin "Google hasn't verified this app": tekan **Advanced** > **Go to booking.annurpro.com**. Ini normal sebelum branding verification.
3. **Ujian 2: Tulis satu baris dari Worker.** Semak Sheet, ada baris baru "worker-refresh-token".
4. **Ujian 3: Simulasi 20 serentak.** Patut tunjuk: tanpa kunci lebih dari 1 berjaya (bukti masalah wujud), dengan kunci **tepat 1/20**.
5. **Ujian 4: 5 serentak ke Sheet sebenar.** Patut tunjuk 1 berjaya dan **1 baris** dalam Sheet.
6. **Selepas sekurang-kurangnya 1 jam** (atau esok), buka semula halaman yang sama dan tekan **Ujian 2** sekali lagi. Ini membuktikan Worker masih boleh menulis selepas access token asal tamat.
7. Tekan **Salin laporan** dan tampal dalam chat. Laporan tidak mengandungi token.
8. Selepas Claude sahkan lulus: tekan **Padam data prototaip**, padam Sheet ujian dalam Drive Gmail ujian, dan padam var `SPIKE_EMAILS` di Cloudflare.

### Jika ada masalah
| Mesej | Sebab biasa | Cara betulkan |
|---|---|---|
| `origin_mismatch` atau `redirect_uri_mismatch` dalam popup | URL laman belum ada dalam Authorized JavaScript origins | Langkah 1d / 8 |
| Popup tidak keluar | Pelayar sekat popup | Benarkan popup untuk laman ini, tekan butang semula |
| "Prototaip belum aktif" | `SPIKE_EMAILS` belum dipasang | Langkah 9 |
| "Emel ini tiada dalam SPIKE_EMAILS" | Login dengan emel lain | Guna Gmail ujian yang sama |
| "Kebenaran Google Drive tidak ditanda" | Kotak Drive tidak ditanda | Login semula dan tanda kotak |
| `Google: invalid_client` | Client secret salah | Pasang semula `GOOGLE_CLIENT_SECRET` |
| `Google: PERMISSION_DENIED` | Sheets/Drive API belum di-enable | Langkah 1b |
