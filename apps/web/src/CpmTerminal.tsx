import { useState } from 'react';
import { CheckCircle2, ScanLine, ShieldAlert } from 'lucide-react';

interface MerchantOption {
  id: string;
  name: string;
}

const SAMPLE_DANA_CPM_B64 = 'hQVDUFYwMWEaTwcAoAAAAgYQEFAKREFOQVoJk2AIkAAAlFZ4';
const SAMPLE_DECLINE_CPM = '93600898000123450000';

export function CpmTerminal({
  merchants,
  onTransactionCreated,
}: {
  merchants: MerchantOption[];
  onTransactionCreated: () => Promise<void>;
}) {
  const [merchantId, setMerchantId] = useState(merchants[0]?.id ?? '');
  const [amount, setAmount] = useState(45000);
  const [qrData, setQrData] = useState(SAMPLE_DANA_CPM_B64);
  const [externalId, setExternalId] = useState('POS-CPM-001');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    approved: boolean;
    wallet?: string | null;
    reason?: string;
    transaction?: { id: string; status: string; totalAmount: number; paidVia?: string | null; paidReference?: string | null };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedMerchantId = merchantId || merchants[0]?.id || '';

  async function handleCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMerchantId) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/v1/qris/cpm/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: selectedMerchantId,
          amount,
          qrData,
          externalId: externalId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Gagal memproses pembayaran CPM');
      } else {
        setResult(data);
        await onTransactionCreated();
      }
    } catch {
      setError('Gagal menghubungi server API');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
      <form className="card" onSubmit={handleCharge} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15 }}>CPM POS Scanner (Customer-Presented Mode)</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Pelanggan menunjukkan QR di aplikasi (mis. DANA), merchant melakukan scan, dan sistem bertindak sebagai acquirer.
          </p>
        </div>

        <label style={{ fontSize: 12, fontWeight: 500 }}>
          Merchant
          <select
            className="input"
            style={{ marginTop: 4 }}
            value={selectedMerchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            required
          >
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.id})
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 12, fontWeight: 500 }}>
          Nominal Tagihan (IDR)
          <input
            type="number"
            className="input tabular-nums"
            style={{ marginTop: 4 }}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            min={1}
            required
          />
        </label>

        <label style={{ fontSize: 12, fontWeight: 500 }}>
          Scanned Customer QR Payload (EMVCo CPM Base64 / Token)
          <textarea
            className="textarea mono"
            rows={3}
            style={{ marginTop: 4, fontSize: 12 }}
            value={qrData}
            onChange={(e) => setQrData(e.target.value)}
            required
          />
        </label>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11, padding: '4px 8px' }}
            onClick={() => setQrData(SAMPLE_DANA_CPM_B64)}
          >
            Sample DANA CPM (Approve)
          </button>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11, padding: '4px 8px' }}
            onClick={() => setQrData(SAMPLE_DECLINE_CPM)}
          >
            Sample Decline (*0000)
          </button>
        </div>

        <label style={{ fontSize: 12, fontWeight: 500 }}>
          External / POS Receipt ID
          <input
            className="input"
            style={{ marginTop: 4 }}
            value={externalId}
            onChange={(e) => setExternalId(e.target.value)}
          />
        </label>

        <button type="submit" className="btn btn-primary" disabled={!selectedMerchantId || loading}>
          <ScanLine size={14} /> {loading ? 'Memproses...' : 'Validate & Charge (CPM)'}
        </button>
      </form>

      <div className="card">
        <h2 style={{ margin: '0 0 12px', fontSize: 15 }}>Hasil Otorisasi Acquirer</h2>
        {error && (
          <div style={{ color: 'var(--rose-text)', fontSize: 13 }}>{error}</div>
        )}
        {!error && !result && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Scan atau pilih sample QR pelanggan lalu klik <strong>Validate &amp; Charge (CPM)</strong>.
          </div>
        )}
        {result && (
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              border: `1px solid ${result.approved ? '#065f46' : '#7f1d1d'}`,
              background: result.approved ? '#064e3b22' : '#7f1d1d22',
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              {result.approved ? (
                <>
                  <CheckCircle2 size={16} color="#10b981" /> Pembayaran CPM Disetujui (PAID)
                </>
              ) : (
                <>
                  <ShieldAlert size={16} color="#ef4444" /> Pembayaran CPM Ditolak (FAILED)
                </>
              )}
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, fontVariantNumeric: 'tabular-nums' }}>
              <div>Wallet / Issuer: {result.wallet ?? '-'}</div>
              <div>Transaction ID: <span className="mono">{result.transaction?.id ?? '-'}</span></div>
              <div>Acquirer: <span className="mono">{result.transaction?.paidVia ?? '-'}</span></div>
              <div>Reference: <span className="mono">{result.transaction?.paidReference ?? '-'}</span></div>
              {result.reason && <div style={{ color: '#ef4444' }}>Alasan: {result.reason}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
