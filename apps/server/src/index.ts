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
import { shopsRoutes } from './routes/shops.js';
import { commerceRoutes } from './routes/commerce.js';
import { characterCreationRoutes } from './routes/character-creation.js';
import { skillNotesRoutes } from './routes/skill-notes.js';
import { combatRoutes, getCurrentCombat, saveInitiativeRoll } from './routes/combat.js';
import { boardsRoutes, getHydratedBoard } from './routes/boards.js';
import { scenariosRouter } from './routes/scenarios.js';
import {
  scenarioPlayRoutes,
  getCurrentStoryScreen,
  handleStoryChoose,
  handleStoryRoll,
} from './routes/scenario-play.js';
import { db } from './db/client.js';
import { initPhase3bData } from './db/init-phase3b.js';
import { initPhase4aData } from './db/init-phase4a.js';
import { initPhase5cData } from './db/init-phase5c.js';
import { verifyToken, authMiddleware } from './auth.js';
import { sessionManager } from './session.js';
import { createDailyBackup } from './config.js';
import { resolveLanIp, startDualServer } from './net.js';
import { linkTextWeapons } from './weapon-link.js';
import { audioRoutes, syncAudioFolder, getAudioDir } from './routes/audio.js';
import { playerShopRoutes } from './routes/player-shop.js';
import { playersRoutes } from './routes/players.js';

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
app.route('/api/shops', shopsRoutes);
app.route('/api', commerceRoutes);
app.route('/api', characterCreationRoutes);
app.route('/api', skillNotesRoutes);
app.route('/api', combatRoutes);
app.route('/api', boardsRoutes);
app.route('/api/scenarios', scenariosRouter);
app.route('/api', scenarioPlayRoutes);
app.route('/api', audioRoutes);
app.route('/api', playerShopRoutes);
app.route('/api', playersRoutes);

// Configure session providers
sessionManager.setCombatProvider(getCurrentCombat);
sessionManager.setBoardProvider(getHydratedBoard);
sessionManager.setStoryProvider(getCurrentStoryScreen);

// Initialize Phase 3b data (skill notes, creation method)
initPhase3bData(db);

// Initialize Phase 4a data (combat actions)
initPhase4aData(db);
initPhase5cData(db);

// WebSocket endpoint
app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const token = c.req.query('token');
    const sessionCode = c.req.query('session') || c.req.query('code') || c.req.query('session_code');
    const roleQuery = c.req.query('role');

    let role: 'gm' | 'player' | 'screen' = 'player';
    let deviceId = '';
    let characterId: string | null | undefined = null;

    if (
      (roleQuery === 'screen' || (!token && sessionCode)) &&
      sessionCode?.toUpperCase() === sessionManager.getSessionCode().toUpperCase()
    ) {
      role = 'screen';
      deviceId = `screen-${Date.now()}`;
    } else {
      const device = token ? verifyToken(token) : null;
      if (!device) {
        return {
          onOpen(_evt, ws) {
            ws.close(1008, 'Unauthorized: Valid device token or session code required');
          },
        };
      }
      role = device.role;
      deviceId = device.id;
      characterId = device.characterId;
    }

    return {
      onOpen(_evt, ws) {
        sessionManager.addClient({
          ws,
          role,
          deviceId,
          characterId,
        });

        // If player, send initial character sheet immediately
        if (role === 'player' && characterId) {
          sessionManager.updateCharacterSheet(characterId);
        }

        // If screen, send initial screen update immediately
        if (role === 'screen') {
          sessionManager.sendInitialScreenUpdate(ws);
        }
      },
      onMessage(evt, ws) {
        try {
          const data = JSON.parse(evt.data.toString());
          if (data && data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          } else if (data && data.type === 'combat:choose') {
            if (role === 'player' && characterId) {
              const current = getCurrentCombat();
              if (current && current.status === 'active') {
                const activePart = current.participants[current.turn_index];
                const isDodge = data.payload?.action_key === 'dodge';
                if (isDodge || (activePart && activePart.character_id === characterId)) {
                  sessionManager.forwardCombatChooseToGm({
                    ...data.payload,
                    character_id: characterId,
                  });
                }
              }
            }
          } else if (data && data.type === 'combat:roll') {
            if (role === 'player' && characterId) {
              // イニシアチブの出目はサーバーにも残す。GM の戦闘画面が開いていなくても消えない（Phase 5l）
              if (data.payload?.roll_type === 'initiative') saveInitiativeRoll(characterId, data.payload);
              sessionManager.forwardCombatRollToGm({
                ...data.payload,
                character_id: characterId,
              });
            }
          } else if (data && data.type === 'story:choose') {
            if (role === 'player' && characterId) {
              handleStoryChoose({
                ...data.payload,
                characterId,
              });
            }
          } else if (data && data.type === 'story:roll') {
            if (role === 'player' && characterId) {
              handleStoryRoll(
                {
                  ...data.payload,
                  characterId,
                },
                ws,
              );
            }
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

  // 文字だけの武器を持ち物に移す（戦闘で選べるように。Phase 5j）
  const bgm = syncAudioFolder();
  if (bgm.added > 0) console.log(`[bgm] BGM フォルダ (${getAudioDir()}) の曲を ${bgm.added} 件、一覧に入れました`);
  const linked = linkTextWeapons();
  if (linked > 0) console.log(`[weapons] 文字だけの武器 ${linked} 件を持ち物に移しました`);

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

  sessionManager.setLanBaseUrl(dualServer.lanUrl);

  const sessionCode = sessionManager.getSessionCode();
  const gmUrl = `http://127.0.0.1:${port}/gm`;
  const playerUrl = `${dualServer.lanUrl ?? dualServer.localUrl}/player?join=${sessionCode}`;

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

  if (!dualServer.lanUrl) {
    console.log('  [!] Not listening on any LAN address. Phones cannot join until the PC is on a Wi-Fi/LAN.');
    console.log('      Connect to the Wi-Fi first, then restart CyberPGM.\n');
  } else {
    console.log('  If phones cannot open the URL:');
    console.log('    - Phones must be on the same Wi-Fi as this PC.');
    console.log('    - Public Wi-Fi (cafes, hotels) often blocks device-to-device traffic. Use a hotspot instead.');
    console.log(`    - Windows: allow TCP ${port} in the firewall (see README).`);
    console.log('    - If the Wi-Fi changed after startup, restart CyberPGM.\n');
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
