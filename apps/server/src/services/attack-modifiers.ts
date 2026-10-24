import { SITUATION_MODIFIERS, type CombatParticipant, type InventoryEntry } from '@cyberpgm/shared';
import type { AppDatabase } from '../db/client.js';
import { items } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface AttackModifier { key: string; label: string; value: number }

export function situationModifiers(keys?: string[] | null, custom?: number | null): AttackModifier[] {
  const result: AttackModifier[] = [];
  for (const key of keys ?? []) {
    const def = SITUATION_MODIFIERS.find((s) => s.key === key);
    if (def) {
      result.push({ key: `situation_${def.key}`, label: def.label, value: def.value });
    }
  }
  if (typeof custom === 'number' && !Number.isNaN(custom) && custom !== 0) {
    result.push({ key: 'situation_custom', label: 'その他', value: custom });
  }
  return result;
}

export function formatAttackModifier(m: AttackModifier): string {
  if (m.value === 0) return `${m.label} 0`;
  const sign = m.value > 0 ? '+' : '−';
  return `${m.label} ${sign}${Math.abs(m.value)}`;
}

export function rangedWeaponQuality(db: AppDatabase, weapon: { item_id?: string; quality?: string | null }, entry?: InventoryEntry): 'high' | 'low' | 'normal' {
  let item: typeof items.$inferSelect | undefined;
  if (weapon.item_id) item = db.select().from(items).where(eq(items.id, weapon.item_id)).get();
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(item?.raw_system ?? '{}') as Record<string, unknown>; } catch { /* legacy item */ }
  const names = [entry?.name, item?.name_en, item?.name_ja, item?.name_ja_override];
  const quality = (entry?.quality ?? weapon.quality ?? (typeof raw.quality === 'string' ? raw.quality : '')).toString().toLowerCase();
  if (quality) {
    if (['poor', 'low', '低品質', 'poor quality'].includes(quality)) return 'low';
    if (['excellent', 'high', '高品質', 'excellent quality'].includes(quality)) return 'high';
    return 'normal';
  }
  if (hasName(names, '(低品質)')) return 'low';
  if (hasName(names, '(高品質)')) return 'high';
  return 'normal';
}

const hasName = (names: Array<string | null | undefined>, fragment: string) =>
  names.some((n) => (n ?? '').toLowerCase().includes(fragment.toLowerCase()));

/** Calculates ranged attack modifiers once for both the resolver and its preview line. */
export function rangedAttackModifiers(
  db: AppDatabase,
  actor: CombatParticipant,
  weapon: { item_id?: string; quality?: string | null; weapon_type?: string | null },
  entry: InventoryEntry | undefined,
  actionKey: string,
  distanceM: number | undefined,
  values: { wound: number; grapple: number; ignoreSeriousWound: boolean; precision: number; luck?: number; situations?: string[]; situation_custom?: number },
): AttackModifier[] {
  const result: AttackModifier[] = [];
  const character = actor.character;
  if (!character) return result;
  const weaponNames: Array<string | null | undefined> = [entry?.name];
  let item: typeof items.$inferSelect | undefined;
  if (weapon.item_id) item = db.select().from(items).where(eq(items.id, weapon.item_id)).get();
  if (item) weaponNames.push(item.name_en, item.name_ja, item.name_ja_override);
  if (rangedWeaponQuality(db, weapon, entry) === 'high') result.push({ key: 'quality', label: '高品質', value: 1 });

  const inv = (character.inventory as InventoryEntry[]) ?? [];
  const attachments = inv.filter((candidate) => entry?.attachments?.includes(candidate.entry_id));
  const attachmentNames: string[] = [];
  for (const attachment of attachments) {
    attachmentNames.push(attachment.name);
    if (attachment.item_id) {
      const row = db.select().from(items).where(eq(items.id, attachment.item_id)).get();
      attachmentNames.push(row?.name_en ?? '', row?.name_ja ?? '', row?.name_ja_override ?? '');
    }
  }
  const special = (weapon.weapon_type ?? '').toLowerCase().includes('special');
  const ranged = !special;
  const wareNames = (character.cyberware ?? []).map((cw) => cw.name);
  const neuralLink = hasName(wareNames, 'interface plugs') || hasName(wareNames, 'インターフェイス・プラグ') || hasName(wareNames, 'subdermal grip') || hasName(wareNames, '皮下グリップ');
  if (ranged && neuralLink && (hasName(attachmentNames, 'smartgun link') || hasName(attachmentNames, 'スマートガン・リンク'))) {
    result.push({ key: 'smartgun', label: 'スマートガン', value: 1 });
  }
  const teleOptics = hasName(wareNames, 'teleoptics') || hasName(wareNames, 'テレオプティクス') || hasName(wareNames, '望遠');
  if (ranged && !teleOptics && distanceM !== undefined && distanceM >= 51 && ['ranged', 'aimed'].includes(actionKey) && (hasName(attachmentNames, 'sniping scope') || hasName(attachmentNames, '狙撃用スコープ'))) {
    result.push({ key: 'scope', label: '狙撃用スコープ', value: 1 });
  }
  if (values.precision) result.push({ key: 'precision', label: '精密攻撃', value: values.precision });
  if (values.luck) result.push({ key: 'luck', label: '運命', value: values.luck });
  if (values.ignoreSeriousWound && values.wound === -2) result.push({ key: 'ignore_wound', label: '重傷（ドラッグで無視）', value: 0 });
  else if (values.wound) result.push({ key: 'wound', label: values.wound === -4 ? '瀕死' : '重傷', value: values.wound });
  if (values.grapple) result.push({ key: 'grapple', label: 'つかみ', value: values.grapple });
  result.push(...situationModifiers(values.situations, values.situation_custom));
  return result;
}

export function attackModifierTotal(modifiers: AttackModifier[]): number {
  return modifiers.reduce((sum, modifier) => sum + modifier.value, 0);
}
