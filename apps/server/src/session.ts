import { WSContext } from 'hono/ws';
import qrcode from 'qrcode';
import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { devices, characters } from './db/schema.js';
import { generateSessionCode } from './config.js';
import {
  DeviceInfo,
  SessionInfo,
  WsNotifyKind,
} from '@cyberpgm/shared';
import { woundState } from '@cyberpgm/rules';
import { getCharacterSheetById } from './character-helper.js';

export interface ConnectedClient {
  ws: WSContext;
  role: 'gm' | 'player' | 'screen';
  deviceId: string;
  characterId?: string | null;
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

  constructor() {
    this.sessionCode = generateSessionCode();
  }

  public setCombatProvider(fn: () => any): void {
    this.combatProvider = fn;
  }

  public setBoardProvider(fn: (id: string) => any): void {
    this.boardProvider = fn;
  }

  public getSessionCode(): string {
    return this.sessionCode;
  }

  public resetSessionCode(): string {
    this.sessionCode = generateSessionCode();
    return this.sessionCode;
  }

  public addClient(client: ConnectedClient): void {
    this.clients.add(client);
    this.broadcastPresence();
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
   * Sends updated character sheet to a character's clients.
   */
  public updateCharacterSheet(characterId: string): void {
    const sheet = getCharacterSheetById(characterId);
    if (!sheet) return;

    this.sendToCharacter(characterId, {
      type: 'me:update',
      payload: sheet,
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
  public broadcastCombatUpdate(combat: object | null): void {
    this.sendToGm({
      type: 'combat:update',
      payload: combat,
    });
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
   * GM-only tokens and hidden enemies are omitted.
   * Background image is omitted if visibility is 'gm'.
   */
  public buildScreenPayload(): Record<string, unknown> {
    if (!this.combatProvider) {
      return { active: false };
    }
    const combat = this.combatProvider();
    if (!combat || combat.status === 'ended') {
      return { active: false };
    }

    const broadcastToTv = Boolean(combat.settings?.broadcastToTv);
    if (!broadcastToTv) {
      return { active: false };
    }

    // Sanitize combat participants
    const sanitizedParticipants = (combat.participants || []).map((p: any) => {
      if (p.side === 'ally') {
        return {
          id: p.id,
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
              }
            : null,
        };
      }

      // Enemy: ONLY name, image_path, wound state, status, crit_injuries.
      // NO hp, hp_max, sp_head, sp_body numbers!
      let woundLabel = '健康';
      if (p.character) {
        const state = woundState(p.character.hp, p.character.hp_max);
        if (state === 'dead' || p.character.hp <= 0) woundLabel = '死亡';
        else if (state === 'mortal') woundLabel = '瀕死';
        else if (state === 'serious') woundLabel = '重傷';
      }

      return {
        id: p.id,
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
              wound_state: woundLabel,
              status: p.character.status,
              crit_injuries: p.character.crit_injuries,
            }
          : null,
      };
    });

    let sanitizedBoard: any = null;
    if (combat.board_id && this.boardProvider) {
      const b = this.boardProvider(combat.board_id);
      if (b) {
        // If background image visibility is 'gm', omit image path on TV!
        const bgPath = b.background_image_visibility === 'gm' ? null : b.background_image_path;

        // Collect hidden enemy character IDs
        const hiddenEnemyCharIds = new Set<string>();
        for (const p of combat.participants || []) {
          if (p.side === 'enemy' && p.character?.status?.includes('隠れている') && p.character_id) {
            hiddenEnemyCharIds.add(p.character_id);
          }
        }

        // Filter tokens: omit gm_only and hidden enemies
        const filteredTokens = (b.tokens || []).filter((t: any) => {
          if (t.gm_only) return false;
          if (t.character_id && hiddenEnemyCharIds.has(t.character_id)) return false;
          return true;
        });

        sanitizedBoard = {
          ...b,
          background_image_path: bgPath,
          tokens: filteredTokens,
        };
      }
    }

    return {
      active: true,
      combat: {
        id: combat.id,
        status: combat.status,
        round: combat.round,
        turn_index: combat.turn_index,
        participants: sanitizedParticipants,
      },
      board: sanitizedBoard,
    };
  }

  /**
   * Broadcasts screen update to all TV clients (/screen).
   */
  public broadcastScreenUpdate(): void {
    const payload = this.buildScreenPayload();
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
