import { eq } from 'drizzle-orm';
import { CombatParticipant, InventoryEntry, skillNameToKey, formatSkillName } from '@cyberpgm/shared';
import { canDodgeRanged, formatNeeded, neededRoll, rangedDv, woundPenalty, woundState } from '@cyberpgm/rules';
import type { DvTable } from '@cyberpgm/shared';
import { db } from '../db/client.js';
import { items, rule_constants, weapons } from '../db/schema.js';

/**
 * 出目を入れる前に出す「計算式と成功ライン」（仕様 §5.0.1。Phase 5n）。
 * 例: 「REF 8 + 拳銃 6 = 14 vs 難易度 15（8m）→ 2 以上で成功」
 * 距離がまだ決まっていない射撃は、距離帯ごとの難易度と成功ラインを並べる（スマホ向け）
 */
export interface AttackLine {
  text: string;
  bands?: Array<{ range: string; dv: number; needed: string }>;
}

interface LineInput {
  action_key: string;
  weapon_entry_id?: string;
  weapon_id?: string;
  distance_m?: number | null;
  dodge_mode?: 'dv' | 'dodge';
}

const RANGED = ['ranged', 'aimed', 'autofire'];

function ruleConstant<T>(key: string): T | null {
  const row = db.select().from(rule_constants).where(eq(rule_constants.key, key)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

function weaponOf(actor: CombatParticipant, input: LineInput) {
  const inv = (actor.character?.inventory as InventoryEntry[]) ?? [];
  const id = input.weapon_entry_id ?? input.weapon_id;
  const entry = id ? inv.find((i) => i.entry_id === id || i.item_id === id) : undefined;
  if (!entry?.item_id) return null;
  const w = db.select().from(weapons).where(eq(weapons.item_id, entry.item_id)).get();
  const it = db.select().from(items).where(eq(items.id, entry.item_id)).get();
  return w ? { ...w, name: it?.name_ja_override || it?.name_ja || it?.name_en || entry.name } : null;
}

export function attackLine(input: LineInput, actor: CombatParticipant, target?: CombatParticipant): AttackLine | null {
  const ch = actor.character;
  if (!ch) return null;
  const armor = ch.armor_penalty ?? 0;
  const wound = woundPenalty(woundState(ch.hp, ch.hp_max));
  const woundText = wound ? ` ${wound}（負傷）` : '';

  if (RANGED.includes(input.action_key)) {
    const w = weaponOf(actor, input);
    if (!w) return { text: '射撃武器を選ぶと成功ラインが出ます' };
    const isAutofire = input.action_key === 'autofire';
    const skillKey = isAutofire ? 'autofire' : skillNameToKey(w.skill);
    const skill = ch.skills[skillKey] ?? 0;
    const ref = ch.stats.ref - armor;
    const aimed = input.action_key === 'aimed' ? -8 : 0;
    const base = ref + skill + wound + aimed;
    const parts = `REF ${ref} + ${formatSkillName(skillKey)} ${skill}${woundText}${aimed ? ' −8（照準）' : ''} = ${base}`;
    const tableKey = isAutofire ? `${w.dv_table_key} (Autofire)` : w.dv_table_key;
    const table = tableKey ? ruleConstant<DvTable>(`dv_table.${tableKey}`) ?? ruleConstant<DvTable>(tableKey) : null;

    // 相手が回避できて、GM が回避で受けると決めたとき
    const tChar = target?.character;
    if (tChar && input.dodge_mode === 'dodge' && canDodgeRanged(tChar.stats.ref - (tChar.armor_penalty ?? 0))) {
      const def = tChar.stats.dex - (tChar.armor_penalty ?? 0) + (tChar.skills[skillNameToKey('evasion')] ?? 0) + woundPenalty(woundState(tChar.hp, tChar.hp_max));
      return { text: `${parts} vs ${target!.name} の回避 ${def} + 1d10（相手の合計を上回れば命中。同じなら外れ）` };
    }
    if (!table) return { text: `${parts} vs 難易度（武器の難易度表がありません）` };
    if (typeof input.distance_m === 'number') {
      const dv = rangedDv(table, input.distance_m);
      if (dv === null) return { text: `${parts} vs 距離 ${input.distance_m}m は射程外` };
      return { text: `${parts} vs 難易度 ${dv}（${input.distance_m}m）→ ${formatNeeded(neededRoll(base, dv, 'dv'))}` };
    }
    const bands = table
      .filter((b) => b.dv !== 'N/A' && b.dv !== 'null' && Number.isFinite(Number(b.dv)))
      .map((b) => ({ range: `${b.range[0]}〜${b.range[1]}m`, dv: Number(b.dv), needed: formatNeeded(neededRoll(base, Number(b.dv), 'dv')) }));
    return { text: `${parts} + 1d10 vs 距離で決まる難易度`, bands };
  }

  if (input.action_key === 'melee' || input.action_key === 'brawl') {
    const w = input.action_key === 'melee' ? weaponOf(actor, input) : null;
    if (input.action_key === 'melee' && !w) return { text: '近接武器を選ぶと成功ラインが出ます' };
    const skillKey = w ? skillNameToKey(w.skill) : 'brawling';
    const skill = ch.skills[skillKey] ?? 0;
    const dex = ch.stats.dex - armor;
    const base = dex + skill + wound;
    const parts = `DEX ${dex} + ${formatSkillName(skillKey)} ${skill}${woundText} = ${base}`;
    const tChar = target?.character;
    if (!tChar) return { text: `${parts} + 1d10 vs 相手の DEX + 回避 + 1d10` };
    const def = tChar.stats.dex - (tChar.armor_penalty ?? 0) + (tChar.skills[skillNameToKey('evasion')] ?? 0) + woundPenalty(woundState(tChar.hp, tChar.hp_max));
    return { text: `${parts} vs ${target!.name} の回避 ${def} + 1d10（相手の合計を上回れば命中。同じなら外れ）` };
  }
  return null;
}
