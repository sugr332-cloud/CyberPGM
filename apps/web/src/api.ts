import {
  Character,
  CharacterSheet,
  SessionInfo,
  SaveSummary,
  MoneyLogEntry,
  CharLogEntry,
  Shop,
  ShopStockItem,
  Transaction,
  PurchaseInput,
  SellInput,
  PriceCategoryConfig,
  ItemPatchInput,
  CreationMethodConfig,
  CharacterDraft,
  CharacterSubmission,
  CpgmCharacterFile,
  Board,
  BoardObject,
  BoardToken,
  BoardDrop,
} from '@cyberpgm/shared';

export const API_BASE = '';

export function getGmToken(): string | null {
  return localStorage.getItem('cpgm_gm_token');
}

export function setGmToken(token: string): void {
  localStorage.setItem('cpgm_gm_token', token);
}

export function removeGmToken(): void {
  localStorage.removeItem('cpgm_gm_token');
}

export function getPlayerToken(): string | null {
  return localStorage.getItem('cpgm_player_token');
}

export function setPlayerToken(token: string): void {
  localStorage.setItem('cpgm_player_token', token);
}

export function removePlayerToken(): void {
  localStorage.removeItem('cpgm_player_token');
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && !(options.body instanceof FormData) && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed with status ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  fetchGmToken: () =>
    request<{ token: string; role: 'gm'; deviceId: string }>('/api/auth/gm-token', {
      method: 'POST',
    }),

  joinSession: (code: string) =>
    request<{
      code: string;
      characters: Array<{
        id: string;
        name: string;
        role: string;
        image_id: string | null;
        image_path: string | null;
        claimed: boolean;
      }>;
    }>('/api/auth/join', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  claimCharacter: (code: string, character_id: string) =>
    request<{ token: string; role: 'player'; character_id: string; deviceId: string }>(
      '/api/auth/claim',
      {
        method: 'POST',
        body: JSON.stringify({ code, character_id }),
      },
    ),

  resolveClaim: (requestId: string, allow: boolean) =>
    request<{ success: boolean }>(`/api/auth/claim/${requestId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ allow }),
    }, getGmToken()),

  // Character
  getMySheet: () =>
    request<{ sheet: CharacterSheet; logs: CharLogEntry[] }>('/api/me', {}, getPlayerToken()),

  getCharacters: () =>
    request<{ characters: CharacterSheet[] }>('/api/characters', {}, getGmToken()),

  createCharacter: (data: Partial<Character>) =>
    request<{ character: CharacterSheet }>('/api/characters', {
      method: 'POST',
      body: JSON.stringify(data),
    }, getGmToken()),

  updateCharacter: (id: string, data: Partial<Character>) =>
    request<{ character: CharacterSheet }>(`/api/characters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, getGmToken()),

  deleteCharacter: (id: string) =>
    request<{ success: boolean }>(`/api/characters/${id}`, {
      method: 'DELETE',
    }, getGmToken()),

  // Money
  sendMoney: (id: string, amount: number, reason: string) =>
    request<{ balance_after: number }>(`/api/characters/${id}/money`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    }, getGmToken()),

  sendMoneyAll: (amount: number, reason: string) =>
    request<{ count: number }>(`/api/money/all`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    }, getGmToken()),

  splitMoney: (total: number, reason: string) =>
    request<{ total: number; per_pc: number; remainder: number; count: number }>(`/api/money/split`, {
      method: 'POST',
      body: JSON.stringify({ total, reason }),
    }, getGmToken()),

  getMoneyLogs: () =>
    request<{ logs: MoneyLogEntry[] }>(`/api/money/log`, {}, getGmToken()),

  // Settings & Session
  getSettings: () =>
    request<{ starting_funds: number | null }>('/api/settings', {}, getGmToken()),

  updateSettings: (starting_funds: number | null) =>
    request<{ starting_funds: number | null }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ starting_funds }),
    }, getGmToken()),

  getSessionInfo: () =>
    request<SessionInfo>('/api/session', {}, getGmToken()),

  unlinkDevice: (id: string) =>
    request<{ success: boolean }>(`/api/devices/${id}`, {
      method: 'DELETE',
    }, getGmToken()),

  // Saves
  getSaves: () =>
    request<{ saves: SaveSummary[] }>('/api/saves', {}, getGmToken()),

  createSave: (name: string) =>
    request<{ save: SaveSummary }>('/api/saves', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }, getGmToken()),

  overwriteSave: (id: string) =>
    request<{ save: SaveSummary }>(`/api/saves/${id}`, {
      method: 'PUT',
    }, getGmToken()),

  loadSave: (id: string) =>
    request<{ success: boolean; loadedSave: string }>(`/api/saves/${id}/load`, {
      method: 'POST',
    }, getGmToken()),

  renameSave: (id: string, name: string) =>
    request<{ save: SaveSummary }>(`/api/saves/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }, getGmToken()),

  deleteSave: (id: string) =>
    request<{ success: boolean }>(`/api/saves/${id}`, {
      method: 'DELETE',
    }, getGmToken()),

  importSave: (jsonText: string) =>
    request<{ save: SaveSummary }>('/api/saves/import', {
      method: 'POST',
      body: jsonText,
    }, getGmToken()),

  // Catalog & Items
  getItems: (params?: Record<string, string | number | boolean | undefined>) => {
    const query = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') {
          query.set(k, String(v));
        }
      }
    }
    const qStr = query.toString();
    return request<{
      items: any[];
      total: number;
      category_counts: Record<string, number>;
    }>(`/api/items${qStr ? `?${qStr}` : ''}`, {}, getGmToken());
  },

  getItem: (id: string) =>
    request<any>(`/api/items/${id}`, {}, getGmToken()),

  updateItem: (id: string, data: ItemPatchInput) =>
    request<any>(`/api/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, getGmToken()),

  uploadItemImage: (id: string, formData: FormData) =>
    request<any>(`/api/items/${id}/images`, {
      method: 'POST',
      body: formData,
    }, getGmToken()),

  updateImage: (id: string, data: { visibility?: 'gm' | 'players'; is_primary?: boolean }) =>
    request<any>(`/api/images/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, getGmToken()),

  deleteImage: (id: string) =>
    request<{ success: boolean; deleted: string }>(`/api/images/${id}`, {
      method: 'DELETE',
    }, getGmToken()),

  // Shops
  getShops: () =>
    request<{ shops: Shop[] }>('/api/shops', {}, getGmToken()),

  createShop: (data: { name: string; price_multiplier?: number; buyback_rate?: number; categories?: string[] }) =>
    request<Shop>('/api/shops', {
      method: 'POST',
      body: JSON.stringify(data),
    }, getGmToken()),

  updateShop: (id: string, data: Partial<{ name: string; price_multiplier: number; buyback_rate: number; categories: string[] }>) =>
    request<Shop>(`/api/shops/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, getGmToken()),

  deleteShop: (id: string) =>
    request<{ success: boolean; deleted: string }>(`/api/shops/${id}`, {
      method: 'DELETE',
    }, getGmToken()),

  getShopStock: (shopId: string) =>
    request<{ stock: Array<{ id: string; shop_id: string; item_id: string; quantity: number | null; item: any }> }>(
      `/api/shops/${shopId}/stock`,
      {},
      getGmToken(),
    ),

  setShopStock: (shopId: string, item_id: string, quantity: number | null) =>
    request<ShopStockItem>(`/api/shops/${shopId}/stock`, {
      method: 'POST',
      body: JSON.stringify({ item_id, quantity }),
    }, getGmToken()),

  deleteShopStock: (shopId: string, item_id: string) =>
    request<{ success: boolean; deleted: string }>(`/api/shops/${shopId}/stock/${item_id}`, {
      method: 'DELETE',
    }, getGmToken()),

  // Commerce & Transactions
  purchase: (data: PurchaseInput) =>
    request<{ success: boolean; total_eb: number; character: CharacterSheet }>('/api/purchase', {
      method: 'POST',
      body: JSON.stringify(data),
    }, getGmToken()),

  sell: (data: SellInput) =>
    request<{ success: boolean; total_refund: number; character: CharacterSheet }>('/api/sell', {
      method: 'POST',
      body: JSON.stringify(data),
    }, getGmToken()),

  getTransactions: (character_id?: string) => {
    const qStr = character_id ? `?character_id=${encodeURIComponent(character_id)}` : '';
    return request<{ transactions: Array<Transaction & { character_name?: string; shop_name?: string }> }>(
      `/api/transactions${qStr}`,
      {},
      getGmToken(),
    );
  },

  // Price Categories Settings
  getPriceCategories: () =>
    request<{ categories: PriceCategoryConfig[] }>('/api/settings/price-categories', {}, getGmToken()),

  updatePriceCategories: (categories: PriceCategoryConfig[]) =>
    request<{ success: boolean; categories: PriceCategoryConfig[] }>('/api/settings/price-categories', {
      method: 'PUT',
      body: JSON.stringify({ categories }),
    }, getGmToken()),

  // Character Creation & Submissions (Phase 3b)
  getCreationMethods: () =>
    request<{
      methods: CreationMethodConfig[];
      active_method: string;
      starting_funds: number | null;
    }>('/api/creation-methods'),

  updateCreationMethod: (key: string, data: CreationMethodConfig) =>
    request<CreationMethodConfig>(`/api/creation-methods/${key}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }, getGmToken()),

  setActiveCreationMethod: (active_method: string) =>
    request<{ active_method: string }>('/api/creation-methods-active', {
      method: 'PUT',
      body: JSON.stringify({ active_method }),
    }, getGmToken()),

  getSkillNotes: () =>
    request<{ notes: Record<string, string> }>('/api/skill-notes'),

  updateSkillNote: (key: string, text: string) =>
    request<{ ok: boolean; key: string; text: string; updated_at: number }>(`/api/skill-notes/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    }, getGmToken()),

  uploadCharacterImage: async (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return request<{ image_id: string; image_path: string }>('/api/character-submissions/image', {
      method: 'POST',
      body: formData,
    });
  },

  submitCharacter: (
    character: CharacterDraft,
    source: 'wifi' | 'file' = 'wifi',
    created_with?: { method: string; starting_funds?: number | null },
  ) =>
    request<{
      id: string;
      status: 'pending';
      validation_results: any;
    }>('/api/character-submissions', {
      method: 'POST',
      body: JSON.stringify({ character, source, created_with }),
    }),

  getCharacterSubmissions: () =>
    request<{ submissions: CharacterSubmission[] }>('/api/character-submissions', {}, getGmToken()),

  getCharacterSubmission: (id: string) =>
    request<CharacterSubmission>(`/api/character-submissions/${id}`),

  acceptCharacterSubmission: (id: string) =>
    request<{ ok: boolean; character_id: string }>(`/api/character-submissions/${id}/accept`, {
      method: 'POST',
    }, getGmToken()),

  rejectCharacterSubmission: (id: string, comment: string) =>
    request<{ ok: boolean }>(`/api/character-submissions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }, getGmToken()),

  importCharacterSubmission: (cpgmData: CpgmCharacterFile) =>
    request<CharacterSubmission>('/api/character-submissions/import', {
      method: 'POST',
      body: JSON.stringify(cpgmData),
    }, getGmToken()),

  // Combat API (Phase 4a)
  getCombatActions: () =>
    request<{ actions: any[] }>('/api/combat-actions'),

  getCurrentCombat: (token?: string | null) =>
    request<{ combat: any | null }>('/api/combats/current', {}, token !== undefined ? token : getGmToken()),

  createCombat: (settings?: any) =>
    request<{ combat: any }>('/api/combats', {
      method: 'POST',
      body: JSON.stringify({ settings }),
    }, getGmToken()),

  addParticipant: (combatId: string, participant: { character_id?: string | null; name: string; side: 'ally' | 'enemy'; count?: number }) =>
    request<{ combat: any }>(`/api/combats/${combatId}/participants`, {
      method: 'POST',
      body: JSON.stringify(participant),
    }, getGmToken()),

  updateParticipant: (combatId: string, pid: string, data: any) =>
    request<{ combat: any }>(`/api/combats/${combatId}/participants/${pid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, getGmToken()),

  deleteParticipant: (combatId: string, pid: string) =>
    request<{ combat: any }>(`/api/combats/${combatId}/participants/${pid}`, {
      method: 'DELETE',
    }, getGmToken()),

  setCombatInitiative: (combatId: string, participants: any[]) =>
    request<{ combat: any }>(`/api/combats/${combatId}/initiative`, {
      method: 'POST',
      body: JSON.stringify({ participants }),
    }, getGmToken()),

  updateCombat: (combatId: string, data: { action?: string; settings?: any; deleteMooks?: boolean; board_id?: string | null }) =>
    request<{ combat: any }>(`/api/combats/${combatId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, getGmToken()),

  resolveCombatAction: (combatId: string, data: any) =>
    request<{ result: any }>(`/api/combats/${combatId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, getGmToken()),

  applyCombatAction: (combatId: string, data: any) =>
    request<{ result: any; combat: any }>(`/api/combats/${combatId}/apply`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, getGmToken()),

  undoCombatAction: (combatId: string) =>
    request<{ success: boolean; undoneLogId: string; combat: any }>(`/api/combats/${combatId}/undo`, {
      method: 'POST',
    }, getGmToken()),

  // Board API (Phase 4b)
  getBoards: () =>
    request<{ boards: Board[] }>('/api/boards', {}, getGmToken()),

  getBoard: (boardId: string) =>
    request<{ board: Board }>(
      `/api/boards/${boardId}`,
      {},
      getGmToken(),
    ),

  createBoard: (data: { name: string; background_image_id?: string | null; grid?: any }) =>
    request<{ board: Board }>(
      '/api/boards',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      getGmToken(),
    ),

  updateBoard: (boardId: string, data: { name?: string; background_image_id?: string | null; grid?: any }) =>
    request<{ board: Board }>(
      `/api/boards/${boardId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
      getGmToken(),
    ),

  deleteBoard: (boardId: string) =>
    request<{ success: boolean }>(
      `/api/boards/${boardId}`,
      {
        method: 'DELETE',
      },
      getGmToken(),
    ),

  createBoardObject: (boardId: string, data: any) =>
    request<{ object: BoardObject }>(
      `/api/boards/${boardId}/objects`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      getGmToken(),
    ),

  updateBoardObject: (boardId: string, objectId: string, data: any) =>
    request<{ object: BoardObject }>(
      `/api/boards/${boardId}/objects/${objectId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
      getGmToken(),
    ),

  deleteBoardObject: (boardId: string, objectId: string) =>
    request<{ success: boolean }>(
      `/api/boards/${boardId}/objects/${objectId}`,
      {
        method: 'DELETE',
      },
      getGmToken(),
    ),

  createBoardToken: (boardId: string, data: any) =>
    request<{ token: BoardToken }>(
      `/api/boards/${boardId}/tokens`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      getGmToken(),
    ),

  updateBoardToken: (boardId: string, tokenId: string, data: any) =>
    request<{ token: BoardToken }>(
      `/api/boards/${boardId}/tokens/${tokenId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
      getGmToken(),
    ),

  deleteBoardToken: (boardId: string, tokenId: string) =>
    request<{ success: boolean }>(
      `/api/boards/${boardId}/tokens/${tokenId}`,
      {
        method: 'DELETE',
      },
      getGmToken(),
    ),

  createBoardDrop: (boardId: string, data: any) =>
    request<{ drop: BoardDrop }>(
      `/api/boards/${boardId}/drops`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      getGmToken(),
    ),

  deleteBoardDrop: (boardId: string, dropId: string) =>
    request<{ success: boolean }>(
      `/api/boards/${boardId}/drops/${dropId}`,
      {
        method: 'DELETE',
      },
      getGmToken(),
    ),
};
