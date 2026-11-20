import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Copy,
  ExternalLink,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Store,
  Upload,
  Webhook,
} from 'lucide-react';
import { CheckoutPage } from './CheckoutPage';
import { CpmTerminal } from './CpmTerminal';
import { IngestInspector } from './IngestInspector';

type Tab = 'playground' | 'cpm' | 'merchants' | 'transactions' | 'webhooks' | 'ingest' | 'privacy' | 'terms' | 'delete-account' | 'pay';

interface Merchant {
  id: string;
  name: string;
  staticQris: string;
  nmid: string | null;
  city: string | null;
  webhookUrl: string | null;
  webhookSecret: string;
  apiKey: string;
}

interface Transaction {
  id: string;
  merchantId: string;
  externalId: string | null;
  mode?: 'MPM' | 'CPM';
  baseAmount: number;
  uniqueCode: number;
  totalAmount: number;
  dynamicQris: string;
  qrSvg?: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED';
  paidVia: string | null;
  expiresAt: string;
  createdAt: string;
}

interface WebhookLog {
  id: string;
  transactionId: string;
  eventType: string;
  targetUrl: string;
  httpStatus: number | null;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  attemptCount: number;
  responseBody: string | null;
  createdAt: string;
}

const SAMPLE_STATIC_QRIS =
  '00020101021126550012COM.DOKU.WWW011893600899000010802502061080250303UKE51440014ID.CO.QRIS.WWW0215ID10266114058810303UKE5204737253033605802ID5921Pandu Talenta Digital6014PANGKAJENE KEP61059065562070703A016304A55F';

function formatIdr(amount: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

export default function App() {
  const [payTxId, setPayTxId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/pay\/([^/]+)$/);
    return match?.[1] ?? null;
  });
  const [tab, setTab] = useState<Tab>(() => {
    const path = window.location.pathname.replace(/^\//, '');
    if (path.startsWith('pay/')) return 'pay';
    if (path === 'privacy' || path === 'terms' || path === 'delete-account') return path;
    return 'playground';
  });

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Playground state
  const [pgQris, setPgQris] = useState(SAMPLE_STATIC_QRIS);
  const [pgAmount, setPgAmount] = useState(50000);
  const [pgFeeType, setPgFeeType] = useState<'none' | 'prompt' | 'fixed' | 'percentage'>('none');
  const [pgFeeValue, setPgFeeValue] = useState(500);
  const [pgResult, setPgResult] = useState<{
    dynamicQris: string;
    qrSvg: string;
    qrDataUrl: string;
    crc: string;
    merchant: { name: string | null; city: string | null; nmid: string | null };
    tags: Array<{ tag: string; length: number; value: string }>;
  } | null>(null);
  const [pgLoading, setPgLoading] = useState(false);

  // Merchant form
  const [mName, setMName] = useState('');
  const [mQris, setMQris] = useState(SAMPLE_STATIC_QRIS);
  const [mWebhookUrl, setMWebhookUrl] = useState('https://httpbin.org/post');

  // Generate Transaction form
  const [txMerchantId, setTxMerchantId] = useState('');
  const [txAmount, setTxAmount] = useState(25000);
  const [txUnique, setTxUnique] = useState(true);
  const [txExternalId, setTxExternalId] = useState('INV-001');

  async function refreshAll() {
    try {
      const [mRes, tRes, wRes] = await Promise.all([
        fetch('/v1/merchants').then((r) => r.json()),
        fetch('/v1/qris').then((r) => r.json()),
        fetch('/v1/webhooks/logs').then((r) => r.json()),
      ]);
      setMerchants(mRes.merchants ?? []);
      setTransactions(tRes.transactions ?? []);
      setWebhookLogs(wRes.logs ?? []);
      if (!txMerchantId && mRes.merchants?.[0]?.id) {
        setTxMerchantId(mRes.merchants[0].id);
      }
    } catch {
      // API might not be running yet during initial render
    }
  }

  useEffect(() => {
    refreshAll();
  }, []);

  function navigate(next: Tab) {
    setTab(next);
    if (next !== 'pay') setPayTxId(null);
    const url = next === 'privacy' || next === 'terms' || next === 'delete-account' ? `/${next}` : '/';
    window.history.pushState({}, '', url);
  }

  function openCheckout(txId: string) {
    setPayTxId(txId);
    setTab('pay');
    window.history.pushState({}, '', `/pay/${txId}`);
  }

  async function handleConvert() {
    setPgLoading(true);
    setErrorMsg(null);
    try {
      const fee =
        pgFeeType === 'none'
          ? { type: 'none' }
          : pgFeeType === 'prompt'
            ? { type: 'prompt' }
            : { type: pgFeeType, value: pgFeeValue };
      const res = await fetch('/v1/qris/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staticQris: pgQris, amount: pgAmount, fee }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Conversion failed');
      setPgResult(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to convert');
    } finally {
      setPgLoading(false);
    }
  }

  async function handleDecodeImageFile(file: File, target: 'playground' | 'merchant') {
    setErrorMsg(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/v1/qris/decode-image', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Gagal membaca QRIS dari gambar');
      if (target === 'playground') {
        setPgQris(data.staticQris);
      } else {
        setMQris(data.staticQris);
        if (!mName && data.merchant?.name) setMName(data.merchant.name);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membaca gambar QRIS');
    }
  }

  async function handleCreateMerchant(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const res = await fetch('/v1/merchants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: mName || undefined,
        staticQris: mQris,
        webhookUrl: mWebhookUrl || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErrorMsg(data.error ?? 'Failed to create merchant');
      return;
    }
    setMName('');
    await refreshAll();
    setTxMerchantId(data.merchant.id);
  }

  async function handleGenerateTx(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const res = await fetch('/v1/qris/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId: txMerchantId,
        amount: txAmount,
        useUniqueCode: txUnique,
        externalId: txExternalId || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErrorMsg(data.error ?? 'Failed to generate QRIS transaction');
      return;
    }
    await refreshAll();
  }

  async function handleRotateKeys(merchantId: string) {
    await fetch(`/v1/merchants/${merchantId}/rotate-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rotateApiKey: true, rotateWebhookSecret: true }),
    });
    await refreshAll();
  }

  async function handleSimulatePay(transactionId: string) {
    await fetch('/v1/sandbox/simulate-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId }),
    });
    await refreshAll();
  }

  async function handleRetryWebhook(logId: string) {
    await fetch(`/v1/webhooks/${logId}/retry`, { method: 'POST' });
    await refreshAll();
  }

  return (
    <div className="container">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 20,
          marginBottom: 24,
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <QrCode size={22} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>QRIS Dinamis Console</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              EMVCo Static-to-Dynamic SDK, Pluggable Verifier &amp; HMAC Webhook Engine
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`btn ${tab === 'playground' ? 'btn-primary' : ''}`}
            onClick={() => navigate('playground')}
          >
            <QrCode size={14} /> MPM Playground
          </button>
          <button
            className={`btn ${tab === 'cpm' ? 'btn-primary' : ''}`}
            onClick={() => navigate('cpm')}
          >
            <Upload size={14} /> CPM POS
          </button>
          <button
            className={`btn ${tab === 'merchants' ? 'btn-primary' : ''}`}
            onClick={() => navigate('merchants')}
          >
            <Store size={14} /> Merchants ({merchants.length})
          </button>
          <button
            className={`btn ${tab === 'transactions' ? 'btn-primary' : ''}`}
            onClick={() => navigate('transactions')}
          >
            <Activity size={14} /> Transactions ({transactions.length})
          </button>
          <button
            className={`btn ${tab === 'webhooks' ? 'btn-primary' : ''}`}
            onClick={() => navigate('webhooks')}
          >
            <Webhook size={14} /> Webhooks ({webhookLogs.length})
          </button>
          <button
            className={`btn ${tab === 'ingest' ? 'btn-primary' : ''}`}
            onClick={() => navigate('ingest')}
          >
            <ShieldCheck size={14} /> Ingest Tester
          </button>
          <a className="btn" href="/docs" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            OpenAPI Docs
          </a>
        </div>
      </header>

      {errorMsg && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            background: 'var(--rose-bg)',
            color: 'var(--rose-text)',
            borderColor: '#fecdd3',
            fontSize: 13,
          }}
        >
          {errorMsg}
        </div>
      )}

      {tab === 'playground' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          <div className="card">
            <h2 style={{ margin: '0 0 12px', fontSize: 15 }}>Konversi QRIS Statis → Dinamis</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px 14px',
                  border: '1px dashed var(--border)',
                  borderRadius: 6,
                  background: 'var(--surface-muted)',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <Upload size={14} /> Upload Gambar QRIS Statis (PNG / JPG)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleDecodeImageFile(file, 'playground');
                    e.target.value = '';
                  }}
                />
              </label>

              <label style={{ fontSize: 12, fontWeight: 500 }}>
                String QRIS Statis (EMVCo)
                <textarea
                  className="textarea mono"
                  rows={4}
                  style={{ marginTop: 4, fontSize: 12 }}
                  value={pgQris}
                  onChange={(e) => setPgQris(e.target.value)}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500 }}>
                  Nominal (IDR)
                  <input
                    type="number"
                    className="input tabular-nums"
                    style={{ marginTop: 4 }}
                    value={pgAmount}
                    onChange={(e) => setPgAmount(Number(e.target.value))}
                  />
                </label>

                <label style={{ fontSize: 12, fontWeight: 500 }}>
                  Tipe Fee / Tip (Tag 55)
                  <select
                    className="select"
                    style={{ marginTop: 4 }}
                    value={pgFeeType}
                    onChange={(e) => setPgFeeType(e.target.value as typeof pgFeeType)}
                  >
                    <option value="none">Tanpa Fee</option>
                    <option value="fixed">Fixed Fee (Tag 56)</option>
                    <option value="percentage">Percentage Fee (Tag 57)</option>
                    <option value="prompt">Tip Prompt (01)</option>
                  </select>
                </label>
              </div>

              {(pgFeeType === 'fixed' || pgFeeType === 'percentage') && (
                <label style={{ fontSize: 12, fontWeight: 500 }}>
                  Nilai Fee ({pgFeeType === 'fixed' ? 'IDR' : '%'})
                  <input
                    type="number"
                    step="0.1"
                    className="input tabular-nums"
                    style={{ marginTop: 4 }}
                    value={pgFeeValue}
                    onChange={(e) => setPgFeeValue(Number(e.target.value))}
                  />
                </label>
              )}

              <button className="btn btn-primary" onClick={handleConvert} disabled={pgLoading}>
                <QrCode size={14} /> {pgLoading ? 'Mengonversi...' : 'Generate QRIS Dinamis'}
              </button>
            </div>
          </div>

          <div className="card">
            <h2 style={{ margin: '0 0 12px', fontSize: 15 }}>Hasil QRIS Dinamis &amp; TLV Inspector</h2>
            {pgResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div
                    style={{
                      width: 160,
                      height: 160,
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: '#fff',
                    }}
                    dangerouslySetInnerHTML={{ __html: pgResult.qrSvg }}
                  />
                  <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div>
                      <strong>Merchant:</strong> {pgResult.merchant.name ?? '-'}
                    </div>
                    <div>
                      <strong>Kota:</strong> {pgResult.merchant.city ?? '-'}
                    </div>
                    <div>
                      <strong>NMID:</strong> <span className="mono">{pgResult.merchant.nmid ?? '-'}</span>
                    </div>
                    <div>
                      <strong>CRC-16:</strong> <span className="mono">{pgResult.crc}</span>
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                      <button
                        className="btn"
                        onClick={() => navigator.clipboard.writeText(pgResult.dynamicQris)}
                      >
                        <Copy size={13} /> Copy String
                      </button>
                      <a className="btn" href={pgResult.qrDataUrl} download="qris-dinamis.png">
                        Download PNG
                      </a>
                    </div>
                  </div>
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    padding: 10,
                    background: 'var(--surface-muted)',
                    borderRadius: 6,
                    wordBreak: 'break-all',
                  }}
                >
                  {pgResult.dynamicQris}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Klik <strong>Generate QRIS Dinamis</strong> untuk melihat preview QR, CRC-16 baru, dan payload string.
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'merchants' && (
        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20 }}>
          <form className="card" onSubmit={handleCreateMerchant} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15 }}>Daftarkan Merchant QRIS</h2>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 12px',
                border: '1px dashed var(--border)',
                borderRadius: 6,
                background: 'var(--surface-muted)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Upload size={14} /> Upload Gambar QRIS Statis
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleDecodeImageFile(file, 'merchant');
                  e.target.value = '';
                }}
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 500 }}>
              Nama Merchant (opsional, otomatis dari Tag 59)
              <input className="input" style={{ marginTop: 4 }} value={mName} onChange={(e) => setMName(e.target.value)} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 500 }}>
              Static QRIS String
              <textarea
                className="textarea mono"
                rows={4}
                style={{ marginTop: 4, fontSize: 11 }}
                value={mQris}
                onChange={(e) => setMQris(e.target.value)}
                required
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 500 }}>
              Webhook URL
              <input
                className="input"
                style={{ marginTop: 4 }}
                value={mWebhookUrl}
                onChange={(e) => setMWebhookUrl(e.target.value)}
                placeholder="https://app.anda.com/webhooks/qris"
              />
            </label>
            <button type="submit" className="btn btn-primary">
              <Store size={14} /> Simpan Merchant
            </button>
          </form>

          <div className="card">
            <h2 style={{ margin: '0 0 12px', fontSize: 15 }}>Daftar Merchant Terdaftar</h2>
            {merchants.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Belum ada merchant terdaftar.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {merchants.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      padding: 12,
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                      <span>{m.name}</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {m.id}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      Webhook: <span className="mono">{m.webhookUrl ?? '(tidak diset)'}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      Secret: <span className="mono">{m.webhookSecret}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      API Key: <span className="mono">{m.apiKey}</span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="btn"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => handleRotateKeys(m.id)}
                      >
                        <RefreshCw size={12} /> Rotate Keys
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'transactions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <form
            className="card"
            onSubmit={handleGenerateTx}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}
          >
            <label style={{ fontSize: 12, fontWeight: 500 }}>
              Merchant
              <select
                className="select"
                style={{ marginTop: 4 }}
                value={txMerchantId}
                onChange={(e) => setTxMerchantId(e.target.value)}
                required
              >
                <option value="">-- Pilih Merchant --</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 500 }}>
              Nominal Dasar (IDR)
              <input
                type="number"
                className="input tabular-nums"
                style={{ marginTop: 4 }}
                value={txAmount}
                onChange={(e) => setTxAmount(Number(e.target.value))}
                required
              />
            </label>
            <label style={{ fontSize: 12, fontWeight: 500 }}>
              External ID
              <input
                className="input"
                style={{ marginTop: 4 }}
                value={txExternalId}
                onChange={(e) => setTxExternalId(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, paddingBottom: 8 }}>
              <input type="checkbox" checked={txUnique} onChange={(e) => setTxUnique(e.target.checked)} />
              Kode Unik (+1..999)
            </label>
            <button type="submit" className="btn btn-primary" disabled={!txMerchantId}>
              <Send size={14} /> Buat Transaksi
            </button>
          </form>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 15 }}>Monitor Transaksi &amp; Sandbox</h2>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                  Total: {transactions.length} | Paid: {transactions.filter((t) => t.status === 'PAID').length} | Omzet:{' '}
                  {formatIdr(
                    transactions
                      .filter((t) => t.status === 'PAID')
                      .reduce((sum, t) => sum + t.totalAmount, 0),
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <a className="btn" href="/v1/qris/export?format=csv" download="qris-transactions.csv" style={{ textDecoration: 'none', fontSize: 12 }}>
                  Export CSV
                </a>
                <a className="btn" href="/v1/qris/export?format=json" download="qris-transactions.json" style={{ textDecoration: 'none', fontSize: 12 }}>
                  Export JSON
                </a>
                <button className="btn" onClick={refreshAll}>
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '8px 6px' }}>ID / External</th>
                    <th style={{ padding: '8px 6px' }}>Total Tagihan</th>
                    <th style={{ padding: '8px 6px' }}>Status</th>
                    <th style={{ padding: '8px 6px' }}>Aksi Sandbox</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 6px' }}>
                        <div className="mono" style={{ fontSize: 12 }}>
                          {tx.id}{' '}
                          <span style={{ fontSize: 10, padding: '1px 5px', border: '1px solid var(--border)', borderRadius: 4 }}>
                            {tx.mode ?? 'MPM'}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tx.externalId ?? '-'}</div>
                      </td>
                      <td style={{ padding: '10px 6px' }} className="tabular-nums">
                        <strong>{formatIdr(tx.totalAmount)}</strong>
                        {tx.uniqueCode > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {formatIdr(tx.baseAmount)} + kode unik {tx.uniqueCode}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 6px' }}>
                        <span
                          className={`badge ${
                            tx.status === 'PAID'
                              ? 'badge-paid'
                              : tx.status === 'PENDING'
                                ? 'badge-pending'
                                : 'badge-failed'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 6px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button className="btn" onClick={() => openCheckout(tx.id)} title="Buka Hosted Checkout /pay/:id">
                            <ExternalLink size={13} /> Pay Page
                          </button>
                          {tx.status === 'PENDING' ? (
                            <button className="btn" onClick={() => handleSimulatePay(tx.id)}>
                              <CheckCircle2 size={13} /> Simulate Pay
                            </button>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {tx.paidVia ?? 'Selesai'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'pay' && payTxId && (
        <CheckoutPage
          transactionId={payTxId}
          onBack={() => {
            navigate('transactions');
            refreshAll();
          }}
        />
      )}

      {tab === 'cpm' && <CpmTerminal merchants={merchants} onTransactionCreated={refreshAll} />}

      {tab === 'ingest' && <IngestInspector />}

      {tab === 'webhooks' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15 }}>Webhook Delivery Logs</h2>
            <button className="btn" onClick={refreshAll}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
          {webhookLogs.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Belum ada log pengiriman webhook.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {webhookLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    padding: 12,
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 13,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        className={`badge ${
                          log.status === 'DELIVERED'
                            ? 'badge-paid'
                            : log.status === 'PENDING'
                              ? 'badge-pending'
                              : 'badge-failed'
                        }`}
                      >
                        {log.status}
                      </span>
                      <span className="mono" style={{ fontSize: 12 }}>{log.eventType}</span>
                      <span className="tabular-nums" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        HTTP {log.httpStatus ?? '-'} · Attempt {log.attemptCount}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {log.targetUrl}
                    </div>
                  </div>
                  <button className="btn" onClick={() => handleRetryWebhook(log.id)}>
                    <RefreshCw size={13} /> Retry
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'privacy' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Kebijakan Privasi (Privacy Policy)</h2>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            Layanan QRIS Dinamis memproses data profil merchant, payload QRIS statis/dinamis, dan log pengiriman webhook
            semata-mata untuk memfasilitasi pembuatan invoice QRIS dinamis dan verifikasi pembayaran otomatis sesuai UU
            No. 27 Tahun 2022 (UU PDP) dan GDPR.
          </p>
        </div>
      )}

      {tab === 'terms' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Syarat &amp; Ketentuan (Terms &amp; Conditions)</h2>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            Developer bertanggung jawab penuh atas keabsahan QRIS statis merchant yang didaftarkan serta keamanan
            penyimpanan API Key dan Webhook Secret pada sistem masing-masing.
          </p>
        </div>
      )}

      {tab === 'delete-account' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Penghapusan Data Merchant (Data Deletion)</h2>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            Anda dapat menghapus seluruh data merchant, transaksi, dan log webhook secara permanen melalui endpoint{' '}
            <code className="mono">DELETE /v1/merchants/:id</code> atau menghubungi administrator instance Anda.
          </p>
        </div>
      )}

      <footer
        style={{
          marginTop: 40,
          paddingTop: 16,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: 'var(--text-muted)',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={14} /> QRIS Dinamis SDK &amp; Webhook Engine
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => navigate('privacy')}>
            Kebijakan Privasi
          </button>
          <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => navigate('terms')}>
            Syarat &amp; Ketentuan
          </button>
          <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => navigate('delete-account')}>
            Hapus Data
          </button>
        </div>
      </footer>
    </div>
  );
}
