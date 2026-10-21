import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { app_settings, devices, rule_constants } from '../db/schema.js';
import { requireGm, revokeDeviceById } from '../auth.js';
import { sessionManager } from '../session.js';
import { AppSettingsSchema, PriceCategoriesSettingSchema } from '@cyberpgm/shared';

export const settingsRoutes = new Hono();

/**
 * GET /api/settings: GM gets application settings.
 */
settingsRoutes.get('/settings', requireGm, async (c) => {
  const row = db
    .select()
    .from(app_settings)
    .where(eq(app_settings.key, 'starting_funds'))
    .get();

  let starting_funds: number | null = null;
  if (row) {
    try {
      starting_funds = JSON.parse(row.value);
    } catch {
      starting_funds = null;
    }
  }

  return c.json({ starting_funds });
});

/**
 * PUT /api/settings: GM updates application settings.
 */
settingsRoutes.put('/settings', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = AppSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
  }

  const { starting_funds } = parsed.data;
  db.insert(app_settings)
    .values({
      key: 'starting_funds',
      value: JSON.stringify(starting_funds),
    })
    .onConflictDoUpdate({
      target: app_settings.key,
      set: { value: JSON.stringify(starting_funds) },
    })
    .run();

  return c.json({ starting_funds });
});

/**
 * GET /api/session: GM gets session info with QR SVG and device list.
 */
settingsRoutes.get('/session', requireGm, async (c) => {
  // Determine base URL from Host header or server config
  const host = c.req.header('Host') || '127.0.0.1:8787';
  const proto = c.req.header('X-Forwarded-Proto') || 'http';
  const hostUrl = `${proto}://${host}`;

  const info = await sessionManager.getSessionInfo(hostUrl);
  return c.json(info);
});

// GET /api/session/pc-qr: PC ごとの再開用 QR（今のセッションコード入り。保存ファイルには入れない。Phase 5d）
settingsRoutes.get('/session/pc-qr', requireGm, async (c) => {
  const host = c.req.header('Host') || '127.0.0.1:8787';
  const proto = c.req.header('X-Forwarded-Proto') || 'http';
  return c.json({ pcs: await sessionManager.getPcResumeCodes(`${proto}://${host}`) });
});

/**
 * DELETE /api/devices/:id: GM unlinks / revokes a device.
 */
settingsRoutes.delete('/devices/:id', requireGm, async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Missing device ID' }, 400);
  const existing = db.select().from(devices).where(eq(devices.id, id)).get();
  if (!existing) {
    return c.json({ error: 'Device not found' }, 404);
  }

  revokeDeviceById(id);
  sessionManager.broadcastPresence();

  return c.json({ success: true });
});

/**
 * GET /api/settings/price-categories: Get price categories with optional Japanese labels.
 */
settingsRoutes.get('/settings/price-categories', async (c) => {
  // Read base price category definitions from rule_constants
  const rcRow = db.select().from(rule_constants).where(eq(rule_constants.key, 'price_category')).get();
  let baseCategories: Array<{ key: string; max: number; label_ja?: string }> = [];
  if (rcRow) {
    try {
      baseCategories = JSON.parse(rcRow.value);
    } catch {
      baseCategories = [];
    }
  }

  // Read custom labels from app_settings
  const labelsRow = db
    .select()
    .from(app_settings)
    .where(eq(app_settings.key, 'price_categories_labels'))
    .get();

  if (labelsRow) {
    try {
      const customConfig = JSON.parse(labelsRow.value) as Array<{
        key: string;
        max: number;
        label_ja?: string;
      }>;
      const labelMap = new Map(customConfig.map((item) => [item.key, item.label_ja]));
      baseCategories = baseCategories.map((cat) => ({
        ...cat,
        label_ja: labelMap.get(cat.key) || cat.label_ja || '',
      }));
    } catch {
      // ignore
    }
  }

  return c.json({ price_categories: baseCategories });
});

/**
 * PUT /api/settings/price-categories: GM updates price category Japanese labels.
 */
settingsRoutes.put('/settings/price-categories', requireGm, async (c) => {
  const body = await c.req.json();
  const parsed = PriceCategoriesSettingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid price category settings', details: parsed.error.issues }, 400);
  }

  db.insert(app_settings)
    .values({
      key: 'price_categories_labels',
      value: JSON.stringify(parsed.data),
    })
    .onConflictDoUpdate({
      target: app_settings.key,
      set: { value: JSON.stringify(parsed.data) },
    })
    .run();

  return c.json({ price_categories: parsed.data });
});
