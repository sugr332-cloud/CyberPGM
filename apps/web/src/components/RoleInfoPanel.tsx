import { useEffect, useState } from 'react';
import { RoleInfo, ROLES, rankInRange } from '@cyberpgm/shared';
import { api } from '../api.js';

let cache: Promise<{ starting_rank: number; roles: RoleInfo[] }> | null = null;
const loadRoleInfo = () => (cache ??= api.getRoleInfo().catch(() => ({ starting_rank: 4, roles: [] })));

interface Props {
  role: string;
  /** 強調するランク。省略時は作成時のランク（ふつう 4） */
  rank?: number;
  /** はじめから開いておくか */
  open?: boolean;
}

/**
 * ロールの概要とロール特技のランクごとの効果（Phase 5s）。
 * 説明は手元のルール資料（data/sources/core-ja/roles.json）から読む。ファイルがなければ何も出さない
 */
export function RoleInfoPanel({ role, rank, open }: Props) {
  const [data, setData] = useState<{ starting_rank: number; roles: RoleInfo[] } | null>(null);
  useEffect(() => {
    loadRoleInfo().then(setData);
  }, []);
  const meta = ROLES.find((r) => r.key.toLowerCase() === role.toLowerCase() || r.nameJa === role);
  const info = data?.roles.find((r) => r.key === meta?.key);
  if (!info || !meta) return null;
  const current = rank ?? data!.starting_rank;

  return (
    <details data-testid="role-info" open={open} style={{ fontSize: '0.8rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
        {meta.nameJa}: ロール特技《{info.ability}》
        {info.page ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>（p.{info.page}）</span> : null}
      </summary>
      <p style={{ margin: '6px 0' }}>{info.overview}</p>
      {info.rules.length > 0 && (
        <ul style={{ margin: '4px 0', paddingLeft: '18px' }}>
          {info.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '6px' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>ランク</th>
            <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid var(--color-border)' }}>できること</th>
          </tr>
        </thead>
        <tbody>
          {info.ranks.map((r) => {
            const here = rankInRange(r.range, current);
            return (
              <tr key={r.range} style={{ backgroundColor: here ? 'var(--color-surface-elevated)' : undefined }}>
                <td style={{ padding: '3px 6px', verticalAlign: 'top', whiteSpace: 'nowrap', color: here ? 'var(--color-ally)' : undefined, fontWeight: here ? 700 : 400 }}>
                  {r.range}
                  {here ? '（いま）' : ''}
                </td>
                <td style={{ padding: '3px 6px' }}>{r.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
