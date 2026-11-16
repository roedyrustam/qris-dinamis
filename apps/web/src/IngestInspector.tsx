import { useEffect, useState } from 'react';
import { RefreshCw, SearchCheck } from 'lucide-react';

interface AdapterInfo {
  name: string;
  displayName: string;
  aliases: string[];
}

interface IngestEventRow {
  id: string;
  merchantId: string;
  source: string;
  extractedAmount: number | null;
  matchedTransactionId: string | null;
  status: string;
  createdAt: string;
}

export function IngestInspector() {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [events, setEvents] = useState<IngestEventRow[]>([]);
  const [source, setSource] = useState('auto');
  const [text, setText] = useState('BSI Mobile: Pembayaran QRIS Rp 50.123 berhasil Ref: FT9981');
  const [previewResult, setPreviewResult] = useState<string | null>(null);

  async function loadData() {
    try {
      const [aRes, eRes] = await Promise.all([
        fetch('/v1/ingest/adapters').then((r) => r.json()),
        fetch('/v1/ingest/events').then((r) => r.json()),
      ]);
      setAdapters(aRes.adapters ?? []);
      setEvents(eRes.events ?? []);
    } catch {
      // Ignore transient network errors
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleTestParse(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/v1/ingest/parse-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, text }),
    });
    const data = await res.json();
    setPreviewResult(JSON.stringify(data.extracted, null, 2));
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
      <form className="card" onSubmit={handleTestParse} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Notification Parser Tester (Dry-Run)</h2>
        <label style={{ fontSize: 12, fontWeight: 500 }}>
          Source / Adapter
          <select className="input" style={{ marginTop: 4 }} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="auto">auto (Deteksi Otomatis dari Teks)</option>
            {adapters.map((a) => (
              <option key={a.name} value={a.aliases[0] ?? a.name}>
                {a.displayName} ({a.aliases.join(', ')})
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 12, fontWeight: 500 }}>
          Teks Notifikasi Bank / E-Wallet
          <textarea
            className="textarea"
            rows={3}
            style={{ marginTop: 4 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn btn-primary">
          <SearchCheck size={14} /> Test Parser
        </button>
        {previewResult !== null && (
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 10,
              background: 'var(--surface-muted)',
              borderRadius: 6,
              fontSize: 12,
              overflowX: 'auto',
            }}
          >
            {previewResult}
          </pre>
        )}
      </form>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Recent Ingest Events ({events.length})</h2>
          <button className="btn" onClick={loadData}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        {events.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Belum ada event ingest notifikasi.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.map((ev) => (
              <div
                key={ev.id}
                style={{
                  padding: 10,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {ev.source}
                  </span>
                  <span
                    className={`badge ${
                      ev.status === 'MATCHED' ? 'badge-paid' : ev.status === 'UNMATCHED' ? 'badge-pending' : 'badge-failed'
                    }`}
                  >
                    {ev.status}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                  Amount: {ev.extractedAmount ?? '-'} | Tx: {ev.matchedTransactionId ?? '-'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
