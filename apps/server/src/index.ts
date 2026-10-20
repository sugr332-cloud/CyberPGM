import path from 'node:path';
import fs from 'node:fs';
import { Hono } from 'hono';
import { getRequestListener } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import qrcode from 'qrcode';
import { getProjectRoot } from '@cyberpgm/shared';
import { itemsRouter } from './routes/items.js';
import { imagesRouter } from './routes/images.js';
import { authRoutes } from './routes/auth.js';
import { charactersRoutes } from './routes/characters.js';
import { moneyRoutes } from './routes/money.js';
import { savesRoutes } from './routes/saves.js';
import { settingsRoutes } from './routes/settings.js';
import { verifyToken, authMiddleware } from './auth.js';
import { sessionManager } from './session.js';
import { createDailyBackup } from './config.js';
import { resolveLanIp, startDualServer } from './net.js';

export const app = new Hono();

// WebSocket setup
export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Global auth context attachment
app.use('/api/*', authMiddleware);

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({ ok: true, session: sessionManager.getSessionCode() });
});

// Mount API routes
app.route('/api/auth', authRoutes);
app.route('/api', charactersRoutes);
app.route('/api/money', moneyRoutes);
app.route('/api/saves', savesRoutes);
app.route('/api', settingsRoutes);
app.route('/api/items', itemsRouter);
app.route('/api/images', imagesRouter);

// WebSocket endpoint
app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const token = c.req.query('token');
    const device = token ? verifyToken(token) : null;
    if (!device) {
      return {
        onOpen(_evt, ws) {
          ws.close(1008, 'Unauthorized: Valid device token required');
        },
      };
    }

    return {
      onOpen(_evt, ws) {
        sessionManager.addClient({
          ws,
          role: device.role,
          deviceId: device.id,
          characterId: device.characterId,
        });

        // If player, send initial character sheet immediately
        if (device.role === 'player' && device.characterId) {
          sessionManager.updateCharacterSheet(device.characterId);
        }
      },
      onMessage(evt, ws) {
        try {
          const data = JSON.parse(evt.data.toString());
          if (data && data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // ignore malformed messages
        }
      },
      onClose(_evt, ws) {
        sessionManager.removeClient(ws);
      },
      onError(_evt, ws) {
        sessionManager.removeClient(ws);
      },
    };
  }),
);

// SPA Static File Serving (from apps/web/dist)
const root = getProjectRoot();
const webDistDir = path.join(root, 'apps', 'web', 'dist');

app.get('*', async (c, next) => {
  // Pass through API and WS requests
  if (c.req.path.startsWith('/api/') || c.req.path === '/ws') {
    return next();
  }

  if (!fs.existsSync(webDistDir)) {
    return c.text('CyberPGM web app not built yet. Run npm run build.', 404);
  }

  const reqPath = c.req.path === '/' ? '/index.html' : c.req.path;
  const filePath = path.join(webDistDir, reqPath);

  // Security: check path traversal
  if (!filePath.startsWith(webDistDir)) {
    return c.text('Forbidden', 403);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    };
    c.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    return c.body(fs.readFileSync(filePath));
  }

  // SPA fallback to index.html
  const indexPath = path.join(webDistDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    c.header('Content-Type', 'text/html; charset=utf-8');
    return c.body(fs.readFileSync(indexPath));
  }

  return c.text('Not Found', 404);
});

// Server boot logic
export async function startServer(): Promise<void> {
  // 1. Daily backup
  const dbPath = path.join(root, 'data', 'cyberpgm.db');
  const backupFile = createDailyBackup(dbPath);
  if (backupFile) {
    console.log(`[backup] Daily snapshot created: ${backupFile}`);
  }

  // 2. Resolve LAN IP
  const lanArg = process.argv.find((a) => a.startsWith('--lan='))?.split('=')[1] ??
    (process.argv.includes('--lan') ? process.argv[process.argv.indexOf('--lan') + 1] : undefined);
  const lanResult = resolveLanIp({
    lanArg,
    envLan: process.env.LAN_IP,
  });

  if (lanResult.message) {
    console.log(`[net] ${lanResult.message}`);
  }

  const port = Number(process.env.PORT) || 8787;
  const listener = getRequestListener(app.fetch);

  const dualServer = await startDualServer(listener, {
    port,
    lanIp: lanResult.selectedIp,
  });

  // Inject WebSockets into all listeners
  for (const srv of dualServer.servers) {
    injectWebSocket(srv);
  }

  const sessionCode = sessionManager.getSessionCode();
  const gmUrl = `http://127.0.0.1:${port}/gm`;
  const playerHost = lanResult.selectedIp ? lanResult.selectedIp : '127.0.0.1';
  const playerUrl = `http://${playerHost}:${port}/player?join=${sessionCode}`;

  console.log('\n============================================================');
  console.log('              CYBERPUNK RED - CYBERPGM SESSION              ');
  console.log('============================================================\n');
  console.log(`  GM Window URL :  ${gmUrl}`);
  console.log(`  Player Join URL :  ${playerUrl}`);
  console.log(`  Session Code  :  ${sessionCode}\n`);

  try {
    const qrTerminal = await qrcode.toString(playerUrl, { type: 'terminal', small: true });
    console.log('  Player Join QR Code:');
    console.log(qrTerminal);
  } catch (err) {
    console.warn('Could not generate terminal QR code:', err);
  }

  console.log('============================================================\n');
}

// Auto-run if executed directly as entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((err) => {
    console.error('Failed to start CyberPGM server:', err);
    process.exit(1);
  });
}
