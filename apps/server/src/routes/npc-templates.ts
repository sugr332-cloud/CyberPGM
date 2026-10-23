import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import {
  generateUlid, getSkillDef, skillNameToKey, roleKeyOf,
  type CharacterStats, type InventoryEntry, type NpcTemplatesData,
} from '@cyberpgm/shared';
import { requireGm } from '../auth.js';
import { db } from '../db/client.js';
import { characters, items, weapons } from '../db/schema.js';
import { getCoreSourceDir } from '../source-data.js';
import { WEAPON_NAME_ALIASES } from '../services/combat-resolver.js';
import { getCharacterSheetById } from '../character-helper.js';
import { triggerAutoSave } from './saves.js';

export function loadNpcTemplates(): NpcTemplatesData {
  try {
    return JSON.parse(fs.readFileSync(path.join(getCoreSourceDir(), 'npcs.json'), 'utf8'));
  } catch {
    return { npcs: [], tiers: {} };
  }
}

export const npcTemplatesRoutes = new Hono();
npcTemplatesRoutes.get('/npc-templates', requireGm, (c) => c.json(loadNpcTemplates()));
npcTemplatesRoutes.post('/npc-templates/:key/register', requireGm, (c) => {
  const template = loadNpcTemplates().npcs.find((npc) => npc.key === c.req.param('key'));
  if (!template) return c.json({ error: 'NPC のテンプレートがありません' }, 404);

  const warnings: string[] = [];
  const skills: Record<string, number> = {};
  const roleRanks: Record<string, number> = {};
  let role = template.role ?? '';
  if (role && template.role_rank != null) roleRanks[roleKeyOf(role)] = template.role_rank;
  const abilities: Record<string, string> = { インターフェイス: 'Netrunner', モト: 'Nomad', 'コンバット・アウェアネス': 'Solo' };
  for (const [name, base] of Object.entries(template.skills)) {
    if (abilities[name]) {
      role ||= abilities[name];
      roleRanks[abilities[name]] = template.role_rank ?? base;
      continue;
    }
    const key = skillNameToKey(name);
    const def = getSkillDef(key);
    if (!def) {
      warnings.push(`技能「${name}」が見つからないため登録していません`);
      continue;
    }
    const level = base - template.stats[def.stat as keyof CharacterStats];
    skills[key] = Math.max(0, level);
    if (level < 0) warnings.push(`技能「${name}」のレベルが 0 未満になるため 0 にしました`);
  }

  const catalog = db.select().from(items).all();
  const weaponCatalog = new Map(db.select().from(weapons).all().map((w) => [w.item_id, w]));
  const findItem = (name: string) => {
    const names = [name, WEAPON_NAME_ALIASES[name]].filter(Boolean);
    return catalog.find((item) =>
      names.some((n) => n === item.name_ja_override || n === item.name_ja || n === item.name_en));
  };
  const inventory: InventoryEntry[] = [];
  for (const weapon of template.weapons) {
    const poor = weapon.name.startsWith('低品質の');
    const found = findItem(weapon.name.replace(/^低品質の/, ''));
    const data = found ? weaponCatalog.get(found.id) : undefined;
    inventory.push({
      entry_id: generateUlid(), name: weapon.name, kind: 'weapon', qty: 1, equipped: true, damage: weapon.damage,
      ...(poor ? { quality: 'poor' } : {}),
      ...(found ? { item_id: found.id, ...(data?.magazine_max != null ? { ammo: data.magazine_max } : {}) } : { damage: weapon.damage, notes: `ダメージ: ${weapon.damage}` }),
    });
    if (!found) warnings.push(`武器「${weapon.name}」が品目に見つかりません（名前とダメージを保存）`);
  }
  const armor = findItem(template.armor.name);
  inventory.push({ entry_id: generateUlid(), name: template.armor.name, kind: 'armor', qty: 1, equipped: true,
    ...(armor ? { item_id: armor.id } : {}), armor_penalty: template.armor.penalty ?? 0,
    notes: `SP 頭 ${template.armor.head} / 胴 ${template.armor.body}` });

  const notes = [`日本語版 p.${template.page}`, template.desc ?? ''];
  for (const name of [...(template.gear ?? []), ...(template.programs ?? [])]) {
    const quantity = name.match(/×(\d+)$/);
    const found = findItem(name) ?? findItem(name.replace(/×\d+$/, ''));
    if (found) {
      // 武器欄と装備欄の両方に出るサイバー武器を二重に入れない。
      if (inventory.some((entry) => entry.item_id === found.id)) continue;
      inventory.push({ entry_id: generateUlid(), item_id: found.id, name, kind: found.kind, qty: quantity ? Number(quantity[1]) : 1 });
    } else notes.push(name);
  }

  const id = generateUlid();
  const now = Date.now();
  // 採番と作成を同じトランザクションにする。
  const name = db.transaction((tx) => {
    const names = new Set(tx.select({ name: characters.name }).from(characters).all().map((row) => row.name));
    let name = template.name;
    for (let n = 2; names.has(name); n++) name = `${template.name} ${n}`;
    tx.insert(characters).values({
      id, name, kind: 'npc', role, stats: JSON.stringify(template.stats), skills: JSON.stringify(skills),
      hp: template.hp, hp_max: template.hp, sp_head: template.armor.head, sp_body: template.armor.body,
      humanity: template.stats.emp * 10, emp_max: template.stats.emp, inventory: JSON.stringify(inventory),
      notes_gm: notes.filter(Boolean).join('\n'), extra: JSON.stringify({ npc_template: template.key, role_ranks: roleRanks }),
      created_at: now, updated_at: now,
    }).run();
    return name;
  });
  triggerAutoSave(`NPC registered: ${name}`);
  return c.json({ character: getCharacterSheetById(id), warnings }, 201);
});
