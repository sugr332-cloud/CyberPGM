import React, { useEffect, useMemo, useState } from 'react';
import { CharacterSheet, CharacterStats, SKILL_CATALOG, formatSkillName, skillNameToKey } from '@cyberpgm/shared';
import { DEFAULT_RULES, successProbability } from '@cyberpgm/rules';
import { api } from '../api.js';
import { DV_GUIDE } from './StoryCheckRow.js';

const STAT_JA: Record<string, string> = {
  int: 'INT', ref: 'REF', dex: 'DEX', tech: 'TECH', cool: 'COOL', will: 'WILL', luck: 'LUCK', move: 'MOVE', body: 'BODY', emp: 'EMP',
};
const COMBAT_CATEGORIES = ['fightingSkills', 'rangedweaponSkills'];
const EXPLORE_CATEGORIES = ['awarenessSkills', 'bodySkills', 'socialSkills', 'techniqueSkills', 'educationSkills', 'controlSkills', 'performanceSkills'];
/** 持っていなくても出す技能（だれでも能力値だけで振れる、よく使うもの） */
const ALWAYS_COMBAT = ['evasion', 'brawling'];
const ALWAYS_EXPLORE = ['perception', 'human_perception', 'stealth', 'athletics'];

const muted: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--color-text-muted)' };

interface SkillRow {
  key: string;
  name: string;
  stat: keyof CharacterStats;
  level: number;
  base: number;
}

interface WeaponRow {
  entryId: string;
  name: string;
  skill: SkillRow | null;
  damage: string | null;
  ranged: boolean | null;
}

const tieText = DEFAULT_RULES.tieRule === 'success' ? '難易度と同じか上回れば成功' : '難易度を上回れば成功（同じ値は失敗）';
const opposedText = DEFAULT_RULES.opposedTieWinner === 'defender' ? '同じ値は守る側の勝ち' : '同じ値は攻める側の勝ち';

/**
 * スマホの「行動」タブの「使える技能」（Phase 5g、2026-10-21 ユーザー依頼）: 戦闘と探索で使う技能と、持っている武器。
 * ボタンを押すと計算式（能力値 + 技能 = 基本値、1d10 の振り方、難易度ごとの成功率）を出す
 */
export function PlayerActionSkills({ sheet, inCombat }: { sheet: CharacterSheet; inCombat: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [weaponItems, setWeaponItems] = useState<Record<string, any>>({});
  const wound = sheet.woundPenalty;

  const skillRow = (key: string): SkillRow | null => {
    const def = SKILL_CATALOG[key];
    if (!def) return null;
    const stat = def.stat as keyof CharacterStats;
    const level = sheet.skills[key] ?? 0;
    return { key, name: def.name, stat, level, base: Math.max(0, (sheet.stats[stat] ?? 0) + level + wound) };
  };

  const pick = (categories: string[], always: string[]) =>
    Object.values(SKILL_CATALOG)
      .filter((s) => categories.includes(s.category) && ((sheet.skills[s.key] ?? 0) > 0 || always.includes(s.key)))
      .map((s) => skillRow(s.key)!)
      .sort((a, b) => b.base - a.base);

  const combatSkills = useMemo(() => pick(COMBAT_CATEGORIES, ALWAYS_COMBAT), [sheet]);
  const exploreSkills = useMemo(() => pick(EXPLORE_CATEGORIES, ALWAYS_EXPLORE), [sheet]);

  // 持っている武器の技能とダメージ（品目の性能から）
  const weaponEntries = sheet.inventory.filter((i) => i.kind === 'weapon' && i.item_id);
  useEffect(() => {
    const ids = weaponEntries.map((w) => w.item_id!).filter((id) => !weaponItems[id]);
    if (ids.length === 0) return;
    Promise.all(ids.map((id) => api.getItemForPlayer(id).catch(() => null))).then((list) =>
      setWeaponItems((prev) => ({ ...prev, ...Object.fromEntries(list.filter(Boolean).map((it) => [it.id, it])) })),
    );
  }, [sheet.inventory]);
  const weapons: WeaponRow[] = weaponEntries.map((w) => {
    const wd = weaponItems[w.item_id!]?.weapon;
    return {
      entryId: w.entry_id,
      name: w.name,
      skill: wd?.skill ? skillRow(skillNameToKey(wd.skill)) : null,
      damage: wd?.damage ?? null,
      ranged: wd ? Boolean(wd.is_ranged) : null,
    };
  });

  const formula = (s: SkillRow) => (
    <>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
        {STAT_JA[s.stat]} {sheet.stats[s.stat]} + {formatSkillName(s.key)} {s.level}
        {wound !== 0 ? ` ${wound}（負傷）` : ''} = 基本値 <strong>{s.base}</strong>
      </div>
      <div>
        判定: 基本値 {s.base} + 1d10 で、{tieText}。
      </div>
      <div style={muted}>1d10 で 10 が出たら、もう 1 回振って足す。1 が出たら、もう 1 回振って引く。</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2px 12px', fontSize: '0.8rem' }}>
        <span style={muted}>難易度目安（DV値）</span>
        <span style={muted}>難易度</span>
        <span style={muted}>成功率</span>
        {DV_GUIDE.map((g) => (
          <React.Fragment key={g.dv}>
            <span>{g.label}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{g.dv}</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(successProbability(s.base, g.dv, 'dv') * 100)}%</span>
          </React.Fragment>
        ))}
      </div>
    </>
  );

  const row = (id: string, label: string, right: string, detail: React.ReactNode) => {
    const isOpen = open === id;
    return (
      <div key={id} data-testid="action-skill" style={{ border: '1px solid var(--color-border-light)', borderRadius: '6px', overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setOpen(isOpen ? null : id)}
          style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', width: '100%', padding: '9px 12px', background: isOpen ? 'var(--color-surface-elevated)' : 'none', border: 'none', color: 'var(--color-text)', fontSize: '0.9rem', textAlign: 'left', cursor: 'pointer' }}
        >
          <span>{label}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-ally)' }}>{right}</span>
        </button>
        {isOpen && (
          <div data-testid="action-skill-formula" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', borderTop: '1px solid var(--color-border-light)' }}>
            {detail}
          </div>
        )}
      </div>
    );
  };

  const evasionNote = (
    <div style={muted}>
      攻撃を受けたときの守り: DEX + 回避 + 1d10 と、攻める側の 能力値 + 技能 + 1d10 の比べ合い（{opposedText}）。近接攻撃にはいつでも、射撃には REF {DEFAULT_RULES.rangedDodgeMinRef} 以上のときに使えます。
    </div>
  );

  const combatSection = (
    <div key="combat" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>戦闘で使う</span>
      {weapons.map((w) =>
        row(
          `w-${w.entryId}`,
          `${w.name}${w.skill ? `（${formatSkillName(w.skill.key)}）` : ''}`,
          w.skill ? `${w.skill.base}${w.damage ? ` / ${w.damage}` : ''}` : (w.damage ?? '—'),
          w.skill ? (
            <>
              {formula(w.skill)}
              <div>
                攻撃: 基本値 {w.skill.base} + 1d10。
                {w.ranged
                  ? '射撃の難易度は武器の種類と距離で決まります（戦闘中はアプリが出します）。相手が回避するときは、相手の DEX + 回避 + 1d10 と比べます。'
                  : '近接攻撃は、相手の DEX + 回避 + 1d10 と比べます。'}
              </div>
              {w.damage && <div>当たったらダメージ {w.damage}（相手の SP を引いた残りが HP から減る）。</div>}
            </>
          ) : (
            <div style={muted}>この武器の技能が分かりません（GM に確認してください）</div>
          ),
        ),
      )}
      {combatSkills.map((s) => row(s.key, `${formatSkillName(s.key)}${s.level === 0 ? '（技能なし）' : ''}`, String(s.base), <>{formula(s)}{s.key === 'evasion' && evasionNote}</>))}
    </div>
  );
  const exploreSection = (
    <div key="explore" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>探索で使う</span>
      {exploreSkills.map((s) => row(s.key, `${formatSkillName(s.key)}${s.level === 0 ? '（技能なし）' : ''}`, String(s.base), formula(s)))}
    </div>
  );

  return (
    <div
      data-testid="player-action-skills"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 700 }}>使える技能</span>
        <span style={muted}>押すと計算式</span>
      </div>
      {inCombat ? [combatSection, exploreSection] : [exploreSection, combatSection]}
    </div>
  );
}
