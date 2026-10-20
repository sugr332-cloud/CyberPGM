import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { itemsRouter } from './routes/items.js';
import { imagesRouter } from './routes/images.js';

const app = new Hono();

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ ok: true });
});

// API routes
app.route('/api/items', itemsRouter);
app.route('/api/images', imagesRouter);

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '127.0.0.1';

console.log(`Starting CyberPGM server on http://${host}:${port}`);

serve({
  fetch: app.fetch,
  port,
  hostname: host,
});
