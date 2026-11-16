# `@qris-dinamis/react`

Drop-in React checkout component & real-time SSE hook untuk QRIS Dinamis.

## Instalasi

```bash
npm install @qris-dinamis/react @qris-dinamis/core
```

## Penggunaan

```tsx
import { QrisCheckout } from '@qris-dinamis/react';

export function PayModal({ transactionId }: { transactionId: string }) {
  return (
    <QrisCheckout
      baseUrl="https://api.domainanda.com"
      transactionId={transactionId}
      onPaid={(tx) => console.log('Paid!', tx.id)}
    />
  );
}
```
