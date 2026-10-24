// オフライン閲覧用品目カタログのストレージ管理モジュール (Phase 6j)
// 厳格なルール:
// - 品目カタログのテキスト・数値フィールドのみを保存対象とする。
// - キャラクター、セッション、シナリオ、ユーザー画像、DB ダンプ等は一切保存しない。
// - スキーマバージョン管理を行い、不整合時は安全に初期化する。

export interface OfflineCatalogItem {
  id: string;
  kind: string; // weapon, armor, cyberware, gear, etc.
  name_ja: string;
  name_en?: string;
  price: number;
  category?: string;
  description?: string;
  stats?: Record<string, string | number | boolean>;
}

export interface OfflineCatalogSnapshot {
  schemaVersion: 1;
  savedAt: string; // ISO 8601
  itemCount: number;
  items: OfflineCatalogItem[];
}

const STORAGE_KEY = 'cpgm_offline_catalog_snapshot_v1';

/**
 * API から取得した生アイテム一覧をサニタイズし、
 * オフライン閲覧に必要なテキスト・数値フィールドのみを抽出する。
 */
export function sanitizeCatalogItems(rawItems: any[]): OfflineCatalogItem[] {
  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .filter((item) => item && typeof item === 'object' && item.id)
    .map((item) => {
      // 性能情報（stats）のサニタイズ（テキスト・数値・真偽値のみ）
      const sanitizedStats: Record<string, string | number | boolean> = {};
      if (item.stats && typeof item.stats === 'object') {
        for (const [k, v] of Object.entries(item.stats)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            sanitizedStats[k] = v;
          }
        }
      }

      // 武器の固有プロパティ（damage, rof, mag, weapon_type 等）
      if (item.weapon) {
        if (item.weapon.damage) sanitizedStats.damage = String(item.weapon.damage);
        if (item.weapon.rof) sanitizedStats.rof = Number(item.weapon.rof);
        if (item.weapon.mag) sanitizedStats.mag = Number(item.weapon.mag);
        if (item.weapon.type) sanitizedStats.weapon_type = String(item.weapon.type);
      }
      // 防具の固有プロパティ（sp, penalty 等）
      if (item.armor) {
        if (item.armor.sp != null) sanitizedStats.sp = Number(item.armor.sp);
        if (item.armor.penalty != null) sanitizedStats.penalty = Number(item.armor.penalty);
      }
      // サイバーウェアの固有プロパティ（install, humanity_loss 等）
      if (item.cyberware) {
        if (item.cyberware.install) sanitizedStats.install = String(item.cyberware.install);
        if (item.cyberware.humanity_loss_static != null) {
          sanitizedStats.humanity_loss = Number(item.cyberware.humanity_loss_static);
        }
      }

      return {
        id: String(item.id),
        kind: String(item.kind || 'gear'),
        name_ja: String(item.name_ja || item.name || ''),
        name_en: item.name_en ? String(item.name_en) : undefined,
        price: typeof item.price === 'number' ? item.price : Number(item.price) || 0,
        category: item.category ? String(item.category) : undefined,
        description: item.description ? String(item.description) : undefined,
        stats: Object.keys(sanitizedStats).length > 0 ? sanitizedStats : undefined,
      };
    });
}

/**
 * オンライン時にカタログスナップショットを保存する。
 * 保存に失敗しても例外をスローせず false を返し、オンライン画面の動作を壊さない。
 */
export function saveCatalogSnapshot(rawItems: any[]): boolean {
  try {
    const items = sanitizeCatalogItems(rawItems);
    const snapshot: OfflineCatalogSnapshot = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      itemCount: items.length,
      items,
    };
    const serialized = JSON.stringify(snapshot);
    localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (err) {
    console.warn('[OfflineCatalog] Failed to save snapshot:', err);
    return false;
  }
}

/**
 * 保存されたカタログスナップショットを読み込む。
 * スキーマ破損時は自動的に破棄して null を返す。
 */
export function loadCatalogSnapshot(): OfflineCatalogSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.schemaVersion === 1 && Array.isArray(data.items)) {
      return data as OfflineCatalogSnapshot;
    }
    // 古いまたは無効なスキーマは安全に破棄
    localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch (err) {
    console.warn('[OfflineCatalog] Failed to load snapshot, clearing invalid entry:', err);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

/**
 * カタログスナップショットを安全に削除・破棄する。
 */
export function clearCatalogSnapshot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[OfflineCatalog] Failed to clear snapshot:', err);
  }
}
