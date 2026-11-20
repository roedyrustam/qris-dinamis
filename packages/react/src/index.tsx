import { useEffect, useState } from 'react';
import type { TransactionRecord } from '@qris-dinamis/core';

export interface QrisStatusState {
  transaction: (TransactionRecord & { merchantName?: string | null; paidVia?: string | null }) | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  remainingSeconds: number;
}

export interface UseQrisStatusOptions {
  baseUrl?: string;
  transactionId: string;
  apiKey?: string;
  onPaid?: (tx: TransactionRecord) => void;
  onExpired?: (tx: TransactionRecord) => void;
}

export function useQrisStatus(options: UseQrisStatusOptions): QrisStatusState {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const [transaction, setTransaction] = useState<QrisStatusState['transaction']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const headers: Record<string, string> = {};
    if (options.apiKey) headers['X-Api-Key'] = options.apiKey;

    fetch(`${baseUrl}/v1/qris/${encodeURIComponent(options.transactionId)}`, { headers })
      .then(async (res) => {
        const data = (await res.json()) as {
          transaction?: QrisStatusState['transaction'];
          error?: string;
        };
        if (!res.ok || !data.transaction) {
          throw new Error(data.error ?? 'Failed to load QRIS transaction');
        }
        if (active) {
          setTransaction(data.transaction);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load QRIS transaction');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [baseUrl, options.transactionId, options.apiKey]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;

    const es = new EventSource(
      `${baseUrl}/v1/transactions/${encodeURIComponent(options.transactionId)}/events`,
    );
    es.onopen = () => setConnected(true);
    es.addEventListener('status', (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent<string>).data) as {
          status: TransactionRecord['status'];
          paidVia?: string | null;
          paidAt?: string | null;
        };
        setTransaction((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            status: payload.status,
            paidVia: payload.paidVia ?? prev.paidVia,
            paidAt: payload.paidAt ?? prev.paidAt,
          };
          if (payload.status === 'PAID' && prev.status !== 'PAID') {
            options.onPaid?.(next);
          } else if (payload.status === 'EXPIRED' && prev.status !== 'EXPIRED') {
            options.onExpired?.(next);
          }
          return next;
        });
        if (payload.status === 'PAID' || payload.status === 'EXPIRED') {
          es.close();
          setConnected(false);
        }
      } catch {
        // Ignore malformed SSE payload
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [baseUrl, options.transactionId]);

  useEffect(() => {
    if (!transaction || transaction.status !== 'PENDING') return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [transaction]);

  const remainingSeconds = transaction
    ? Math.max(0, Math.floor((new Date(transaction.expiresAt).getTime() - nowMs) / 1000))
    : 0;

  return { transaction, loading, error, connected, remainingSeconds };
}

export interface QrisCheckoutProps extends UseQrisStatusOptions {
  className?: string;
}

function formatIdr(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function QrisCheckout(props: QrisCheckoutProps) {
  const { transaction, loading, error, connected, remainingSeconds } = useQrisStatus(props);

  if (loading) {
    return <div className={props.className}>Loading QRIS payment...</div>;
  }
  if (error || !transaction) {
    return <div className={props.className}>{error ?? 'Transaction not found'}</div>;
  }

  const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const secs = String(remainingSeconds % 60).padStart(2, '0');

  return (
    <div
      className={props.className}
      style={{
        border: '1px solid #1e293b',
        borderRadius: 10,
        padding: 20,
        maxWidth: 380,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{transaction.merchantName ?? 'Pembayaran QRIS'}</strong>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          {transaction.status === 'PENDING' ? (connected ? 'LIVE' : 'CONNECTING') : transaction.status}
        </span>
      </div>

      {(transaction.qrDataUrl || transaction.qrSvg) && (
        <div
          style={{
            background: '#ffffff',
            padding: 12,
            borderRadius: 8,
            margin: '14px 0',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {transaction.qrDataUrl ? (
            <img
              src={transaction.qrDataUrl}
              alt="QRIS Payment"
              style={{ width: 240, height: 240, maxWidth: '100%', display: 'block', objectFit: 'contain' }}
            />
          ) : (
            <div dangerouslySetInnerHTML={{ __html: transaction.qrSvg ?? '' }} />
          )}
        </div>
      )}

      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {formatIdr(transaction.totalAmount)}
      </div>

      {transaction.uniqueCode > 0 && (
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
          {formatIdr(transaction.baseAmount)} + kode unik {transaction.uniqueCode}
        </div>
      )}

      {transaction.status === 'PENDING' && (
        <div style={{ fontSize: 13, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
          Berlaku: {mins}:{secs}
        </div>
      )}

      {transaction.status === 'PAID' && (
        <div style={{ marginTop: 10, color: '#10b981', fontWeight: 600 }}>
          Pembayaran Diterima {transaction.paidVia ? `(${transaction.paidVia})` : ''}
        </div>
      )}

      {transaction.status === 'EXPIRED' && (
        <div style={{ marginTop: 10, color: '#ef4444', fontWeight: 600 }}>
          QRIS Kedaluwarsa
        </div>
      )}
    </div>
  );
}
