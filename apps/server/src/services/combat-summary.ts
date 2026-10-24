import type { CombatLogEntry, CombatParticipant, CombatChange } from '@cyberpgm/shared';

/**
 * 戦闘ログからシナリオのセッションログ向けの要約テキストを生成する（Phase 6h。Issue #35）
 */
export function generateCombatSummary(
  combat: { id: string; round: number; created_at: number; ended_at?: number | null; [key: string]: unknown },
  logs: CombatLogEntry[],
  participants: CombatParticipant[],
  encounterTitle?: string,
): string {
  const title = encounterTitle ? `戦闘（${encounterTitle}）` : '戦闘';
  const startTime = new Date(combat.created_at).toLocaleTimeString('ja-JP');
  const endTime = combat.ended_at ? new Date(combat.ended_at).toLocaleTimeString('ja-JP') : new Date().toLocaleTimeString('ja-JP');

  const lines: string[] = [];
  lines.push(`【戦闘ログ要約】${title}（全 ${combat.round} ラウンド / ${startTime} 〜 ${endTime}）`);

  const nameMap = new Map<string, string>();
  for (const p of participants) {
    nameMap.set(p.id, p.name);
    if (p.character_id) nameMap.set(p.character_id, p.name);
  }

  const ammoSpentMap = new Map<string, number>();
  const defeatedSet = new Set<string>();
  const unconsciousSet = new Set<string>();

  // 取り消されていないログのみ
  const validLogs = logs.filter((l) => !l.undone);

  for (const log of validLogs) {
    if (['join', 'leave', 'next_turn', 'gm_move'].includes(log.action_key)) {
      continue;
    }

    const actorName = log.actor_name || nameMap.get(log.actor_id) || '誰か';
    const input = log.input || {};
    const breakdown = log.breakdown || {};
    const changes: CombatChange[] = log.changes || [];
    const rPrefix = `R${log.round}`;

    // 弾薬消費の集計
    if (typeof input.ammo_spent === 'number' && input.ammo_spent > 0) {
      ammoSpentMap.set(actorName, (ammoSpentMap.get(actorName) ?? 0) + input.ammo_spent);
    }
    for (const ch of changes) {
      if (ch.field === 'ammo') {
        const diff = Number(ch.before) - Number(ch.after);
        if (diff > 0) ammoSpentMap.set(actorName, (ammoSpentMap.get(actorName) ?? 0) + diff);
      }
      if (ch.field === 'status') {
        const after = (ch.after as string[]) || [];
        if (after.includes('dead') || after.includes('mortally')) {
          defeatedSet.add(ch.target_name || nameMap.get(ch.target_id) || ch.target_id);
        }
        if (after.includes('気絶')) {
          unconsciousSet.add(ch.target_name || nameMap.get(ch.target_id) || ch.target_id);
        }
      }
      if (ch.field === 'hp') {
        if (Number(ch.after) <= 0) {
          defeatedSet.add(ch.target_name || nameMap.get(ch.target_id) || ch.target_id);
        }
      }
    }

    // 攻撃・アクションの要約行
    let summaryLine = '';
    const formulaStr = typeof breakdown.formula === 'string' ? breakdown.formula : '';

    if (['ranged', 'aimed', 'autofire', 'suppressive', 'melee', 'brawl', 'martial_arts'].includes(log.action_key)) {
      const targetId = (input.target_id as string) || (input.attacks as Array<{ target_id?: string }>)?.[0]?.target_id;
      const targetName = targetId ? (nameMap.get(targetId) || '対象') : '対象';
      const weaponName = (input.weapon_name as string) || (input.weapon_id as string) || (log.action_key === 'brawl' ? '格闘' : log.action_key === 'martial_arts' ? '武術' : '武器');

      // 命中・外れ
      const hit = changes.some((c) => c.field === 'hp' || c.field === 'sp_body' || c.field === 'sp_head') || formulaStr.includes('命中');
      const hitLabel = hit ? '命中' : '外れ';

      // ダメージとSP貫通
      const hpChange = changes.find((c) => c.field === 'hp');
      const spChange = changes.find((c) => c.field === 'sp_body' || c.field === 'sp_head');
      let dmgPart = '';
      if (hpChange) {
        const hpLost = Number(hpChange.before) - Number(hpChange.after);
        const spBefore = spChange ? Number(spChange.before) : 0;
        dmgPart = ` ダメージ ${hpLost}（${spBefore ? `SP ${spBefore} で ` : ''}${hpLost} 通る）`;
      }

      // 内訳
      let innerFormula = '';
      if (formulaStr) {
        innerFormula = ` [${formulaStr}]`;
      }

      summaryLine = `・${rPrefix} ${actorName} → ${targetName} ${weaponName} ${hitLabel}${dmgPart}${innerFormula}`;
    } else if (log.action_key === 'first_aid') {
      const targetId = (input.target_id as string) || log.actor_id;
      const targetName = nameMap.get(targetId) || actorName;
      const success = formulaStr.includes('成功') || changes.some((c) => c.field === 'hp' && Number(c.after) > Number(c.before));
      summaryLine = `・${rPrefix} ${actorName} → ${targetName} 応急手当 ${success ? '成功' : '失敗'}${formulaStr ? ` [${formulaStr}]` : ''}`;
    } else if (log.action_key === 'status_add' || log.action_key === 'status_remove') {
      const status = input.status as string;
      const tName = nameMap.get(input.participant_id as string) || actorName;
      summaryLine = `・${rPrefix} ${tName} 状態: ${status} を${log.action_key === 'status_add' ? '付与' : '解除'}${input.rounds ? `（${input.rounds}R）` : ''}`;
    } else {
      const desc = changes.map((c) => c.desc).join('、') || formulaStr || log.action_key;
      summaryLine = `・${rPrefix} ${actorName} ${log.action_label || log.action_key}: ${desc}`;
    }

    if (summaryLine) {
      lines.push(summaryLine);
    }
  }

  // まとめ情報
  lines.push('【戦闘結果】');
  if (defeatedSet.size > 0) {
    lines.push(`・倒れた参加者: ${Array.from(defeatedSet).join('、')}`);
  }
  if (unconsciousSet.size > 0) {
    lines.push(`・気絶した参加者: ${Array.from(unconsciousSet).join('、')}`);
  }
  if (ammoSpentMap.size > 0) {
    const ammoParts = Array.from(ammoSpentMap.entries()).map(([name, count]) => `${name} ${count}発`);
    lines.push(`・消費弾薬: ${ammoParts.join('、')}`);
  }
  if (defeatedSet.size === 0 && unconsciousSet.size === 0 && ammoSpentMap.size === 0) {
    lines.push('・特筆事項なし');
  }

  return lines.join('\n');
}
