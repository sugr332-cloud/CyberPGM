import { useState } from 'react';
import { SPECIALIZED_SKILLS, specializedSkillKey } from '@cyberpgm/shared';

interface Props {
  /** 追加する技能のキー（例: science:化学）を受け取る */
  onAdd: (key: string) => void;
  /** すでに持っている技能のキー（同じものは足さない） */
  existing: string[];
}

const field: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: '0.8rem',
  borderRadius: '4px',
  border: '1px solid var(--color-border-light)',
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
};

/**
 * 種類を選んで取る技能（武術・演奏・科学・言語・土地鑑）を種類つきで足す（Phase 5u。日本語版 p.132〜139）。
 * 例: 〈科学：化学〉〈言語：日本語〉〈武術：空手〉。同じ技能を種類違いで何個でも持てる
 */
export function AddSpecializedSkill({ onAdd, existing }: Props) {
  const [base, setBase] = useState('language');
  const [spec, setSpec] = useState('');
  const def = SPECIALIZED_SKILLS[base];
  const key = spec.trim() ? specializedSkillKey(base, spec) : '';
  const dup = key !== '' && existing.includes(key);

  return (
    <div data-testid="add-specialized-skill" style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' }}>
      <span style={{ color: 'var(--color-text-muted)' }}>種類を選ぶ技能を足す:</span>
      <select aria-label="種類を選ぶ技能" value={base} onChange={(e) => { setBase(e.target.value); setSpec(''); }} style={field}>
        {Object.values(SPECIALIZED_SKILLS).map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}（{s.specLabel}）{s.multiplier > 1 ? ' ×2' : ''}
          </option>
        ))}
      </select>
      {def?.specialties ? (
        <select aria-label={def.specLabel} value={spec} onChange={(e) => setSpec(e.target.value)} style={field}>
          <option value="">{def.specLabel}を選ぶ</option>
          {def.specialties.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      ) : (
        <input aria-label={def?.specLabel ?? '種類'} placeholder={`${def?.specLabel ?? '種類'}（例: ${base === 'language' ? '日本語' : base === 'science' ? '化学' : base === 'local_expert' ? 'ワトソン' : 'ギター'}）`} value={spec} onChange={(e) => setSpec(e.target.value)} style={{ ...field, width: '150px' }} />
      )}
      <button
        type="button"
        disabled={!key || dup}
        onClick={() => {
          onAdd(key);
          setSpec('');
        }}
        style={{ ...field, cursor: key && !dup ? 'pointer' : 'default' }}
      >
        {dup ? 'もう持っています' : '足す'}
      </button>
    </div>
  );
}
