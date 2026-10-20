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
};
