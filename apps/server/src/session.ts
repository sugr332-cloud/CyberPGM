import { WSContext } from 'hono/ws';
import qrcode from 'qrcode';
import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { devices, characters, images } from './db/schema.js';
import { generateSessionCode } from './config.js';
import {
  DeviceInfo,
  SessionInfo,
  WsNotifyKind,
} from '@cyberpgm/shared';
import { woundState } from '@cyberpgm/rules';
import { getCharacterSheetById, maskAmmoForPlayer } from './character-helper.js';

export interface ConnectedClient {
  ws: WSContext;
  role: 'gm' | 'player' | 'screen';
  deviceId: string;
  characterId?: string | null;
}

export interface PublishedStory {
  scenario_session_id: string;
  scene_id: string;
  choices: Array<{ id: string; label: string; skill_key: string | null; who?: string | null }>;
  generalActions: Array<{ key: string; label: string }>;
}

export interface ClaimRequest {
  requestId: string;
  characterId: string;
  characterName: string;
  deviceLabel?: string;
  resolve: (allow: boolean) => void;
  timer: NodeJS.Timeout;
}

export class SessionManager {
  private sessionCode: string;
  private clients = new Set<ConnectedClient>();
  private pendingClaims = new Map<string, ClaimRequest>();
  private combatProvider: (() => any) | null = null;
  private boardProvider: ((id: string) => any) | null = null;
  private storyProvider: (() => any) | null = null;
  private publishedStory: PublishedStory | null = null;
  // 起動時に待ち受けた LAN の URL（例: http://192.168.0.90:8787）。QR はこれで作る（Phase 5h）
  private lanBaseUrl: string | null = null;

  constructor() {
    this.sessionCode = generateSessionCode();
  }

  public setCombatProvider(fn: () => any): void {
    this.combatProvider = fn;
  }

  public setBoardProvider(fn: (id: string) => any): void {
    this.boardProvider = fn;
  }

  public setStoryProvider(fn: () => any): void {
    this.storyProvider = fn;
  }

  public getSessionCode(): string {
    return this.sessionCode;
  }

  public setLanBaseUrl(url: string | null): void {
    this.lanBaseUrl = url;
  }

  /**
   * 参加 QR の URL の土台。GM が localhost や Tailscale で開いていても、
   * スマホが届く LAN の URL を使う。LAN で待ち受けていないときだけ、GM が開いたアドレスを使う。
   */
  public getJoinBaseUrl(requestBaseUrl: string): string {
    return this.lanBaseUrl ?? requestBaseUrl;
  }

  public resetSessionCode(): string {
    this.sessionCode = generateSessionCode();
    return this.sessionCode;
  }

  public addClient(client: ConnectedClient): void {
    this.clients.add(client);
    this.broadcastPresence();
    if (client.role === 'player' && client.characterId && this.publishedStory) {
      this.safeSend(client, { type: 'story:choices', payload: this.storyChoicesFor(client.characterId) });
    }
  }

  /** いまスマホでつながっている PC の ID（シナリオ開始時の縛り用。Phase 5i） */
  public getConnectedCharacterIds(): string[] {
    const ids = new Set<string>();
    for (const client of this.clients) {
      if (client.role === 'player' && client.characterId) ids.add(client.characterId);
    }
    return [...ids];
  }

  public removeClient(ws: WSContext): void {
    for (const client of this.clients) {
      if (client.ws === ws) {
        this.clients.delete(client);
        break;
      }
    }
    this.broadcastPresence();
  }

  /**
   * Sends a message to all connected GM clients.
   */
  public sendToGm(message: object): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.role === 'gm') {
        try {
          client.ws.send(payload);
        } catch {
          // ignore
        }
      }
    }
  }

  /** プレイヤーのスマホ全部に送る（Phase 5g: スマホの商店の開け閉め） */
  public broadcastToPlayers(message: object): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.role === 'player') {
        try {
          client.ws.send(payload);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Sends a message to connected clients of a specific character.
   */
  public sendToCharacter(characterId: string, message: object): void {
    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.role === 'player' && client.characterId === characterId) {
        try {
          client.ws.send(payload);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Sends a notification banner message to a character.
   */
  public notifyCharacter(characterId: string, kind: WsNotifyKind, title: string, body: string): void {
    this.sendToCharacter(characterId, {
      type: 'notify',
      payload: { kind, title, body },
    });
  }

  /**
   * 戦闘の告知（Phase 5r）: 状態異常・弾切れなど。GM には 'combat:notice'、プレイヤーにはお知らせの帯で出す。
   * players: 'all' は全員のスマホ、文字列の配列はそのキャラのスマホだけ、空なら GM だけ
   */
  public announceCombat(title: string, body: string, players: 'all' | string[] = 'all'): void {
    this.sendToGm({ type: 'combat:notice', payload: { title, body, at: Date.now() } });
    const msg = { type: 'notify', payload: { kind: 'info', title, body } };
    if (players === 'all') this.broadcastToPlayers(msg);
    else for (const id of players) this.sendToCharacter(id, msg);
  }

  /**
   * Sends updated character sheet to a character's clients.
   */
  public updateCharacterSheet(characterId: string): void {
    const sheet = getCharacterSheetById(characterId);
    if (!sheet) return;

    this.sendToCharacter(characterId, {
      type: 'me:update',
      payload: maskAmmoForPlayer(sheet),
    });
  }

  /**
   * Sends updated character sheets to all active players.
   */
  public updateAllCharacterSheets(): void {
    const charIds = new Set<string>();
    for (const client of this.clients) {
      if (client.role === 'player' && client.characterId) {
        charIds.add(client.characterId);
      }
    }
    for (const cid of charIds) {
      this.updateCharacterSheet(cid);
    }
  }

  /**
   * Broadcasts current presence list to GMs.
   */
  public broadcastPresence(): void {
    const devicesList = this.getDevicesList();
    this.sendToGm({
      type: 'gm:presence',
      payload: { devices: devicesList },
    });
  }

  /**
   * Retrieves all active/registered devices and marks their online status.
   */
  public getDevicesList(): DeviceInfo[] {
    const rows = db.select().from(devices).where(eq(devices.revoked, false)).all();
    const onlineDeviceIds = new Set<string>();
    for (const client of this.clients) {
      onlineDeviceIds.add(client.deviceId);
    }

    const charMap = new Map<string, string>();
    const chars = db.select().from(characters).all();
    for (const c of chars) {
      charMap.set(c.id, c.name);
    }

    return rows.map((r) => ({
      id: r.id,
      role: r.role as 'gm' | 'player',
      character_id: r.character_id,
      character_name: r.character_id ? charMap.get(r.character_id) ?? null : null,
      label: r.label,
      last_seen_at: r.last_seen_at,
      online: onlineDeviceIds.has(r.id),
    }));
  }

  /**
   * Initiates a claim conflict request. Sends `gm:claim-request` to GM and returns a promise
   * resolving to boolean (allowed or rejected).
   */
  public requestClaim(params: {
    requestId: string;
    characterId: string;
    characterName: string;
    deviceLabel?: string;
  }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Auto-reject after 60 seconds if no answer from GM
      const timer = setTimeout(() => {
        this.pendingClaims.delete(params.requestId);
        resolve(false);
      }, 60000);

      this.pendingClaims.set(params.requestId, {
        ...params,
        resolve,
        timer,
      });

      this.sendToGm({
        type: 'gm:claim-request',
        payload: {
          requestId: params.requestId,
          character_id: params.characterId,
          character_name: params.characterName,
          deviceLabel: params.deviceLabel,
        },
      });
    });
  }

  public resolveClaim(requestId: string, allow: boolean): boolean {
    const claim = this.pendingClaims.get(requestId);
    if (!claim) return false;

    clearTimeout(claim.timer);
    this.pendingClaims.delete(requestId);
    claim.resolve(allow);
    return true;
  }

  public getPendingClaimIds(): string[] {
    return Array.from(this.pendingClaims.keys());
  }

  /**
   * Broadcasts combat state update to all GM clients.
   */
  /** キャラのHP編集・医療による回復も、戦闘カード・盤面・TVへ同期する。 */
  public broadcastCurrentCombat(): void {
    const combat = this.combatProvider?.();
    if (combat) this.broadcastCombatUpdate(combat);
    else this.broadcastScreenUpdate();
  }

  public broadcastCombatUpdate(combat: object | null): void {
    this.sendToGm({
      type: 'combat:update',
      payload: combat,
    });
    // スマホには中身を送らず、知らせるだけ。スマホは自分向けに伏せた戦闘を読み直す（Phase 5l）
    this.broadcastToPlayers({ type: 'combat:changed' });
    this.broadcastScreenUpdate();
  }

  /**
   * Broadcasts board state update to all GM clients.
   */
  public broadcastBoardUpdate(board: object | null): void {
    this.sendToGm({
      type: 'board:update',
      payload: board,
    });
    this.broadcastScreenUpdate();
  }

  /**
   * Builds sanitized payload for TV screen (/screen).
   * Enemies have NO hp/sp numbers (only name and wound state).
   * GM-only tokens, hidden enemies, and tokens/objects in fog are omitted.
   * Background image is omitted if visibility is 'gm'.
   */
  /** プレイヤーにも見せてよい画像の ID だけ返す（GM のみの画像は表示ウィンドウに出さない） */
  private visibleImageId(id: string | null | undefined): string | null {
    if (!id) return null;
    const img = db.select().from(images).where(eq(images.id, id)).get();
    return img && img.visibility !== 'gm' ? img.id : null;
  }

  /** 立ち絵: キャラの名前と立ち絵の画像 ID を付ける。立ち絵がない・GM のみの画像なら出さない */
  private resolvePortraits(portraits: Array<{ character_id: string; x: number; y: number; scale: number; flip: boolean; z: number; show_name: boolean }>) {
    return portraits
      .map((p) => {
        const ch = db.select().from(characters).where(eq(characters.id, p.character_id)).get();
        const imageId = this.visibleImageId(ch?.portrait_image_id);
        return ch && imageId ? { ...p, name: ch.name, image_id: imageId } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => a.z - b.z);
  }

  /** 戦闘中の BGM: 戦闘の設定に曲があればそれ、なければストーリーの曲を流し続ける */
  private combatBgm(combat: { settings?: unknown }) {
    const settings = (typeof combat.settings === 'string' ? JSON.parse(combat.settings) : combat.settings) as { bgm?: { audio_id: string; loop: boolean; volume: number } } | undefined;
    if (settings?.bgm?.audio_id) return { ...settings.bgm, playing: true };
    return this.storyProvider?.()?.bgm ?? null;
  }

  /**
   * 戦闘の盤面を、TV 画面・プレイヤーのスマホに見せてよい形にする（GM だけのコマ・隠れている敵・霧の中を除く。敵の HP は出さない）。
   * Phase 6a でプレイヤーのマップにも使うため、表示ウィンドウの組み立てから切り出した
   */
  public sanitizeCombatBoard(combat: any): any {
    let sanitizedBoard: any = null;
    if (combat.board_id && this.boardProvider) {
      const b = this.boardProvider(combat.board_id);
      if (b) {
        // If background image visibility is 'gm', omit image path on TV!
        const bgPath = b.background_image_visibility === 'gm' ? null : b.background_image_path;

        // Build fog coordinate set for server-side fog filtering
        const fogList: Array<{ x: number; y: number }> = b.fog || [];
        const fogSet = new Set<string>();
        for (const f of fogList) {
          fogSet.add(`${f.x},${f.y}`);
        }

        // Collect hidden enemy character IDs
        const hiddenEnemyCharIds = new Set<string>();
        for (const p of combat.participants || []) {
          if (p.side === 'enemy' && p.character?.status?.includes('隠れている') && p.character_id) {
            hiddenEnemyCharIds.add(p.character_id);
          }
        }

        // Filter tokens: omit gm_only, hidden enemies, and tokens inside fog
        const filteredTokens = (b.tokens || [])
          .filter((t: any) => {
            if (t.gm_only) return false;
            if (t.character_id && hiddenEnemyCharIds.has(t.character_id)) return false;
            if (fogSet.has(`${t.x},${t.y}`)) return false;
            return true;
          })
          .map((t: any) => {
            const part = (combat.participants || []).find(
              (p: any) =>
                (p.character_id && p.character_id === t.character_id) ||
                p.id === t.character_id,
            );
            if (!part) {
              return {
                ...t,
                name: t.character_id ? '不明' : '—',
                side: null,
                wound_state: null,
                hp: null,
                hp_max: null,
              };
            }

            let woundCode: 'ok' | 'seriously' | 'mortally' | 'dead' = 'ok';
            if (part.character) {
              const hp = part.character.hp;
              const maxHp = part.character.hp_max;
              if (hp <= 0) woundCode = 'dead';
              else woundCode = woundState(hp, maxHp);
            }

            if (part.side === 'ally') {
              return {
                ...t,
                character_id: part.character_id,
                name: part.name,
                side: 'ally',
                wound_state: woundCode,
                hp: part.character?.hp ?? null,
                hp_max: part.character?.hp_max ?? null,
              };
            }

            // Enemy token: ONLY name, side, wound_state (NO hp / hp_max!)
            return {
              ...t,
              character_id: part.character_id,
              name: part.name,
              side: 'enemy',
              wound_state: woundCode,
              hp: null,
              hp_max: null,
            };
          });

        // Filter objects: omit objects inside fog
        const filteredObjects = (b.objects || []).filter((o: any) => {
          const w = o.w || 1;
          const h = o.h || 1;
          for (let dx = 0; dx < w; dx++) {
            for (let dy = 0; dy < h; dy++) {
              if (fogSet.has(`${o.x + dx},${o.y + dy}`)) {
                return false;
              }
            }
          }
          return true;
        });

        sanitizedBoard = {
          ...b,
          background_image_path: bgPath,
          fog: fogList,
          tokens: filteredTokens,
          objects: filteredObjects,
        };
      }
    }
    return sanitizedBoard;
  }

  public buildScreenPayload(): Record<string, unknown> {
    const combat = this.combatProvider ? this.combatProvider() : null;
    const isCombatActive = combat && combat.status !== 'ended' && combat.settings?.broadcastToTv !== false;

    if (isCombatActive) {
      // Sanitize combat participants
      const sanitizedParticipants = (combat.participants || []).map((p: any) => {
        const isTurn = p.id === combat.participants?.[combat.turn_index]?.id;
        const rangeRingInfo = isTurn && p.character
          ? {
              stats: { move: p.character.stats?.move ?? 6 },
              inventory: (p.character.inventory || [])
                .filter((entry: any) => entry.kind === 'weapon' && entry.is_ranged !== false && entry.dv_table)
                .slice(0, 1)
                .map((entry: any) => ({ entry_id: entry.entry_id, kind: entry.kind, is_ranged: entry.is_ranged, dv_table: entry.dv_table })),
            }
          : {};
        if (p.side === 'ally') {
          return {
            id: p.id,
            character_id: p.character_id,
            name: p.name,
            side: p.side,
            initiative: p.initiative,
            order_index: p.order_index,
            active: p.active,
            out: p.out,
            character: p.character
              ? {
                  id: p.character.id,
                  name: p.character.name,
                  role: p.character.role,
                  image_path: p.character.image_path,
                  hp: p.character.hp,
                  hp_max: p.character.hp_max,
                  sp_head: p.character.sp_head,
                  sp_body: p.character.sp_body,
                  status: p.character.status,
                  crit_injuries: p.character.crit_injuries,
                  ...rangeRingInfo,
                }
              : null,
          };
        }

        // Enemy: ONLY name, image_path, wound state, status, crit_injuries.
        // NO hp, hp_max, sp_head, sp_body numbers!
        let woundLabel = '健康';
        let woundCode: 'ok' | 'seriously' | 'mortally' | 'dead' = 'ok';
        if (p.character) {
          const state = woundState(p.character.hp, p.character.hp_max);
          if (state === 'dead' || p.character.hp <= 0) {
            woundLabel = '死亡';
            woundCode = 'dead';
          } else if (state === 'mortally') {
            woundLabel = '瀕死';
            woundCode = 'mortally';
          } else if (state === 'seriously') {
            woundLabel = '重傷';
            woundCode = 'seriously';
          }
        }

        return {
          id: p.id,
          character_id: p.character_id,
          name: p.name,
          side: p.side,
          initiative: p.initiative,
          order_index: p.order_index,
          active: p.active,
          out: p.out,
          wound_state: woundLabel,
          wound_code: woundCode,
          character: p.character
            ? {
                id: p.character.id,
                name: p.character.name,
                role: p.character.role,
                image_path: p.character.image_path,
                wound_state: woundLabel,
                status: p.character.status,
                crit_injuries: p.character.crit_injuries,
                ...rangeRingInfo,
              }
            : null,
        };
      });

      const sanitizedBoard = this.sanitizeCombatBoard(combat);

      return {
        active: true,
        mode: 'combat',
        combat: {
          id: combat.id,
          status: combat.status,
          round: combat.round,
          turn_index: combat.turn_index,
          participants: sanitizedParticipants,
        },
        board: sanitizedBoard,
        objects: sanitizedBoard?.objects || [],
        tokens: sanitizedBoard?.tokens || [],
        drops: sanitizedBoard?.drops || [],
        bgm: this.combatBgm(combat),
      };
    }

    // When combat is not active, check story projection
    if (this.storyProvider) {
      const storyScreen = this.storyProvider();
      if (storyScreen && storyScreen.active) {
        let sanitizedStoryBoard: any = null;
        if (storyScreen.board_id && this.boardProvider) {
          const b = this.boardProvider(storyScreen.board_id);
          if (b) {
            const bgPath = b.background_image_visibility === 'gm' ? null : b.background_image_path;
            const fogList: Array<{ x: number; y: number }> = b.fog || [];
            const fogSet = new Set<string>();
            for (const f of fogList) {
              fogSet.add(`${f.x},${f.y}`);
            }

            // 戦闘外: PC は味方、それ以外は敵として描く。敵は名前と負傷状態だけ（HP の数値は送らない）
            const charOf = (id: string | null | undefined) =>
              id ? db.select().from(characters).where(eq(characters.id, id)).get() : undefined;
            const filteredTokens = (b.tokens || [])
              .filter((t: any) => {
                if (t.gm_only) return false;
                if (fogSet.has(`${t.x},${t.y}`)) return false;
                const ch = charOf(t.character_id);
                if (ch && ch.kind !== 'pc' && JSON.parse(ch.status || '[]').includes('隠れている')) return false;
                return true;
              })
              .map((t: any) => {
                const ch = charOf(t.character_id);
                if (!ch) return { ...t, name: '—', side: null, wound_state: null, hp: null, hp_max: null };
                const wound = ch.hp <= 0 ? 'dead' : woundState(ch.hp, ch.hp_max);
                return ch.kind === 'pc'
                  ? { ...t, name: ch.name, side: 'ally', wound_state: wound, hp: ch.hp, hp_max: ch.hp_max }
                  : { ...t, name: ch.name, side: 'enemy', wound_state: wound, hp: null, hp_max: null };
              });

            const filteredObjects = (b.objects || []).filter((o: any) => {
              const w = o.w || 1;
              const h = o.h || 1;
              for (let dx = 0; dx < w; dx++) {
                for (let dy = 0; dy < h; dy++) {
                  if (fogSet.has(`${o.x + dx},${o.y + dy}`)) {
                    return false;
                  }
                }
              }
              return true;
            });

            sanitizedStoryBoard = {
              ...b,
              background_image_path: bgPath,
              fog: fogList,
              tokens: filteredTokens,
              objects: filteredObjects,
            };
          }
        }

        return {
          active: true,
          mode: 'story',
          board: sanitizedStoryBoard,
          objects: sanitizedStoryBoard?.objects || [],
          tokens: sanitizedStoryBoard?.tokens || [],
          drops: sanitizedStoryBoard?.drops || [],
          background_image_id: this.visibleImageId(storyScreen.background_image_id),
          portraits: this.resolvePortraits(storyScreen.portraits ?? []),
          bgm: storyScreen.bgm ?? null,
          tv_handout: storyScreen.tv_handout || null,
        };
      }
    }

    return { active: false };
  }

  /**
   * Broadcasts screen update to all TV clients (/screen).
   */
  public broadcastScreenUpdate(): void {
    const payload = this.buildScreenPayload();
    // GM の画面でも BGM を鳴らせるように、いまの BGM を GM にも送る（Phase 5n）
    const story = this.storyProvider?.();
    this.sendToGm({ type: 'bgm:update', payload: story && story.active ? (story.bgm ?? null) : null });
    const msg = JSON.stringify({
      type: 'screen:update',
      payload,
    });
    for (const client of this.clients) {
      if (client.role === 'screen') {
        try {
          client.ws.send(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Sends initial screen payload to a freshly connected screen client.
   */
  public sendInitialScreenUpdate(ws: WSContext): void {
    const payload = this.buildScreenPayload();
    try {
      ws.send(
        JSON.stringify({
          type: 'screen:update',
          payload,
        }),
      );
    } catch {
      // ignore
    }
  }

  /**
   * Broadcasts turn change to GM and all players.
   */
  public broadcastCombatTurn(info: {
    combat_id: string;
    round: number;
    turn_index: number;
    actor_id: string;
    actor_name: string;
    actor_char_id?: string | null;
  }): void {
    for (const client of this.clients) {
      if (client.role === 'gm') {
        try {
          client.ws.send(
            JSON.stringify({
              type: 'combat:turn',
              payload: {
                combat_id: info.combat_id,
                round: info.round,
                turn_index: info.turn_index,
                actor_id: info.actor_id,
                actor_name: info.actor_name,
                is_my_turn: false,
              },
            }),
          );
        } catch {
          // ignore
        }
      } else if (client.role === 'player') {
        const isMyTurn = Boolean(info.actor_char_id && client.characterId === info.actor_char_id);
        try {
          client.ws.send(
            JSON.stringify({
              type: 'combat:turn',
              payload: {
                combat_id: info.combat_id,
                round: info.round,
                turn_index: info.turn_index,
                actor_id: info.actor_id,
                actor_name: info.actor_name,
                is_my_turn: isMyTurn,
              },
            }),
          );
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Sends combat result notification to participants.
   */
  public notifyCombatResult(params: {
    characterId?: string | null;
    title: string;
    summary: string;
    changes: unknown[];
    is_victim?: boolean;
  }): void {
    if (params.characterId) {
      this.sendToCharacter(params.characterId, {
        type: 'combat:result',
        payload: {
          title: params.title,
          summary: params.summary,
          changes: params.changes,
          is_victim: params.is_victim,
        },
      });
    }
  }

  /**
   * Forwards player action choice to GMs.
   */
  public forwardCombatChooseToGm(data: object): void {
    this.sendToGm({
      type: 'combat:choose',
      payload: data,
    });
  }

  /**
   * Forwards player roll to GMs.
   */
  public forwardCombatRollToGm(data: object): void {
    this.sendToGm({
      type: 'combat:roll',
      payload: data,
    });
  }

  /**
   * Broadcasts revealed handouts/clues update to player and GM clients.
   */
  public broadcastHandouts(payload: object): void {
    const msg = JSON.stringify({
      type: 'handouts:update',
      payload,
    });
    for (const client of this.clients) {
      if (client.role === 'player' || client.role === 'gm') {
        try {
          client.ws.send(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Broadcasts display update (e.g. GM-projected image) to players.
   */
  public broadcastDisplayUpdate(imagePath: string | null): void {
    const msg = JSON.stringify({
      type: 'display:update',
      payload: { image_path: imagePath },
    });
    for (const client of this.clients) {
      if (client.role === 'player') {
        try {
          client.ws.send(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * 公開中の選択肢を送る。GM には全部、プレイヤーには「誰が選べるか」に合うものだけを、
   * 名前と技能だけにして送る（成功・失敗の結果は GM だけが知る）。再接続したプレイヤーにも送り直す。
   */
  public broadcastStoryChoices(payload: PublishedStory | null): void {
    this.publishedStory = payload;
    for (const client of this.clients) {
      if (client.role === 'gm') {
        this.safeSend(client, { type: 'story:choices', payload });
      } else if (client.role === 'player' && client.characterId) {
        this.safeSend(client, { type: 'story:choices', payload: this.storyChoicesFor(client.characterId) });
      }
    }
  }

  private storyChoicesFor(characterId: string) {
    if (!this.publishedStory) return null;
    const ch = db.select().from(characters).where(eq(characters.id, characterId)).get();
    const allowed = (who: string | null | undefined) => {
      const w = (who ?? '').trim();
      if (!w || w === '全員') return true;
      const names = w.split(/[、,\s]+/).filter(Boolean);
      return !!ch && (names.includes(ch.id) || names.includes(ch.name) || names.includes(ch.role));
    };
    return {
      scenario_session_id: this.publishedStory.scenario_session_id,
      scene_id: this.publishedStory.scene_id,
      choices: this.publishedStory.choices
        .filter((c) => allowed(c.who))
        .map((c) => ({ id: c.id, label: c.label, skill_key: c.skill_key })),
      generalActions: this.publishedStory.generalActions,
    };
  }

  private safeSend(client: ConnectedClient, message: object): void {
    try {
      client.ws.send(JSON.stringify(message));
    } catch {
      // ignore
    }
  }


  /**
   * Broadcasts story check update to GM clients.
   */
  public broadcastStoryCheckUpdate(sessionId: string): void {
    this.sendToGm({
      type: 'story:check_update',
      payload: { scenario_session_id: sessionId },
    });
  }

  /**
   * Sends story check evaluation result to a specific character.
   */
  public sendStoryResult(characterId: string, result: object): void {
    this.sendToCharacter(characterId, {
      type: 'story:result',
      payload: result,
    });
  }

  /**
   * PC ごとの再開用の URL と QR（?join=<今のコード>&pc=<キャラ ID>）。
   */
  public async getPcResumeCodes(hostUrl: string) {
    const pcs = db.select().from(characters).where(eq(characters.kind, 'pc')).all();
    return Promise.all(
      pcs.map(async (pc) => {
        const url = `${hostUrl}/player?join=${this.sessionCode}&pc=${pc.id}`;
        return {
          id: pc.id,
          name: pc.name,
          role: pc.role,
          image_id: pc.image_id,
          url,
          qrSvg: await qrcode.toString(url, { type: 'svg', margin: 1 }),
        };
      }),
    );
  }

  /**
   * Generates session info with QR SVG.
   */
  public async getSessionInfo(hostUrl: string): Promise<SessionInfo> {
    const joinUrl = `${hostUrl}/player?join=${this.sessionCode}`;
    const qrSvg = await qrcode.toString(joinUrl, { type: 'svg', margin: 1 });
    return {
      code: this.sessionCode,
      joinUrl,
      qrSvg,
      devices: this.getDevicesList(),
    };
  }
}

export const sessionManager = new SessionManager();
