import { martialArtsDice } from './martial.js';

/** 格闘のBODY別ダイス数。サイバーアーム本体があれば最低2d6（日本語版 p.176）。 */
export function brawlingDamageDice(body: number, cyberware: Array<{ name?: string }> = []): number {
  const hasCyberarm = cyberware.some((c) => /^(medical grade )?cyberarm$/i.test((c.name ?? '').trim()) || /^(医療用)?サイバーアーム$/.test((c.name ?? '').trim()));
  return Math.max(martialArtsDice(body), hasCyberarm ? 2 : 0);
}

/** GM・スマホで共通の攻撃ダメージ式。武器の不明値は補完しない。 */
export function combatDamageFormula(
  action: string,
  character: { stats: { body: number }; cyberware?: Array<{ name?: string }> } | null | undefined,
  weapon?: { damage?: string | null },
): string | null {
  if (!character) return null;
  if (action === 'brawl') return `${brawlingDamageDice(character.stats.body, character.cyberware)}d6`;
  if (action === 'martial_arts') return `${martialArtsDice(character.stats.body)}d6`;
  if (action === 'autofire') return '2d6';
  return weapon?.damage?.trim() || null;
}

/** ダイスの振り方を案内する。読めない式は、そのまま表示する。 */
export function damageDiceGuide(formula: string | null): string {
  if (!formula) return 'ダメージ不明';
  const dice = /^(\d+)d(\d+)(?:[+-]\d+)?$/i.exec(formula);
  return dice ? `${formula}（${dice[2]} 面ダイスを ${dice[1]} 個）` : formula;
}
