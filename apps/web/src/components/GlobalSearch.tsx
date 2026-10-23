import { useEffect, useRef, useState } from 'react';
import { gmFetch } from '../api.js';

interface Hit {
  kind: 'character' | 'item' | 'scenario' | 'scene' | 'clue' | 'handout' | 'lore';
  id: string;
  title: string;
  sub: string;
}

const KIND_LABEL: Record<Hit['kind'], string> = {
  character: 'キャラ',
  item: '品目',
  scenario: 'シナリオ',
  scene: 'シーン',
  clue: '手がかり',
  handout: 'ハンドアウト',
  lore: '資料',
};

/** GM の全文検索（仕様 §5.0。Phase 5n）。選ぶと、その種類のタブに移る */
export function GlobalSearch({ onOpen, compact }: { onOpen: (hit: Hit) => void; compact?: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!q.trim()) {
      setHits([]);
      return;
    }
    timer.current = window.setTimeout(() => {
      gmFetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((res) => {
          setHits(res.hits ?? []);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 250);
  }, [q]);

  return (
    <div style={{ position: 'relative', flex: compact ? 1 : undefined, minWidth: 0 }}>
      <input
        aria-label="全文検索"
        data-testid="global-search"
        placeholder="検索（キャラ・品目・シナリオ…）"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 200)}
        style={{
          width: compact ? '100%' : '220px',
          padding: '7px 10px',
          backgroundColor: 'var(--color-bg)',
          border: '1px solid var(--color-border-light)',
          borderRadius: '6px',
          color: 'var(--color-text)',
          fontSize: '0.85rem',
        }}
      />
      {open && q.trim() && (
        <div
          data-testid="global-search-results"
          style={{
            position: 'absolute',
            right: 0,
            top: '110%',
            width: compact ? 'min(340px, calc(100vw - 24px))' : '340px',
            ...(compact ? { left: 0, right: 'auto' } : {}),
            maxHeight: '420px',
            overflowY: 'auto',
            zIndex: 200,
            backgroundColor: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-light)',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          {hits.length === 0 && <div style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>見つかりません</div>}
          {hits.map((h) => (
            <button
              key={`${h.kind}:${h.id}`}
              type="button"
              onMouseDown={() => {
                onOpen(h);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '0.7rem', color: 'var(--color-ally)', marginRight: '6px' }}>{KIND_LABEL[h.kind]}</span>
              <strong style={{ fontSize: '0.85rem' }}>{h.title}</strong>
              {h.sub && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{h.sub}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
