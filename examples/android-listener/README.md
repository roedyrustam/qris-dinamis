# Android Notification Listener Companion

Contoh integrasi Android untuk meneruskan notifikasi pembayaran QRIS masuk (BCA, BRI/BRImo, Mandiri/Livin', BNI/wondr, GoPay/GoBiz, OVO, DANA, ShopeePay) secara otomatis ke `POST /v1/ingest/notification`.

## Opsi 1: Termux + Termux:API (Tanpa Compile APK)

1. Install **Termux** dan **Termux:API** di perangkat Android.
2. Berikan izin **Notification Access** ke Termux:API di pengaturan Android.
3. Jalankan:
   ```bash
   pkg install termux-api jq curl
   export QRIS_API_URL="https://api.domainanda.com"
   export QRIS_MERCHANT_ID="merch_xxxxx"
   export QRIS_API_KEY="qris_live_xxxxx"
   bash termux-bridge.sh
   ```

## Opsi 2: Native Android `NotificationListenerService` (Kotlin)

Salin [QrisNotificationListenerService.kt](./QrisNotificationListenerService.kt) ke proyek Android Anda, daftarkan service dengan `BIND_NOTIFICATION_LISTENER_SERVICE` di `AndroidManifest.xml`, lalu sesuaikan `apiBaseUrl`, `merchantId`, dan `apiKey`.
