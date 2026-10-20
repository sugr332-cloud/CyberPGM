import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CharacterSheet,
  Shop,
  PriceCategoryConfig,
  ItemPatchInput,
  Transaction,
  InventoryEntry,
} from '@cyberpgm/shared';
import { api } from '../api.js';

interface ShopViewProps {
  characters: CharacterSheet[];
  onRefreshCharacters?: () => void;
}

interface CartItem {
  item: any;
  qty: number;
  unit_price_override?: number;
}

export const ShopView: React.FC<ShopViewProps> = ({ characters, onRefreshCharacters }) => {
  // Shops & Selected Shop
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
  const [shopStockMap, setShopStockMap] = useState<Record<string, number | null>>({});

  // Catalog Filters & Items
  const [items, setItems] = useState<any[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [category, setCategory] = useState<string>('');
  const [query, setQuery] = useState('');
  const [priceCategory, setPriceCategory] = useState<string>('');
  const [weaponType, setWeaponType] = useState<string>('');
  const [concealable, setConcealable] = useState<string>('');
  const [quality, setQuality] = useState<string>('');
  const [verifyStatus, setVerifyStatus] = useState<string>('');
  const [sort, setSort] = useState<string>('name_asc');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // Selected Item & Detail View
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [itemDetailLoading, setItemDetailLoading] = useState(false);
  const [isDescOpen, setIsDescOpen] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');

  // Cart & Commerce
  const [cart, setCart] = useState<CartItem[]>([]);
  const [buyerPcId, setBuyerPcId] = useState<string>(characters[0]?.id || '');
  const [cwInstallOpts, setCwInstallOpts] = useState<Record<string, { install: boolean; humanityLoss: number }>>({});
  const [commerceMsg, setCommerceMsg] = useState<{ text: string; error?: boolean } | null>(null);

  // Modals
  const [showShopModal, setShowShopModal] = useState(false);
  const [editingShop, setEditingShop] = useState<Shop | null>(null);
  const [shopFormName, setShopFormName] = useState('');
  const [shopFormPriceMult, setShopFormPriceMult] = useState('1.0');
  const [shopFormBuyback, setShopFormBuyback] = useState('0.5');

  const [showPriceConfigModal, setShowPriceConfigModal] = useState(false);
  const [priceConfigs, setPriceConfigs] = useState<PriceCategoryConfig[]>([]);

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyList, setHistoryList] = useState<Array<Transaction & { character_name?: string; shop_name?: string }>>([]);

  const [showSellModal, setShowSellModal] = useState(false);
  const [sellPcId, setSellPcId] = useState<string>(characters[0]?.id || '');
  const [sellQtyMap, setSellQtyMap] = useState<Record<string, number>>({});

  // Image Upload & Crop Modal
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageOrigin, setImageOrigin] = useState<'book_scan' | 'user'>('user');
  const [imageVisibility, setImageVisibility] = useState<'gm' | 'players'>('players');
  const [cropUploading, setCropUploading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load Shops
  const loadShops = useCallback(async () => {
    try {
      const res = await api.getShops();
      setShops(res.shops);
    } catch (err) {
      console.error('Failed to load shops:', err);
    }
  }, []);

  // Load Stock for selected shop
  const loadStock = useCallback(async (shopId: string) => {
    try {
      const res = await api.getShopStock(shopId);
      const map: Record<string, number | null> = {};
      for (const row of res.stock) {
        map[row.item_id] = row.quantity;
      }
      setShopStockMap(map);
    } catch (err) {
      console.error('Failed to load shop stock:', err);
    }
  }, []);

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  useEffect(() => {
    if (selectedShopId) {
      loadStock(selectedShopId);
    } else {
      setShopStockMap({});
    }
  }, [selectedShopId, loadStock]);

  // Load Catalog Items
  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean | undefined> = {
        category: category || undefined,
        q: query || undefined,
        price_category: priceCategory || undefined,
        weapon_type: weaponType || undefined,
        concealable: concealable || undefined,
        quality: quality || undefined,
        verify_status: verifyStatus || undefined,
        sort: sort || undefined,
        limit: 200,
      };

      const res = await api.getItems(params);
      let list = res.items;

      // If a shop is selected, only show items in shop stock
      if (selectedShopId) {
        list = list.filter((item) => item.id in shopStockMap);
      }

      setItems(list);
      setTotalItems(res.total);
      setCategoryCounts(res.category_counts || {});
    } catch (err) {
      console.error('Failed to load items:', err);
    } finally {
      setLoading(false);
    }
  }, [
    category,
    query,
    priceCategory,
    weaponType,
    concealable,
    quality,
    verifyStatus,
    sort,
    selectedShopId,
    shopStockMap,
  ]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Select Item Detail
  const handleSelectItem = async (itemId: string) => {
    setItemDetailLoading(true);
    try {
      const detail = await api.getItem(itemId);
      setSelectedItem(detail);
      setSummaryDraft(detail.summary_ja || '');
      setEditingSummary(false);
      setIsDescOpen(false);
    } catch (err) {
      console.error('Failed to load item detail:', err);
    } finally {
      setItemDetailLoading(false);
    }
  };

  // Active Shop details
  const currentShop = shops.find((s) => s.id === selectedShopId) || null;
  const priceMultiplier = currentShop ? currentShop.price_multiplier : 1.0;
  const buybackRate = currentShop ? currentShop.buyback_rate : 0.5;

  const calculateItemPrice = (item: any): number => {
    const base = item.price_eb ?? 0;
    return Math.floor(base * priceMultiplier);
  };

  // Add to Cart
  const handleAddToCart = (item: any) => {
    const existing = cart.find((c) => c.item.id === item.id);
    if (existing) {
      setCart(cart.map((c) => (c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c)));
    } else {
      const price = calculateItemPrice(item);
      setCart([...cart, { item, qty: 1, unit_price_override: price }]);
      if (item.kind === 'cyberware') {
        setCwInstallOpts((prev) => ({
          ...prev,
          [item.id]: { install: false, humanityLoss: item.cyberware?.humanity_loss_static ?? 2 },
        }));
      }
    }
  };

  // Remove from Cart
  const handleRemoveFromCart = (itemId: string) => {
    setCart(cart.filter((c) => c.item.id !== itemId));
  };

  // Calculate Cart Total
  const cartTotal = cart.reduce((sum, c) => {
    const p = c.unit_price_override !== undefined ? c.unit_price_override : calculateItemPrice(c.item);
    return sum + p * c.qty;
  }, 0);

  // Buyer PC
  const buyerPc = characters.find((c) => c.id === buyerPcId) || characters[0];
  const buyerEb = buyerPc ? buyerPc.eb : 0;
  const isEbShort = buyerEb < cartTotal;

  // Execute Purchase
  const handlePurchase = async () => {
    if (!buyerPc || cart.length === 0 || isEbShort) return;
    try {
      const lines = cart.map((c) => ({
        item_id: c.item.id,
        qty: c.qty,
        unit_price_override: c.unit_price_override,
      }));

      const install_cyberware = Object.entries(cwInstallOpts)
        .filter(([_, opt]) => opt.install)
        .map(([itemId, opt]) => ({
          item_id: itemId,
          humanity_loss: opt.humanityLoss,
        }));

      await api.purchase({
        character_id: buyerPc.id,
        shop_id: selectedShopId,
        lines,
        install_cyberware: install_cyberware.length > 0 ? install_cyberware : undefined,
      });

      setCommerceMsg({ text: `購入が完了しました: −${cartTotal.toLocaleString()} eb` });
      setCart([]);
      if (selectedShopId) {
        await loadStock(selectedShopId);
      }
      onRefreshCharacters?.();
      setTimeout(() => setCommerceMsg(null), 4000);
    } catch (err: any) {
      setCommerceMsg({ text: err.message || '購入に失敗しました', error: true });
    }
  };

  // Manage Shop Stock
  const handleSetStock = async (itemId: string, quantity: number | null) => {
    if (!selectedShopId) return;
    try {
      await api.setShopStock(selectedShopId, itemId, quantity);
      await loadStock(selectedShopId);
    } catch (err) {
      console.error('Failed to set stock:', err);
    }
  };

  const handleDeleteStock = async (itemId: string) => {
    if (!selectedShopId) return;
    try {
      await api.deleteShopStock(selectedShopId, itemId);
      await loadStock(selectedShopId);
    } catch (err) {
      console.error('Failed to delete stock:', err);
    }
  };

  // Save Shop Create/Edit
  const handleSaveShop = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopFormName.trim()) return;
    try {
      const mult = parseFloat(shopFormPriceMult) || 1.0;
      const buyback = parseFloat(shopFormBuyback) || 0.5;

      if (editingShop) {
        await api.updateShop(editingShop.id, {
          name: shopFormName.trim(),
          price_multiplier: mult,
          buyback_rate: buyback,
        });
      } else {
        const created = await api.createShop({
          name: shopFormName.trim(),
          price_multiplier: mult,
          buyback_rate: buyback,
        });
        setSelectedShopId(created.id);
      }
      setShowShopModal(false);
      await loadShops();
    } catch (err) {
      console.error('Failed to save shop:', err);
    }
  };

  // Delete Shop
  const handleDeleteShop = async (shopId: string) => {
    if (!confirm('この店舗を削除してもよろしいですか？')) return;
    try {
      await api.deleteShop(shopId);
      if (selectedShopId === shopId) setSelectedShopId(null);
      await loadShops();
    } catch (err) {
      console.error('Failed to delete shop:', err);
    }
  };

  // Price Category Config Save
  const handleOpenPriceConfigs = async () => {
    try {
      const res = await api.getPriceCategories();
      setPriceConfigs(res.categories);
      setShowPriceConfigModal(true);
    } catch (err) {
      console.error('Failed to load price categories:', err);
    }
  };

  const handleSavePriceConfigs = async () => {
    try {
      await api.updatePriceCategories(priceConfigs);
      setShowPriceConfigModal(false);
      loadItems();
    } catch (err) {
      console.error('Failed to save price categories:', err);
    }
  };

  // Open Transaction History
  const handleOpenHistory = async () => {
    try {
      const res = await api.getTransactions();
      setHistoryList(res.transactions);
      setShowHistoryModal(true);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    }
  };

  // Sell Items
  const sellPc = characters.find((c) => c.id === sellPcId) || characters[0];
  const handleExecuteSell = async () => {
    if (!sellPc) return;
    const entries = Object.entries(sellQtyMap)
      .filter(([_, qty]) => qty > 0)
      .map(([entry_id, qty]) => ({ entry_id, qty }));

    if (entries.length === 0) return;

    try {
      const res = await api.sell({
        character_id: sellPc.id,
        shop_id: selectedShopId,
        entries,
      });
      setCommerceMsg({ text: `売却が完了しました: +${res.total_refund.toLocaleString()} eb` });
      setShowSellModal(false);
      setSellQtyMap({});
      onRefreshCharacters?.();
      setTimeout(() => setCommerceMsg(null), 4000);
    } catch (err: any) {
      alert(err.message || '売却処理に失敗しました');
    }
  };

  // Image Upload Crop Handling
  const handleImageFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const url = URL.createObjectURL(file);

    // Draw to canvas for square crop preview
    const img = new Image();
    img.src = url;
    img.onload = () => {
      if (canvasRef.current) {
        const cvs = canvasRef.current;
        const ctx = cvs.getContext('2d');
        if (!ctx) return;
        const size = Math.min(img.width, img.height);
        const startX = (img.width - size) / 2;
        const startY = (img.height - size) / 2;
        cvs.width = 400;
        cvs.height = 400;
        ctx.clearRect(0, 0, 400, 400);
        ctx.drawImage(img, startX, startY, size, size, 0, 0, 400, 400);
      }
    };
  };

  const handleUploadCroppedImage = async () => {
    if (!selectedItem || !canvasRef.current) return;
    setCropUploading(true);
    try {
      const cvs = canvasRef.current;
      cvs.toBlob(async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append('image', blob, 'cropped.png');
        formData.append('origin', imageOrigin);
        formData.append('visibility', imageVisibility);

        await api.uploadItemImage(selectedItem.id, formData);
        await handleSelectItem(selectedItem.id);
        setShowImageModal(false);
        setImageFile(null);
        setCropUploading(false);
      }, 'image/png');
    } catch (err) {
      console.error('Failed to upload image:', err);
      setCropUploading(false);
    }
  };

  // Categories list
  const categoryKeys = [
    { key: '', label: 'すべて' },
    { key: 'weapon', label: '武器' },
    { key: 'armor', label: '防具' },
    { key: 'cyberware', label: 'サイバーウェア' },
    { key: 'cyberdeck', label: 'サイバーデッキ' },
    { key: 'gear', label: 'ギア' },
    { key: 'clothing', label: '衣服' },
    { key: 'ammo', label: '弾薬' },
    { key: 'mod', label: '改造パーツ' },
    { key: 'program', label: 'プログラム' },
    { key: 'vehicle', label: '乗り物' },
    { key: 'drug', label: 'ドラッグ' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '80vh' }}>
      {/* Top Bar: Shop Selector & Actions */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '12px 16px',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text)' }}>店舗:</div>
          <select
            data-testid="shop-selector"
            value={selectedShopId || ''}
            onChange={(e) => setSelectedShopId(e.target.value || null)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface-elevated)',
              color: 'var(--color-text)',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            <option value="">全カタログ（標準価格）</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（倍率 {s.price_multiplier}x / 買取 {Math.round(s.buyback_rate * 100)}%）
              </option>
            ))}
          </select>

          {currentShop && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => {
                  setEditingShop(currentShop);
                  setShopFormName(currentShop.name);
                  setShopFormPriceMult(String(currentShop.price_multiplier));
                  setShopFormBuyback(String(currentShop.buyback_rate));
                  setShowShopModal(true);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text-muted)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                編集
              </button>
              <button
                onClick={() => handleDeleteShop(currentShop.id)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-danger)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-danger)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                削除
              </button>
            </div>
          )}

          <button
            onClick={() => {
              setEditingShop(null);
              setShopFormName('');
              setShopFormPriceMult('1.0');
              setShopFormBuyback('0.5');
              setShowShopModal(true);
            }}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px dashed var(--color-primary)',
              backgroundColor: 'transparent',
              color: 'var(--color-primary)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ＋ 新しい店を作る
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowSellModal(true)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface-elevated)',
              color: 'var(--color-text)',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            💰 PC から売却
          </button>
          <button
            onClick={handleOpenHistory}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface-elevated)',
              color: 'var(--color-text)',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            📜 取引履歴
          </button>
          <button
            onClick={handleOpenPriceConfigs}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface-elevated)',
              color: 'var(--color-text)',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            ⚙️ 価格帯設定
          </button>
        </div>
      </div>

      {/* Commerce Notice */}
      {commerceMsg && (
        <div
          data-testid="commerce-notice"
          style={{
            padding: '10px 16px',
            borderRadius: '6px',
            backgroundColor: commerceMsg.error ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
            border: `1px solid ${commerceMsg.error ? 'var(--color-danger)' : 'var(--color-success)'}`,
            color: commerceMsg.error ? 'var(--color-danger)' : 'var(--color-success)',
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          {commerceMsg.text}
        </div>
      )}

      {/* Main 3 Columns Layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '240px 1fr 340px',
          gap: '16px',
          alignItems: 'start',
        }}
      >
        {/* Left Column: Categories & Detailed Filters */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          {/* Search Bar */}
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
              キーワード検索
            </label>
            <input
              type="text"
              data-testid="item-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="品名 (日/英)..."
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-surface-elevated)',
                color: 'var(--color-text)',
                fontSize: '0.85rem',
                marginTop: '4px',
              }}
            />
          </div>

          {/* Categories List with counts */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: '6px' }}>
              カテゴリ
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {categoryKeys.map((c) => {
                const count = c.key === '' ? totalItems : categoryCounts[c.key] || 0;
                const isSelected = category === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      border: 'none',
                      backgroundColor: isSelected ? 'var(--color-primary)' : 'transparent',
                      color: isSelected ? '#fff' : 'var(--color-text)',
                      fontSize: '0.85rem',
                      fontWeight: isSelected ? 700 : 400,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span>{c.label}</span>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        opacity: 0.8,
                        backgroundColor: isSelected ? 'rgba(0,0,0,0.2)' : 'var(--color-surface-elevated)',
                        padding: '1px 6px',
                        borderRadius: '10px',
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detailed Filters */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
              絞り込み
            </div>

            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>価格カテゴリ</label>
              <select
                value={priceCategory}
                onChange={(e) => setPriceCategory(e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text)',
                  fontSize: '0.8rem',
                }}
              >
                <option value="">すべて</option>
                <option value="cheap">〜10 eb</option>
                <option value="everyday">〜20 eb</option>
                <option value="costly">〜50 eb</option>
                <option value="premium">〜100 eb</option>
                <option value="expensive">〜500 eb</option>
                <option value="very_expensive">〜1,000 eb</option>
                <option value="luxury">〜5,000 eb</option>
                <option value="super_luxury">〜10,000 eb 以上</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>武器種別</label>
              <select
                value={weaponType}
                onChange={(e) => setWeaponType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text)',
                  fontSize: '0.8rem',
                }}
              >
                <option value="">すべて</option>
                <option value="pistol">ピストル</option>
                <option value="smg">サブマシンガン</option>
                <option value="shotgun">ショットガン</option>
                <option value="assault_rifle">アサルトライフル</option>
                <option value="sniper_rifle">スナイパーライフル</option>
                <option value="heavy_weapon">重火器</option>
                <option value="melee_weapon">近接武器</option>
                <option value="bow_crossbow">弓・クロスボウ</option>
                <option value="exotic">エキゾチック</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>隠匿可否</label>
              <select
                value={concealable}
                onChange={(e) => setConcealable(e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text)',
                  fontSize: '0.8rem',
                }}
              >
                <option value="">すべて</option>
                <option value="true">隠匿可</option>
                <option value="false">隠匿不可</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>品質</label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text)',
                  fontSize: '0.8rem',
                }}
              >
                <option value="">すべて</option>
                <option value="standard">並品 (Standard)</option>
                <option value="excellent">優良品 (Excellent)</option>
                <option value="poor">粗悪品 (Poor)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>確認状態</label>
              <select
                value={verifyStatus}
                onChange={(e) => setVerifyStatus(e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text)',
                  fontSize: '0.8rem',
                }}
              >
                <option value="">すべて</option>
                <option value="official_verified">確認済み</option>
                <option value="unofficial">非公式</option>
                <option value="unverified">未確認</option>
              </select>
            </div>
          </div>

          {/* Sort & View Mode */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
              並び替え & 表示
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 6px',
                borderRadius: '4px',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-surface-elevated)',
                color: 'var(--color-text)',
                fontSize: '0.8rem',
              }}
            >
              <option value="name_asc">名前 (昇順)</option>
              <option value="name_desc">名前 (降順)</option>
              <option value="price_asc">価格 (安い順)</option>
              <option value="price_desc">価格 (高い順)</option>
              <option value="damage_desc">ダメージ (高い順)</option>
              <option value="sp_desc">SP (高い順)</option>
            </select>

            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setViewMode('cards')}
                style={{
                  flex: 1,
                  padding: '4px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: viewMode === 'cards' ? 'var(--color-surface-elevated)' : 'transparent',
                  color: viewMode === 'cards' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🂠 カード
              </button>
              <button
                onClick={() => setViewMode('table')}
                style={{
                  flex: 1,
                  padding: '4px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: viewMode === 'table' ? 'var(--color-surface-elevated)' : 'transparent',
                  color: viewMode === 'table' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ☷ 一覧表
              </button>
            </div>
          </div>
        </div>

        {/* Center Column: Catalog Cards / Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              {loading ? '読み込み中...' : `検索結果: ${items.length} 件`}
            </span>
          </div>

          {items.length === 0 && !loading && (
            <div
              style={{
                padding: '48px 16px',
                textAlign: 'center',
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                color: 'var(--color-text-muted)',
              }}
            >
              該当する品目が見つかりませんでした。
            </div>
          )}

          {viewMode === 'cards' ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '12px',
              }}
            >
              {items.map((item) => {
                const finalPrice = calculateItemPrice(item);
                const stockQty = selectedShopId ? shopStockMap[item.id] : null;

                return (
                  <div
                    key={item.id}
                    data-testid={`item-card-${item.id}`}
                    onClick={() => handleSelectItem(item.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      backgroundColor: 'var(--color-surface)',
                      border: `1px solid ${selectedItem?.id === item.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      borderRadius: '8px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    {/* Item Image / Placeholder */}
                    <div
                      style={{
                        height: '110px',
                        backgroundColor: 'var(--color-surface-elevated)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        position: 'relative',
                      }}
                    >
                      {item.image_path ? (
                        <img
                          src={`/images/${item.image_path}`}
                          alt={item.name_ja}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <span style={{ fontSize: '2rem', opacity: 0.3 }}>📦</span>
                      )}

                      {/* Verify Status Badge */}
                      <span
                        style={{
                          position: 'absolute',
                          top: '6px',
                          right: '6px',
                          fontSize: '0.65rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor:
                            item.verify_status === 'official_verified'
                              ? 'rgba(34, 197, 94, 0.85)'
                              : item.verify_status === 'unofficial'
                              ? 'rgba(234, 179, 8, 0.85)'
                              : 'rgba(100, 116, 139, 0.85)',
                          color: '#fff',
                          fontWeight: 600,
                        }}
                      >
                        {item.verify_status === 'official_verified'
                          ? '確認済'
                          : item.verify_status === 'unofficial'
                          ? '非公式'
                          : '未確認'}
                      </span>
                    </div>

                    {/* Card Content */}
                    <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text)' }}>
                          {item.name_ja_override || item.name_ja}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {item.name_en}
                        </div>
                      </div>

                      {/* Key Stats */}
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        {item.kind === 'weapon' && (
                          <span>
                            {item.weapon_type || '武器'} · {item.damage || '1d6'} · ROF {item.rof ?? 1}
                          </span>
                        )}
                        {item.kind === 'armor' && <span>SP {item.sp ?? 0}</span>}
                        {item.kind === 'cyberware' && (
                          <span>HL {item.humanity_loss_static ?? 2} ({item.humanity_loss_dice || '1d6'})</span>
                        )}
                        {!['weapon', 'armor', 'cyberware'].includes(item.kind) && (
                          <span>{item.summary_ja || item.kind}</span>
                        )}
                      </div>

                      {/* Price & Action */}
                      <div
                        style={{
                          marginTop: 'auto',
                          paddingTop: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderTop: '1px solid var(--color-border-light)',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '1rem',
                              fontWeight: 700,
                              color: 'var(--color-warning)',
                            }}
                          >
                            {finalPrice.toLocaleString()} eb
                          </div>
                          {selectedShopId && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                              在庫: {stockQty === null ? '無制限' : `${stockQty} 個`}
                            </div>
                          )}
                        </div>

                        <button
                          data-testid={`add-to-cart-${item.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddToCart(item);
                          }}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: 'var(--color-primary)',
                            color: '#fff',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          ＋ カート
                        </button>
                      </div>

                      {/* Stock Button (when in shop mode) */}
                      {selectedShopId && (
                        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetStock(item.id, null);
                            }}
                            style={{
                              flex: 1,
                              padding: '2px',
                              borderRadius: '4px',
                              border: '1px solid var(--color-border)',
                              backgroundColor: stockQty === null ? 'var(--color-surface-elevated)' : 'transparent',
                              fontSize: '0.65rem',
                              cursor: 'pointer',
                            }}
                          >
                            無制限
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const cur = stockQty || 0;
                              handleSetStock(item.id, cur + 5);
                            }}
                            style={{
                              flex: 1,
                              padding: '2px',
                              borderRadius: '4px',
                              border: '1px solid var(--color-border)',
                              backgroundColor: 'transparent',
                              fontSize: '0.65rem',
                              cursor: 'pointer',
                            }}
                          >
                            +5個
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteStock(item.id);
                            }}
                            style={{
                              padding: '2px 4px',
                              borderRadius: '4px',
                              border: '1px solid var(--color-danger)',
                              backgroundColor: 'transparent',
                              color: 'var(--color-danger)',
                              fontSize: '0.65rem',
                              cursor: 'pointer',
                            }}
                          >
                            外す
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Table View */
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                overflowX: 'auto',
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px' }}>品名</th>
                    <th style={{ padding: '8px' }}>区分</th>
                    <th style={{ padding: '8px' }}>主要性能</th>
                    <th style={{ padding: '8px' }}>価格</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => handleSelectItem(item.id)}
                      style={{
                        borderBottom: '1px solid var(--color-border-light)',
                        cursor: 'pointer',
                        backgroundColor: selectedItem?.id === item.id ? 'var(--color-surface-elevated)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 600 }}>{item.name_ja_override || item.name_ja}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{item.name_en}</div>
                      </td>
                      <td style={{ padding: '8px', color: 'var(--color-text-muted)' }}>{item.kind}</td>
                      <td style={{ padding: '8px', color: 'var(--color-text-muted)' }}>
                        {item.kind === 'weapon' && `${item.damage || ''} / ROF ${item.rof ?? 1}`}
                        {item.kind === 'armor' && `SP ${item.sp ?? 0}`}
                        {item.kind === 'cyberware' && `HL ${item.humanity_loss_static ?? 2}`}
                      </td>
                      <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {calculateItemPrice(item).toLocaleString()} eb
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddToCart(item);
                          }}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: 'var(--color-primary)',
                            color: '#fff',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                          }}
                        >
                          カート
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Item Detail & Cart */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Item Detail Panel */}
          <div
            data-testid="item-detail-panel"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
              品目詳細
            </div>

            {itemDetailLoading ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '24px 0' }}>
                詳細を読み込み中...
              </div>
            ) : selectedItem ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Header */}
                <div>
                  <h3 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--color-text)' }}>
                    {selectedItem.name_ja_override || selectedItem.name_ja}
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    {selectedItem.name_en}
                  </div>
                </div>

                {/* Image & Image Upload Trigger */}
                <div
                  style={{
                    position: 'relative',
                    height: '140px',
                    backgroundColor: 'var(--color-surface-elevated)',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selectedItem.image_path ? (
                    <img
                      src={`/images/${selectedItem.image_path}`}
                      alt={selectedItem.name_ja}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: '2.5rem', opacity: 0.3 }}>📦</span>
                  )}

                  <button
                    onClick={() => {
                      setShowImageModal(true);
                      setImageFile(null);
                    }}
                    style={{
                      position: 'absolute',
                      bottom: '6px',
                      right: '6px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      color: '#fff',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    📷 画像登録・切抜
                  </button>
                </div>

                {/* Sub-table specs */}
                <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>基本価格:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {selectedItem.price_eb?.toLocaleString()} eb
                    </span>
                  </div>

                  {selectedItem.weapon && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>武器種別:</span>
                        <span>{selectedItem.weapon.type}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>ダメージ / ROF:</span>
                        <span>{selectedItem.weapon.damage} / ROF {selectedItem.weapon.rof}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>装弾数 / 弾薬:</span>
                        <span>{selectedItem.weapon.ammo_capacity}発 ({selectedItem.weapon.ammo_type})</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>隠匿 / 両手:</span>
                        <span>
                          {selectedItem.weapon.concealable ? '隠匿可' : '不可'} · {selectedItem.weapon.hands}手
                        </span>
                      </div>
                    </>
                  )}

                  {selectedItem.armor && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>SP / 部位:</span>
                        <span>SP {selectedItem.armor.sp} ({selectedItem.armor.location})</span>
                      </div>
                    </>
                  )}

                  {selectedItem.cyberware && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>人間性減少:</span>
                        <span>
                          {selectedItem.cyberware.humanity_loss_static} ({selectedItem.cyberware.humanity_loss_dice})
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>部位 / スロット:</span>
                        <span>{selectedItem.cyberware.installation} / {selectedItem.cyberware.slots}枠</span>
                      </div>
                    </>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>出典:</span>
                    <span>
                      {selectedItem.source_page_ja
                        ? `日 p.${selectedItem.source_page_ja}`
                        : selectedItem.source_page_en
                        ? `英 p.${selectedItem.source_page_en}`
                        : 'ルールブック'}
                    </span>
                  </div>
                </div>

                {/* GM Summary Edit */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
                      GM 要約
                    </span>
                    {!editingSummary ? (
                      <button
                        onClick={() => setEditingSummary(true)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-primary)',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                        }}
                      >
                        編集
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          const patch: ItemPatchInput = { summary_ja: summaryDraft };
                          await api.updateItem(selectedItem.id, patch);
                          await handleSelectItem(selectedItem.id);
                          setEditingSummary(false);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-success)',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        保存
                      </button>
                    )}
                  </div>
                  {editingSummary ? (
                    <textarea
                      value={summaryDraft}
                      onChange={(e) => setSummaryDraft(e.target.value)}
                      rows={2}
                      style={{
                        width: '100%',
                        padding: '6px',
                        fontSize: '0.8rem',
                        borderRadius: '4px',
                        border: '1px solid var(--color-border)',
                        backgroundColor: 'var(--color-surface-elevated)',
                        color: 'var(--color-text)',
                        marginTop: '4px',
                      }}
                    />
                  ) : (
                    <p style={{ fontSize: '0.8rem', margin: '4px 0 0 0', color: 'var(--color-text)' }}>
                      {selectedItem.summary_ja || '要約はありません。'}
                    </p>
                  )}
                </div>

                {/* Description Accordion (English) */}
                {selectedItem.description_en && (
                  <div style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: '6px' }}>
                    <button
                      onClick={() => setIsDescOpen(!isDescOpen)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-text-muted)',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        padding: '4px 0',
                      }}
                    >
                      <span>英語の公式解説文</span>
                      <span>{isDescOpen ? '▲' : '▼'}</span>
                    </button>
                    {isDescOpen && (
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--color-text-muted)',
                          lineHeight: 1.4,
                          marginTop: '4px',
                          maxHeight: '150px',
                          overflowY: 'auto',
                          padding: '6px',
                          backgroundColor: 'var(--color-surface-elevated)',
                          borderRadius: '4px',
                        }}
                      >
                        {selectedItem.description_en}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '24px 0' }}>
                一覧から品目を選択すると詳細が表示されます。
              </div>
            )}
          </div>

          {/* Cart & Purchase Panel */}
          <div
            data-testid="shop-cart-panel"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>🛒 カート ({cart.length})</span>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  空にする
                </button>
              )}
            </div>

            {/* Cart Items List */}
            {cart.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {cart.map((c) => {
                  const effectivePrice =
                    c.unit_price_override !== undefined ? c.unit_price_override : calculateItemPrice(c.item);
                  const isCyber = c.item.kind === 'cyberware';
                  const cwOpt = cwInstallOpts[c.item.id] || { install: false, humanityLoss: 2 };

                  return (
                    <div
                      key={c.item.id}
                      style={{
                        padding: '8px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--color-surface-elevated)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                            {c.item.name_ja_override || c.item.name_ja}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            単価: {effectivePrice.toLocaleString()} eb
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveFromCart(c.item.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--color-danger)',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Manual Price Override & Quantity */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>上書き:</span>
                          <input
                            type="number"
                            value={c.unit_price_override ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                              setCart(
                                cart.map((ci) =>
                                  ci.item.id === c.item.id ? { ...ci, unit_price_override: val } : ci,
                                ),
                              );
                            }}
                            placeholder={String(calculateItemPrice(c.item))}
                            style={{
                              width: '70px',
                              padding: '2px 4px',
                              fontSize: '0.75rem',
                              borderRadius: '4px',
                              border: '1px solid var(--color-border)',
                              backgroundColor: 'var(--color-surface)',
                              color: 'var(--color-text)',
                            }}
                          />
                          <span style={{ fontSize: '0.7rem' }}>eb</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            onClick={() => {
                              if (c.qty > 1) {
                                setCart(
                                  cart.map((ci) =>
                                    ci.item.id === c.item.id ? { ...ci, qty: ci.qty - 1 } : ci,
                                  ),
                                );
                              }
                            }}
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--color-border)',
                              backgroundColor: 'transparent',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            -
                          </button>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{c.qty}</span>
                          <button
                            onClick={() => {
                              setCart(
                                cart.map((ci) =>
                                  ci.item.id === c.item.id ? { ...ci, qty: ci.qty + 1 } : ci,
                                ),
                              );
                            }}
                            style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--color-border)',
                              backgroundColor: 'transparent',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Cyberware Install Option */}
                      {isCyber && (
                        <div
                          style={{
                            borderTop: '1px dashed var(--color-border-light)',
                            paddingTop: '6px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                          }}
                        >
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                            <input
                              type="checkbox"
                              checked={cwOpt.install}
                              onChange={(e) => {
                                setCwInstallOpts((prev) => ({
                                  ...prev,
                                  [c.item.id]: { ...cwOpt, install: e.target.checked },
                                }));
                              }}
                            />
                            即時取り付ける（人間性低下）
                          </label>

                          {cwOpt.install && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '18px' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>HL:</span>
                              <input
                                type="number"
                                value={cwOpt.humanityLoss}
                                onChange={(e) => {
                                  const hl = parseInt(e.target.value, 10) || 0;
                                  setCwInstallOpts((prev) => ({
                                    ...prev,
                                    [c.item.id]: { ...cwOpt, humanityLoss: hl },
                                  }));
                                }}
                                style={{
                                  width: '45px',
                                  padding: '2px 4px',
                                  fontSize: '0.75rem',
                                  borderRadius: '4px',
                                  border: '1px solid var(--color-border)',
                                  backgroundColor: 'var(--color-surface)',
                                  color: 'var(--color-text)',
                                }}
                              />
                              <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                                (元: {c.item.cyberware?.humanity_loss_static ?? 2})
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '16px 0' }}>
                カートは空です。
              </div>
            )}

            {/* Cart Summary & Buyer */}
            <div
              style={{
                borderTop: '1px solid var(--color-border)',
                paddingTop: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>合計金額:</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: 'var(--color-warning)',
                  }}
                >
                  {cartTotal.toLocaleString()} eb
                </span>
              </div>

              {/* Select Buyer PC */}
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>購入する PC:</label>
                <select
                  data-testid="purchase-buyer-select"
                  value={buyerPcId}
                  onChange={(e) => setBuyerPcId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    color: 'var(--color-text)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    marginTop: '4px',
                  }}
                >
                  {characters.map((pc) => (
                    <option key={pc.id} value={pc.id}>
                      {pc.name}（所持金: {pc.eb.toLocaleString()} eb）
                    </option>
                  ))}
                </select>
              </div>

              {/* Insufficient Funds Warning */}
              {isEbShort && (
                <div
                  data-testid="insufficient-funds-warning"
                  style={{
                    padding: '6px 8px',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid var(--color-danger)',
                    color: 'var(--color-danger)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                >
                  資金不足: 不足 {(cartTotal - buyerEb).toLocaleString()} eb
                </div>
              )}

              {/* Purchase Button */}
              <button
                data-testid="purchase-confirm-button"
                onClick={handlePurchase}
                disabled={cart.length === 0 || isEbShort}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: cart.length === 0 || isEbShort ? 'var(--color-surface-elevated)' : 'var(--color-primary)',
                  color: cart.length === 0 || isEbShort ? 'var(--color-text-muted)' : '#fff',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  cursor: cart.length === 0 || isEbShort ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s ease',
                }}
              >
                購入を確定する
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Create/Edit Shop */}
      {showShopModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '400px',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem' }}>
              {editingShop ? '店舗を編集' : '新しい店舗を作成'}
            </h3>
            <form onSubmit={handleSaveShop} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>店舗名</label>
                <input
                  type="text"
                  required
                  value={shopFormName}
                  onChange={(e) => setShopFormName(e.target.value)}
                  placeholder="例: ナイトシティ・ガンズ"
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    color: 'var(--color-text)',
                    fontSize: '0.9rem',
                    marginTop: '4px',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  販売価格倍率（1.0 = 定価、1.2 = 2割増し）
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="10.0"
                  value={shopFormPriceMult}
                  onChange={(e) => setShopFormPriceMult(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    color: 'var(--color-text)',
                    fontSize: '0.9rem',
                    marginTop: '4px',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  買取率（0.5 = 定価の 50% で買い取り）
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0.0"
                  max="1.0"
                  value={shopFormBuyback}
                  onChange={(e) => setShopFormBuyback(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    color: 'var(--color-text)',
                    fontSize: '0.9rem',
                    marginTop: '4px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowShopModal(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'transparent',
                    color: 'var(--color-text)',
                    cursor: 'pointer',
                  }}
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: 'var(--color-primary)',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: PC Sell */}
      {showSellModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '500px',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem' }}>PC から品目を売却</h3>

            {/* PC Select */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>売却する PC:</label>
              <select
                value={sellPcId}
                onChange={(e) => {
                  setSellPcId(e.target.value);
                  setSellQtyMap({});
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface-elevated)',
                  color: 'var(--color-text)',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  marginTop: '4px',
                }}
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（所持金: {c.eb.toLocaleString()} eb / 所持品 {c.inventory.length} 件）
                  </option>
                ))}
              </select>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '8px' }}>
              現在の買取率: {Math.round(buybackRate * 100)}% ({currentShop ? currentShop.name : '標準レート'})
            </div>

            {/* PC Inventory List */}
            {sellPc && sellPc.inventory.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sellPc.inventory.map((inv: InventoryEntry) => {
                  const qty = sellQtyMap[inv.entry_id] || 0;
                  return (
                    <div
                      key={inv.entry_id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--color-surface-elevated)',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{inv.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          所持数: {inv.qty} 個
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          onClick={() => {
                            if (qty > 0) setSellQtyMap({ ...sellQtyMap, [inv.entry_id]: qty - 1 });
                          }}
                          style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          -
                        </button>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{qty}</span>
                        <button
                          onClick={() => {
                            if (qty < inv.qty) setSellQtyMap({ ...sellQtyMap, [inv.entry_id]: qty + 1 });
                          }}
                          style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            border: '1px solid var(--color-border)',
                            backgroundColor: 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '16px' }}>
                所持品がありません。
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => setShowSellModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                閉じる
              </button>
              <button
                onClick={handleExecuteSell}
                disabled={!Object.values(sellQtyMap).some((q) => q > 0)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                売却を確定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Transaction History */}
      {showHistoryModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '650px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>取引履歴</h3>
              <button
                onClick={() => setShowHistoryModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {historyList.length > 0 ? (
                historyList.map((tx) => (
                  <div
                    key={tx.id}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--color-surface-elevated)',
                      fontSize: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600 }}>
                        {tx.kind === 'buy' ? '🛒 購入' : '💰 売却'} · {tx.character_name || tx.character_id}
                        {tx.shop_name && ` (${tx.shop_name})`}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: tx.kind === 'buy' ? 'var(--color-warning)' : 'var(--color-success)' }}>
                        {tx.kind === 'buy' ? `−${tx.total_eb} eb` : `+${tx.total_eb} eb`}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {tx.lines.map((l: any, idx: number) => (
                        <span key={idx}>
                          {l.name} ×{l.qty} ({l.unit_price} eb{l.overridden ? '※値引' : ''})
                          {idx < tx.lines.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </div>

                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textAlign: 'right' }}>
                      {new Date(tx.at).toLocaleString()}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '24px' }}>
                  取引履歴はありません。
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Price Category Configs */}
      {showPriceConfigModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '500px',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}>価格カテゴリ表示名設定</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '16px' }}>
              日本語版ルールブックの訳語に合わせて各価格帯の名称をカスタマイズできます。
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '60vh', overflowY: 'auto' }}>
              {priceConfigs.map((cfg, idx) => (
                <div key={cfg.key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '100px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    〜{cfg.max} eb:
                  </span>
                  <input
                    type="text"
                    value={cfg.label_ja || ''}
                    onChange={(e) => {
                      const updated = [...priceConfigs];
                      updated[idx] = { ...cfg, label_ja: e.target.value };
                      setPriceConfigs(updated);
                    }}
                    placeholder={`例: ${cfg.key}`}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: '4px',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-surface-elevated)',
                      color: 'var(--color-text)',
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => setShowPriceConfigModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                キャンセル
              </button>
              <button
                onClick={handleSavePriceConfigs}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Image Upload & Crop */}
      {showImageModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              padding: '24px',
              width: '90%',
              maxWidth: '460px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>品目画像登録・切抜</h3>

            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleImageFileSelect}
              style={{ fontSize: '0.85rem' }}
            />

            {/* Canvas Crop Area */}
            <div
              style={{
                width: '100%',
                height: '240px',
                backgroundColor: 'var(--color-surface-elevated)',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <canvas
                ref={canvasRef}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
              <div>
                <label style={{ color: 'var(--color-text-muted)', marginRight: '4px' }}>出所:</label>
                <select
                  value={imageOrigin}
                  onChange={(e) => {
                    const orig = e.target.value as 'book_scan' | 'user';
                    setImageOrigin(orig);
                    setImageVisibility(orig === 'book_scan' ? 'gm' : 'players');
                  }}
                  style={{
                    padding: '4px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="user">ユーザー提供画像 (user)</option>
                  <option value="book_scan">本のスキャン画像 (book_scan)</option>
                </select>
              </div>

              <div>
                <label style={{ color: 'var(--color-text-muted)', marginRight: '4px' }}>公開先:</label>
                <select
                  value={imageVisibility}
                  onChange={(e) => setImageVisibility(e.target.value as 'gm' | 'players')}
                  style={{
                    padding: '4px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="players">プレイヤーにも公開 (players)</option>
                  <option value="gm">GM のみ (gm)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setShowImageModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                キャンセル
              </button>
              <button
                onClick={handleUploadCroppedImage}
                disabled={!imageFile || cropUploading}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: !imageFile || cropUploading ? 'not-allowed' : 'pointer',
                }}
              >
                {cropUploading ? 'アップロード中...' : '切り抜いて登録'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
