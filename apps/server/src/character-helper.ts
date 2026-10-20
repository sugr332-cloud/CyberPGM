import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { characters, images } from './db/schema.js';
import {
  Character,
  CharacterSheet,
  CharacterSheetSkillItem,
  CharacterStats,
  CyberwareEntry,
  formatSkillName,
  getSkillDef,
} from '@cyberpgm/shared';
import { maxHumanity, currentEmp, woundState, woundPenalty } from '@cyberpgm/rules';

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
    inventory: JSON.parse(row.inventory) as unknown[],
    status: JSON.parse(row.status) as string[],
    crit_injuries: JSON.parse(row.crit_injuries) as unknown[],
    eb: row.eb,
    notes_gm: row.notes_gm,
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
    isBorgware: cw.type === 'borgware',
    staticLoss: cw.static_loss ?? 0,
  }));

  const calculatedMaxHumanity = maxHumanity(char.stats.emp, cyberwareItems);
  const calculatedCurrentEmp = currentEmp(char.humanity, calculatedMaxHumanity);

  // 2. Wound status & penalty
  const calculatedWoundState = woundState(char.hp, char.hp_max);
  const calculatedWoundPenalty = woundPenalty(calculatedWoundState);

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
    play_instrument: 'emp',
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
    const statValue = statKey === 'emp' ? calculatedCurrentEmp : char.stats[statKey];
    const base = Math.max(0, statValue + level + calculatedWoundPenalty); // wound penalty is negative or 0
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
