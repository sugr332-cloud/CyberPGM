import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { characters, money_log, char_log } from '../db/schema.js';
import { requireGm } from '../auth.js';
import { sessionManager } from '../session.js';
import {
  MoneyAllInputSchema,
  MoneySplitInputSchema,
  generateUlid,
} from '@cyberpgm/shared';
import { triggerAutoSave } from './saves.js';

export const moneyRoutes = new Hono();

/**
 * POST /api/money/all: Distribute identical amount to all PCs.
 */
moneyRoutes.post('/all', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = MoneyAllInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const { amount, reason } = parsed.data;
  const pcs = db.select().from(characters).where(eq(characters.kind, 'pc')).all();
  const now = Date.now();
  const sign = amount >= 0 ? '+' : '';

  for (const pc of pcs) {
    const newBalance = pc.eb + amount;
    db.update(characters)
      .set({ eb: newBalance, updated_at: now })
      .where(eq(characters.id, pc.id))
      .run();

    db.insert(money_log)
      .values({
        id: generateUlid(),
        character_id: pc.id,
        amount,
        reason,
        balance_after: newBalance,
        at: now,
      })
      .run();

    db.insert(char_log)
      .values({
        id: generateUlid(),
        character_id: pc.id,
        text: `GM から ${sign}${amount} eb — ${reason}`,
        at: now,
      })
      .run();

    sessionManager.updateCharacterSheet(pc.id);
    sessionManager.notifyCharacter(
      pc.id,
      'money',
      `GM から ${sign}${amount} eb`,
      reason,
    );
  }

  triggerAutoSave(`Money all: ${sign}${amount} eb to ${pcs.length} PCs`);

  return c.json({
    count: pcs.length,
    amount,
    reason,
  });
});

/**
 * POST /api/money/split: Split a total amount evenly across all PCs.
 * (Remainder is truncated and reported in response).
 */
moneyRoutes.post('/split', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = MoneySplitInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const { total, reason } = parsed.data;
  const pcs = db.select().from(characters).where(eq(characters.kind, 'pc')).all();
  if (pcs.length === 0) {
    return c.json({ error: 'No PCs to split funds across' }, 400);
  }

  const perPc = Math.floor(total / pcs.length);
  const remainder = total - perPc * pcs.length;
  const now = Date.now();
  const sign = perPc >= 0 ? '+' : '';

  for (const pc of pcs) {
    const newBalance = pc.eb + perPc;
    db.update(characters)
      .set({ eb: newBalance, updated_at: now })
      .where(eq(characters.id, pc.id))
      .run();

    db.insert(money_log)
      .values({
        id: generateUlid(),
        character_id: pc.id,
        amount: perPc,
        reason: `${reason}（山分け: 1人あたり ${perPc} eb）`,
        balance_after: newBalance,
        at: now,
      })
      .run();

    db.insert(char_log)
      .values({
        id: generateUlid(),
        character_id: pc.id,
        text: `GM から ${sign}${perPc} eb — ${reason}（山分け）`,
        at: now,
      })
      .run();

    sessionManager.updateCharacterSheet(pc.id);
    sessionManager.notifyCharacter(
      pc.id,
      'money',
      `GM から ${sign}${perPc} eb`,
      `${reason}（山分け）`,
    );
  }

  triggerAutoSave(`Money split: ${total} eb across ${pcs.length} PCs`);

  return c.json({
    total,
    per_pc: perPc,
    remainder,
    count: pcs.length,
  });
});

/**
 * GET /api/money/log: Full transaction history for GM.
 */
moneyRoutes.get('/log', requireGm, async (c) => {
  const rows = db.select().from(money_log).orderBy(desc(money_log.at)).limit(200).all();
  const allChars = db.select().from(characters).all();
  const charMap = new Map<string, string>();
  for (const char of allChars) {
    charMap.set(char.id, char.name);
  }

  const list = rows.map((r) => ({
    ...r,
    character_name: charMap.get(r.character_id) ?? 'Unknown',
  }));

  return c.json({ logs: list });
});
