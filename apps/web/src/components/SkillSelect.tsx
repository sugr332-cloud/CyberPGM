import React, { useMemo, useState } from 'react';
import { SKILL_CATALOG, formatSkillName, type CharacterSheet } from '@cyberpgm/shared';

interface Props {
  value: string;
  onChange: (value: string) => void;
  characters?: CharacterSheet[];
  label?: string;
  emptyLabel?: string;
  testId?: string;
}

/** 日本語・英語で絞り込める技能一覧。キャラクター固有の専門技能も含む。 */
export function SkillSelect({ value, onChange, characters = [], label = '技能', emptyLabel = '技能を選ぶ', testId }: Props) {
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const keys = new Set([...Object.keys(SKILL_CATALOG), ...characters.flatMap((c) => Object.keys(c.skills || {})), ...(value ? [value] : [])]);
    const term = query.normalize('NFKC').toLocaleLowerCase().trim();
    return [...keys].map((key) => ({ key, name: formatSkillName(key) }))
      .filter((s) => s.key === value || `${s.name} ${s.key} ${SKILL_CATALOG[s.key]?.name_en || ''}`.normalize('NFKC').toLocaleLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }, [characters, value, query]);
  const inputStyle: React.CSSProperties = {
    padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--color-border-light)',
    color: 'var(--color-text)', backgroundColor: 'var(--color-bg)', fontSize: '0.8rem', minWidth: 0,
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: '1 1 auto', minWidth: 0 }}>
      <input
        type="search"
        aria-label={`${label}を検索`}
        placeholder="技能を検索（日本語・英語）"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...inputStyle, flex: '1 1 140px', width: '140px' }}
      />
      <select aria-label={label} data-testid={testId} value={value} onChange={(e) => { onChange(e.target.value); setQuery(''); }} style={{ ...inputStyle, flex: '1 1 170px', width: '170px', maxWidth: '100%' }}>
        <option value="">{emptyLabel}</option>
        {options.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
      </select>
    </div>
  );
}
