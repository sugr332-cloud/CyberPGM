import React, { useEffect, useState } from 'react';
import { gmFetch } from '../api.js';

interface PcResumeCode {
  id: string;
  name: string;
  role: string;
  url: string;
  qrSvg: string;
}

interface Props {
  /** 見出し（例:「セーブ「○○」を読み込みました」） */
  title: string;
  /** 1 人分だけ出すとき */
  onlyPcId?: string;
  onClose: () => void;
}

/** PC ごとの再開用 QR（Phase 5d）。読むとキャラ選びなしでそのキャラのシートが開く */
export function ResumeQrPanel({ title, onlyPcId, onClose }: Props) {
  const [pcs, setPcs] = useState<PcResumeCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // QR は開くたびに今のセッションコードで作る（サーバを起動し直すとコードが変わるため）
    gmFetch('/api/session/pc-qr')
      .then((r) => r.json())
      .then((res) => setPcs(res.pcs ?? []))
      .catch(() => setError('QR を作れませんでした'));
  }, []);

  const shown = (pcs ?? []).filter((p) => !onlyPcId || p.id === onlyPcId);

  const printAll = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const cards = shown
      .map(
        (p) =>
          `<div class="card"><div class="qr">${p.qrSvg}</div><div class="name">${escapeHtml(p.name)}</div><div class="role">${escapeHtml(p.role)}</div></div>`,
      )
      .join('');
    w.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>再開用 QR</title><style>
      body{font-family:sans-serif;margin:16px;color:#000;background:#fff}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
      .card{border:1px solid #999;border-radius:8px;padding:12px;text-align:center;break-inside:avoid}
      .qr svg{width:100%;height:auto}.name{font-size:18px;font-weight:700;margin-top:6px}.role{font-size:13px;color:#555}
    </style></head><body><div class="grid">${cards}</div></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div
      data-testid="resume-qr-panel"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <div>
            <div style={{ fontWeight: 700 }}>{title}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              プレイヤーは自分のキャラの QR を読むと、キャラ選びなしで再開できます。
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {!onlyPcId && shown.length > 0 && (
              <button type="button" onClick={printAll} style={buttonStyle}>
                全員分を印刷
              </button>
            )}
            <button type="button" onClick={onClose} style={buttonStyle}>
              閉じる
            </button>
          </div>
        </div>
        {error && <div style={{ color: 'var(--color-accent)', fontSize: '0.85rem' }}>{error}</div>}
        {pcs && shown.length === 0 && <div style={{ fontSize: '0.85rem' }}>PC がいません</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          {shown.map((p) => (
            <div
              key={p.id}
              data-testid="resume-qr-card"
              data-url={p.url}
              style={{
                backgroundColor: '#fff',
                borderRadius: '8px',
                padding: '10px',
                textAlign: 'center',
                color: '#000',
              }}
            >
              <div style={{ width: '100%' }} dangerouslySetInnerHTML={{ __html: p.qrSvg }} />
              <div style={{ fontWeight: 700, marginTop: '4px' }}>{p.name}</div>
              <div style={{ fontSize: '0.75rem', color: '#555' }}>{p.role}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '4px',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface-elevated)',
  color: 'var(--color-text)',
  fontSize: '0.85rem',
  cursor: 'pointer',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
