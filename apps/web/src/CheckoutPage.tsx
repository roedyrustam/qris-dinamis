import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Copy, Download, XCircle } from 'lucide-react';

interface CheckoutTransaction {
  id: string;
  merchantId: string;
  merchantName: string | null;
  externalId: string | null;
  baseAmount: number;
  uniqueCode: number;
  totalAmount: number;
  qrSvg: string;
  qrDataUrl: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  paidVia: string | null;
  paidAt: string | null;
  expiresAt: string;
}

function formatIdr(amount: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCountdown(expiresAt: string, nowMs: number): string {
  const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000));
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function CheckoutPage({
  transactionId,
  onBack,
}: {
  transactionId: string;
  onBack: () => void;
}) {
  const [tx, setTx] = useState<CheckoutTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sseConnected, setSseConnected] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/v1/qris/${encodeURIComponent(transactionId)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Transaksi tidak ditemukan');
        if (active) setTx(data.transaction);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat transaksi');
      });

    return () => {
      active = false;
    };
  }, [transactionId]);

  useEffect(() => {
    const es = new EventSource(`/v1/transactions/${encodeURIComponent(transactionId)}/events`);
    es.onopen = () => setSseConnected(true);
    es.addEventListener('status', (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent<string>).data) as {
          status: CheckoutTransaction['status'];
          paidVia?: string | null;
          paidAt?: string | null;
        };
        setTx((prev) =>
          prev
            ? {
                ...prev,
                status: payload.status,
                paidVia: payload.paidVia ?? prev.paidVia,
                paidAt: payload.paidAt ?? prev.paidAt,
              }
            : prev,
        );
        if (payload.status === 'PAID' || payload.status === 'EXPIRED') {
          es.close();
          setSseConnected(false);
        }
      } catch {
        // Ignore malformed SSE event payload
      }
    });
    es.onerror = () => setSseConnected(false);
    return () => {
      es.close();
    };
  }, [transactionId]);

  useEffect(() => {
    if (!tx || tx.status !== 'PENDING') return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [tx]);

  async function handleCopyAmount() {
    if (!tx) return;
    await navigator.clipboard.writeText(String(tx.totalAmount));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleSimulatePay() {
    if (!tx) return;
    await fetch('/v1/sandbox/simulate-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: tx.id }),
    });
  }

  return (
    <div style={{ maxWidth: 460, margin: '24px auto' }}>
      <div className="card" style={{ padding: 24 }}>
        {error && (
          <div style={{ color: '#f87171', fontSize: 14 }}>
            <p style={{ marginTop: 0 }}>{error}</p>
            <button className="btn" onClick={onBack}>
              Kembali ke Dashboard
            </button>
          </div>
        )}

        {!error && !tx && <p style={{ color: '#94a3b8', margin: 0 }}>Memuat halaman pembayaran QRIS...</p>}

        {tx && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Pembayaran QRIS
                </div>
                <h2 style={{ margin: '2px 0 0', fontSize: 18 }}>{tx.merchantName ?? tx.merchantId}</h2>
              </div>
              <span
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: '1px solid #334155',
                  color: sseConnected ? '#34d399' : '#94a3b8',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {tx.status === 'PENDING' ? (sseConnected ? 'LIVE SSE' : 'CONNECTING') : tx.status}
              </span>
            </div>

            {tx.status === 'PAID' && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 8,
                  border: '1px solid #065f46',
                  background: '#064e3b33',
                  marginBottom: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34d399', fontWeight: 600 }}>
                  <CheckCircle2 size={18} /> Pembayaran Diterima
                </div>
                <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  Total: {formatIdr(tx.totalAmount)} {tx.paidVia ? `via ${tx.paidVia}` : ''}
                </div>
              </div>
            )}

            {tx.status === 'EXPIRED' && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 8,
                  border: '1px solid #7f1d1d',
                  background: '#7f1d1d33',
                  marginBottom: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f87171', fontWeight: 600 }}>
                  <XCircle size={18} /> QRIS Kedaluwarsa
                </div>
                <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>
                  Batas waktu pembayaran telah berakhir. Silakan buat transaksi baru.
                </div>
              </div>
            )}

            <div
              style={{
                background: '#ffffff',
                padding: 16,
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'center',
                marginBottom: 16,
              }}
              dangerouslySetInnerHTML={{ __html: tx.qrSvg }}
            />

            <div
              style={{
                border: '1px solid #1e293b',
                borderRadius: 8,
                padding: 14,
                marginBottom: 16,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>Total Bayar (Exact)</span>
                <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={handleCopyAmount}>
                  <Copy size={12} /> {copied ? 'Tersalin' : 'Salin'}
                </button>
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{formatIdr(tx.totalAmount)}</div>
              {tx.uniqueCode > 0 && (
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                  Nominal {formatIdr(tx.baseAmount)} + Kode Unik {tx.uniqueCode}
                </div>
              )}
              {tx.status === 'PENDING' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#fbbf24', marginTop: 10 }}>
                  <Clock size={14} /> Berlaku {formatCountdown(tx.expiresAt, nowMs)}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a
                className="btn"
                href={tx.qrDataUrl}
                download={`qris-${tx.id}.png`}
                style={{ textDecoration: 'none' }}
              >
                <Download size={14} /> Simpan QR PNG
              </a>
              {tx.status === 'PENDING' && (
                <button className="btn btn-primary" onClick={handleSimulatePay}>
                  <CheckCircle2 size={14} /> Simulasi Bayar
                </button>
              )}
              <button className="btn" onClick={onBack} style={{ marginLeft: 'auto' }}>
                Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
