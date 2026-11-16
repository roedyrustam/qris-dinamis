# `@qris-dinamis/cli`

CLI untuk mengonversi, memvalidasi, dan menginspeksi string QRIS serta menguji signature webhook secara lokal.

## Penggunaan

```bash
# Konversi QRIS statis ke dinamis
qris-dinamis convert "<STATIC_QRIS>" --amount 50000 --fee fixed:1500

# Render sebagai SVG atau Terminal ASCII
qris-dinamis convert "<STATIC_QRIS>" -a 50000 -f svg -o qris.svg
qris-dinamis convert "<STATIC_QRIS>" -a 50000 -f terminal

# Validasi & inspeksi TLV tag
qris-dinamis inspect "<QRIS>"

# Sign, verify, dan kirim test webhook bertanda tangan HMAC-SHA256
qris-dinamis webhook sign --secret whsec_123 --body '{"event":"payment.paid"}'
qris-dinamis webhook verify --secret whsec_123 --signature "t=...,v1=..." --body '{"event":"payment.paid"}'
qris-dinamis webhook test --url http://localhost:3001/webhook --secret whsec_123 --amount 50123
```
