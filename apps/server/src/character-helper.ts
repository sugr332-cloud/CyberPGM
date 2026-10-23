import { eq, inArray, desc } from 'drizzle-orm';
import { db } from './db/client.js';
import { characters, images, armors, combats } from './db/schema.js';
import {
  Character,
  CharacterSheet,
  CharacterSheetSkillItem,
  CharacterStats,
  CyberwareEntry,
  formatSkillName,
  getSkillDef,
  CharacterInventorySchema,
  CharacterExtra,
  drugModifiers,
  cyberpsychosisStage,
  roleSkillBonuses,
} from '@cyberpgm/shared';
import { maxHumanity, currentEmp, woundState, woundPenalty } from '@cyberpgm/rules';

/**
 * 着ている（equipped）防具の一番大きいペナルティ。複数着ても足さず、大きいほうだけ（Phase 5m）
 */
export function armorPenaltyOf(inventory: Array<{ kind?: string | null; item_id?: string | null; equipped?: boolean | null; armor_penalty?: number }>): number {
  let pen = 0;
  for (const e of inventory) {
    if (e.kind !== 'armor' || e.equipped === false) continue;
    const a = e.item_id ? db.select({ penalty: armors.penalty }).from(armors).where(eq(armors.item_id, e.item_id)).get() : undefined;
    pen = Math.max(pen, Math.abs(a?.penalty ?? e.armor_penalty ?? 0));
  }
  return pen;
}

/**
 * Maps a DB character row into a domain Character object.
 */
export function formatCharacterRow(row: typeof characters.$inferSelect, imagePath?: string | null): Character {
  return {
    id: row.id,
    kind: row.kind as 'pc' | 'npc' | 'mook',
    name: row.name,
    role: row.role,
    image_id: row.image_id,
    portrait_image_id: row.portrait_image_id,
    image_path: imagePath ?? null,
    stats: JSON.parse(row.stats) as CharacterStats,
    skills: JSON.parse(row.skills) as Record<string, number>,
    hp: row.hp,
    hp_max: row.hp_max,
    sp_head: row.sp_head,
    sp_body: row.sp_body,
    humanity: row.humanity,
    emp_max: row.emp_max,
    cyberware: JSON.parse(row.cyberware) as CyberwareEntry[],
    weapons: JSON.parse(row.weapons) as string[],
    inventory: CharacterInventorySchema.parse(JSON.parse(row.inventory || '[]')),
    armor_penalty: armorPenaltyOf(JSON.parse(row.inventory || '[]')),
    status: JSON.parse(row.status) as string[],
    crit_injuries: JSON.parse(row.crit_injuries) as unknown[],
    extra: JSON.parse(row.extra || '{}') as CharacterExtra,
    eb: row.eb,
    notes_gm: row.notes_gm,
    player_id: row.player_id,
    scenario_id: row.scenario_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Calculates a complete CharacterSheet including rule-calculated fields:
 * - maxHumanity (via rules.maxHumanity)
 * - currentEmp (via rules.currentEmp)
 * - woundState (via rules.woundState)
 * - woundPenalty (via rules.woundPenalty)
 * - skillsList with calculated base = statValue + level - woundPenalty
 */
export function calculateCharacterSheet(char: Character): CharacterSheet {
  // 1. Calculate max humanity from installed cyberware
  const cyberwareItems = char.cyberware.map((cw) => ({
    name: cw.name,
    type: cw.type,
    staticLoss: cw.static_loss ?? 0,
  }));

  const calculatedMaxHumanity = maxHumanity(char.stats.emp, cyberwareItems);
  const calculatedCurrentEmp = currentEmp(char.humanity, calculatedMaxHumanity);

  // 2. Wound status & penalty
  const calculatedWoundState = woundState(char.hp, char.hp_max);
  // ドラッグ・依存症の修正（Phase 5w）
  const eff = effectiveForChecks(char.stats, char.skills, char.extra, char.role);
  const calculatedWoundPenalty = eff.ignoreSeriousWound && calculatedWoundState === 'seriously' ? 0 : woundPenalty(calculatedWoundState);

  // 3. Skills list calculation
  const skillStatMap: Record<string, keyof CharacterStats> = {
    // Standard CP:R skill to stat map defaults
    athletics: 'dex',
    brawling: 'dex',
    evasion: 'dex',
    handgun: 'ref',
    shoulder_arms: 'ref',
    autofire: 'ref',
    heavy_weapons: 'ref',
    melee_weapon: 'dex',
    martial_arts: 'dex',
    stealth: 'dex',
    perception: 'int',
    tracking: 'int',
    conceal_reveal_object: 'int',
    lip_reading: 'int',
    first_aid: 'tech',
    paramedic: 'tech',
    cybertech: 'tech',
    weaponstech: 'tech',
    basic_tech: 'tech',
    demolitions: 'tech',
    electronics_security_tech: 'tech',
    land_vehicle_tech: 'tech',
    air_vehicle_tech: 'tech',
    sea_vehicle_tech: 'tech',
    conversation: 'emp',
    human_perception: 'emp',
    persuasion: 'cool',
    interrogation: 'cool',
    streetwise: 'cool',
    trading: 'cool',
    wardrobe_and_style: 'cool',
    personal_grooming: 'cool',
    acting: 'cool',
    bribery: 'cool',
    resist_torture_drugs: 'will',
    concentration: 'will',
    courage: 'will',
    education: 'int',
    tactics: 'int',
    wilderness_survival: 'int',
    accounting: 'int',
    animal_handling: 'int',
    bureaucracy: 'int',
    business: 'int',
    composition: 'int',
    criminology: 'int',
    cryptography: 'int',
    deduction: 'int',
    gamemaster: 'int',
    library_search: 'int',
    drive_land_vehicle: 'ref',
    pilot_air_vehicle: 'ref',
    pilot_sea_vehicle: 'ref',
    riding: 'ref',
    play_instrument: 'tech', // 〈演奏〉は【技術】（日本語版 p.139）
    dance: 'dex',
    forgery: 'tech',
    paint_draw_sculpt: 'tech',
    photography_film: 'tech',
    pick_lock: 'tech',
    pick_pocket: 'dex',
  };

  const skillsList: CharacterSheetSkillItem[] = Object.entries(char.skills).map(([key, level]) => {
    const skillDef = getSkillDef(key);
    const statKey = (skillDef?.stat as keyof CharacterStats) ?? skillStatMap[key.toLowerCase()] ?? 'int';
    const statValue = statKey === 'emp' ? calculatedCurrentEmp : eff.stats[statKey];
    // 重い防具は REF・DEX の技能を下げる（Phase 5m）
    const armorPen = statKey === 'ref' || statKey === 'dex' ? (char.armor_penalty ?? 0) : 0;
    const drugSkill = (eff.skills[key] ?? level) - level; // スマッシュなど
    const base = Math.max(0, statValue + level + drugSkill + calculatedWoundPenalty - armorPen); // wound penalty is negative or 0
    return {
      key,
      name: formatSkillName(key),
      statKey,
      statValue,
      level,
      base,
    };
  });

  return {
    ...char,
    maxHumanity: calculatedMaxHumanity,
    currentEmp: calculatedCurrentEmp,
    woundState: calculatedWoundState,
    woundPenalty: calculatedWoundPenalty,
    skillsList,
    // サイバーサイコシスの段階とドラッグの効果（Phase 5w。p.227〜232）
    psychosis: cyberpsychosisStage(calculatedCurrentEmp, char.humanity),
    effectNotes: eff.notes,
  };
}

/**
 * Loads a Character by ID from DB and calculates sheet.
 */
export function getCharacterSheetById(characterId: string): CharacterSheet | null {
  const row = db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!row) return null;

  let imagePath: string | null = null;
  if (row.image_id) {
    const img = db.select().from(images).where(eq(images.id, row.image_id)).get();
    if (img) imagePath = img.path;
  }

  const char = formatCharacterRow(row, imagePath);
  return calculateCharacterSheet(char);
}

/**
 * 進行中の戦闘で「プレイヤーに残弾を見せない」設定になっているか（Phase 5r）。GM にはいつも見える
 */
export function playerAmmoHidden(): boolean {
  const cb = db
    .select({ settings: combats.settings })
    .from(combats)
    .where(inArray(combats.status, ['setup', 'active']))
    .orderBy(desc(combats.created_at))
    .get();
  if (!cb) return false;
  try {
    return JSON.parse(cb.settings || '{}').playerAmmoVisible === false;
  } catch {
    return false;
  }
}

/** プレイヤーに渡す前に、所持品の残弾を消す（見せない設定のときだけ） */
export function maskAmmoForPlayer<T extends { inventory?: unknown }>(c: T, hidden = playerAmmoHidden()): T & { ammo_hidden?: boolean } {
  if (!hidden || !Array.isArray(c.inventory)) return c;
  return {
    ...c,
    inventory: (c.inventory as Array<Record<string, unknown>>).map(({ ammo: _ammo, ...rest }) => rest),
    ammo_hidden: true,
  };
}

/**
 * 判定に使う能力値と技能（ドラッグと依存症の修正を入れたもの。Phase 5w。日本語版 p.227〜229）。
 * キャラの記録（stats・skills）そのものは変えない
 */
export function effectiveForChecks(stats: CharacterStats, skills: Record<string, number>, extra: CharacterExtra | undefined | null, role = '') {
  const mod = drugModifiers(extra);
  const s = { ...stats };
  for (const [k, v] of Object.entries(mod.stats)) (s as Record<string, number>)[k] = Math.max(0, (s as Record<string, number>)[k] + (v ?? 0));
  const sk = { ...skills };
  for (const [k, v] of Object.entries(mod.skills)) if (sk[k] !== undefined || v > 0) sk[k] = Math.max(0, (sk[k] ?? 0) + v);
  // ロール特技が足す技能（ソロの危険感知、テクの現場エンジニア、ノーマッドのモト。Phase 5x）
  const notes = [...mod.notes];
  for (const [k, v] of Object.entries(roleSkillBonuses(role, extra))) {
    sk[k] = (sk[k] ?? 0) + v;
    notes.push(`${formatSkillName(k)} +${v}（ロール特技）`);
  }
  return { stats: s, skills: sk, ignoreSeriousWound: mod.ignoreSeriousWound, notes };
}
