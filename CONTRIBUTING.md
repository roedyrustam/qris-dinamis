# Contributing to QRIS Dinamis

Terima kasih atas minat Anda untuk berkontribusi di **QRIS Dinamis**! Semua bentuk kontribusi—mulai dari laporan bug, penambahan adapter bank/e-wallet baru, peningkatan SDK/CLI, hingga perbaikan dokumentasi—sangat kami hargai.

## 1. Persiapan Lokal (Local Setup)

Prasyarat: **Node.js >= 20** dan **pnpm >= 9**.

```bash
# 1. Fork repositori ini di GitHub, lalu clone fork Anda
git clone https://github.com/<username-anda>/qris-dinamis.git
cd qris-dinamis

# 2. Install dependensi seluruh workspace
pnpm install

# 3. Build, typecheck, dan jalankan seluruh test suite
pnpm build
pnpm typecheck
pnpm test
```

Untuk menjalankan mode development (API di `:3001` & Web Dashboard di `:5173`):

```bash
pnpm dev
```

## 2. Alur Pull Request (PR Workflow)

1. Buat branch baru dari `main` dengan penamaan yang jelas:
   - `feat/<nama-fitur>` (fitur baru, misal `feat/adapter-bsi`)
   - `fix/<nama-bug>` (perbaikan bug)
   - `docs/<topik>` (dokumentasi)
2. Pastikan kode Anda memenuhi standar berikut:
   - TypeScript strict mode lulus tanpa error (`pnpm typecheck`).
   - Seluruh test lama dan test baru lulus (`pnpm test`).
   - Tidak ada hardcoded secret/API key.
3. Gunakan format commit yang rapi (Conventional Commits, misal `feat: add BSI mobile notification adapter`).
4. Buka Pull Request ke branch `main` dan lengkapi checklist pada template PR.

## 3. Cara Menambah Adapter Bank / E-Wallet Baru

1. Tambahkan konfigurasi adapter pada `BANK_EWALLET_CONFIGS` di `apps/api/src/verifiers/bank-ewallet-adapters.ts`.
2. Tambahkan unit test di `apps/api/src/__tests__/verifiers.test.ts` (sertakan contoh teks notifikasi masuk dan kasus debit/keluar jika ada).
3. Jalankan `pnpm test` untuk memastikan semua test lulus.
