import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { app_settings, devices } from '../db/schema.js';
import { requireGm, revokeDeviceById } from '../auth.js';
import { sessionManager } from '../session.js';
import { AppSettingsSchema } from '@cyberpgm/shared';

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
