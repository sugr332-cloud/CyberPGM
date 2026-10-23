import { useEffect, useState } from 'react';
import type { CharacterSheet, NpcTemplatesData } from '@cyberpgm/shared';
import { gmFetch } from '../api.js';
import './NpcTemplatePicker.css';

export function NpcTemplatePicker({ onRegistered, onClose }: {
  onRegistered: (character: CharacterSheet, warnings: string[]) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<NpcTemplatesData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    gmFetch('/api/npc-templates', { signal: controller.signal }).then(async (r) => {
      if (!r.ok) throw new Error('NPC 一覧を読み込めませんでした');
      return r.json();
    }).then(setData).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  const register = async (key: string) => {
    setBusy(true);
    setError('');
    try {
      const response = await gmFetch(`/api/npc-templates/${encodeURIComponent(key)}/register`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '登録できませんでした');
      onRegistered(result.character, result.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録できませんでした');
    } finally { setBusy(false); }
  };
  return <section className="npc-template-picker" data-testid="npc-template-picker" aria-label="ルールブックの NPC" style={{ padding: 16, border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><h3>ルールブックの NPC</h3><button type="button" onClick={onClose} disabled={busy}>閉じる</button></div>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>読み込み中…</p>}
    {data && <>
      <dl>{Object.entries(data.tiers).map(([tier, guide]) => <div key={tier} style={{ marginBottom: 8 }}><dt style={{ fontWeight: 700, color: 'var(--color-enemy)' }}>{tier}</dt><dd style={{ marginLeft: 12 }}>{guide}</dd></div>)}</dl>
      {data.npcs.length === 0 && <p>NPC の資料（手元のルール資料）がありません</p>}
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead><tr>{['名前', 'ランクの目安', 'HP', 'SP 頭 / 胴', '主な武器', 'ページ', ''].map((label) => <th key={label} style={{ padding: 8 }}>{label}</th>)}</tr></thead>
        <tbody>{data.npcs.map((npc) => <tr key={npc.key} data-testid={`npc-template-${npc.key}`}>
          <th style={{ padding: 8, whiteSpace: 'nowrap' }}>{npc.name}</th><td>{npc.tier}</td><td>{npc.hp}</td><td>{npc.armor.head} / {npc.armor.body}</td>
          <td>{npc.weapons.map((weapon) => weapon.name).join('、')}</td><td>p.{npc.page}</td><td><button type="button" disabled={busy} onClick={() => register(npc.key)}>登録</button></td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
