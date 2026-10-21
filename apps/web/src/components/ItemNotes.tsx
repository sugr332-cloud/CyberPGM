import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export interface ItemNotesFields {
  id: string;
  effect_ja?: string | null;
  flavor_ja?: string | null;
  effect_is_draft?: boolean;
  flavor_is_draft?: boolean;
}

interface Props {
  item: ItemNotesFields;
  /** 編集できるか（商店の詳細は true、戦闘カードの窓は false） */
  editable?: boolean;
  onUpdated?: (item: any) => void;
}

const draftBadge: React.CSSProperties = {
  fontSize: '0.65rem',
  padding: '1px 5px',
  borderRadius: '3px',
  border: '1px solid var(--color-border-light)',
  color: 'var(--color-text-muted)',
  marginLeft: '6px',
};

const smallButton: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: '4px',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface-elevated)',
  color: 'var(--color-text)',
  fontSize: '0.75rem',
  cursor: 'pointer',
};

/** 品目の効果とフレーバー（GM のみ。Phase 5c） */
export function ItemNotes({ item, editable = false, onUpdated }: Props) {
  const [editing, setEditing] = useState(false);
  const [effect, setEffect] = useState(item.effect_ja ?? '');
  const [flavor, setFlavor] = useState(item.flavor_ja ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEffect(item.effect_ja ?? '');
    setFlavor(item.flavor_ja ?? '');
    setEditing(false);
  }, [item.id, item.effect_ja, item.flavor_ja]);

  const save = async () => {
    setBusy(true);
    try {
      // 変えた欄だけ送る（送った欄だけが「下書き」でなくなる）
      const patch: { effect_ja?: string; flavor_ja?: string } = {};
      if (effect !== (item.effect_ja ?? '')) patch.effect_ja = effect;
      if (flavor !== (item.flavor_ja ?? '')) patch.flavor_ja = flavor;
      if (Object.keys(patch).length > 0) onUpdated?.(await api.updateItem(item.id, patch));
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      onUpdated?.(await api.resetItemNotes(item.id));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div data-testid="item-notes" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem' }}>
        <label style={{ color: 'var(--color-text-muted)' }}>効果</label>
        <textarea aria-label="効果" value={effect} onChange={(e) => setEffect(e.target.value)} rows={3} style={{ fontSize: '0.8rem' }} />
        <label style={{ color: 'var(--color-text-muted)' }}>フレーバー</label>
        <textarea aria-label="フレーバー" value={flavor} onChange={(e) => setFlavor(e.target.value)} rows={2} style={{ fontSize: '0.8rem' }} />
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <button type="button" style={smallButton} onClick={() => setEditing(false)} disabled={busy}>
            やめる
          </button>
          <button type="button" style={{ ...smallButton, backgroundColor: 'var(--color-ally)', color: '#000', fontWeight: 700 }} onClick={save} disabled={busy}>
            保存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="item-notes" style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem' }}>
      <div>
        <span style={{ color: 'var(--color-text-muted)' }}>効果</span>
        {item.effect_is_draft && <span style={draftBadge}>下書き</span>}
        <div style={{ marginTop: '2px', lineHeight: 1.5 }}>{item.effect_ja || '特別な効果なし（性能の欄を参照）'}</div>
      </div>
      {item.flavor_ja && (
        <div>
          <span style={{ color: 'var(--color-text-muted)' }}>フレーバー</span>
          {item.flavor_is_draft && <span style={draftBadge}>下書き</span>}
          <div style={{ marginTop: '2px', lineHeight: 1.5, fontStyle: 'italic' }}>{item.flavor_ja}</div>
        </div>
      )}
      {editable && (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          {!(item.effect_is_draft && item.flavor_is_draft) && (
            <button type="button" style={smallButton} onClick={reset} disabled={busy}>
              下書きに戻す
            </button>
          )}
          <button type="button" style={smallButton} onClick={() => setEditing(true)} disabled={busy}>
            編集
          </button>
        </div>
      )}
    </div>
  );
}
