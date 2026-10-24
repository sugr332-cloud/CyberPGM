import React, { useState, useEffect, useMemo } from 'react';
import { useNetworkStatus } from '../hooks/useNetworkStatus.js';
import { loadCatalogSnapshot, OfflineCatalogSnapshot, OfflineCatalogItem } from '../utils/offlineCatalog.js';
import { Link } from 'react-router-dom';

const KIND_LABELS: Record<string, string> = {
  all: 'すべて',
  weapon: '武器',
  armor: '防具',
  cyberware: 'サイバーウェア',
  gear: 'ギア・持ち物',
  ammo: '弾薬',
  drug: '薬品',
  clothing: '衣服',
};

export const OfflineCatalogPage: React.FC = () => {
  const isOnline = useNetworkStatus();
  const [snapshot, setSnapshot] = useState<OfflineCatalogSnapshot | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedKind, setSelectedKind] = useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<OfflineCatalogItem | null>(null);

  useEffect(() => {
    const loaded = loadCatalogSnapshot();
    setSnapshot(loaded);
  }, []);

  const filteredItems = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.items.filter((item) => {
      if (selectedKind !== 'all' && item.kind !== selectedKind) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const ja = item.name_ja.toLowerCase();
        const en = (item.name_en || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        return ja.includes(q) || en.includes(q) || desc.includes(q);
      }
      return true;
    });
  }, [snapshot, selectedKind, searchQuery]);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-bg, #0D0E11)',
        color: 'var(--color-text, #E5E7EB)',
        fontFamily: "'IBM Plex Sans JP', sans-serif",
        padding: '16px',
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {/* 1. Header & Navigation */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: '1px solid var(--color-border, #2D3748)',
          paddingBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Link
            to="/"
            style={{
              color: 'var(--color-text-muted, #9CA3AF)',
              textDecoration: 'none',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            ← トップへ
          </Link>
          <h1
            style={{
              margin: 0,
              fontSize: '1.25rem',
              fontWeight: 900,
              fontFamily: "'Chakra Petch', sans-serif",
              color: 'var(--color-ally, #4FB6E3)',
              letterSpacing: '1px',
            }}
          >
            PWA 品目カタログ（オフライン閲覧）
          </h1>
        </div>

        {/* 状態バッジ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: isOnline ? 'rgba(79, 182, 227, 0.15)' : 'rgba(255, 90, 95, 0.2)',
              color: isOnline ? 'var(--color-ally, #4FB6E3)' : 'var(--color-accent, #FF5A5F)',
              border: `1px solid ${isOnline ? '#4FB6E3' : '#FF5A5F'}`,
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: isOnline ? '#4FB6E3' : '#FF5A5F',
              }}
            />
            通信状態: {isOnline ? 'オンライン' : 'オフライン'}
          </span>
          <span
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              backgroundColor: 'var(--color-surface, #1A1D24)',
              color: 'var(--color-text-muted, #9CA3AF)',
              border: '1px solid var(--color-border, #2D3748)',
            }}
          >
            閲覧専用
          </span>
        </div>
      </header>

      {/* 2. オフライン専用バナー */}
      <div
        style={{
          padding: '12px 16px',
          borderRadius: '6px',
          backgroundColor: isOnline ? '#161922' : 'rgba(255, 90, 95, 0.12)',
          border: `1px solid ${isOnline ? '#2D3748' : '#FF5A5F'}`,
          fontSize: '0.85rem',
          lineHeight: '1.5',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <strong style={{ color: isOnline ? '#4FB6E3' : '#FF5A5F' }}>
            {isOnline ? 'ℹ️ カタログ閲覧モード' : '⚠️ オフライン閲覧中（閲覧のみ）'}
          </strong>
        </div>
        <p style={{ margin: 0, color: 'var(--color-text-muted, #9CA3AF)' }}>
          {isOnline
            ? '事前に端末に保存された品目スナップショットを閲覧しています。オンライン時は最新カタログが自動保持されます。'
            : 'ネットワーク接続が切断されているため、オフライン閲覧用スナップショットを表示しています。オフライン中のキャラクター送信や購入申請などの通信操作は行えません。'}
        </p>
        {snapshot && (
          <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: '4px' }}>
            保存日時: {new Date(snapshot.savedAt).toLocaleString('ja-JP')}（全 {snapshot.itemCount} 品目）
          </div>
        )}
      </div>

      {/* 3. 検索・フィルターバー */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          backgroundColor: 'var(--color-surface, #1A1D24)',
          border: '1px solid var(--color-border, #2D3748)',
          borderRadius: '8px',
          padding: '12px 16px',
        }}
      >
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="品名や説明文で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: '1 1 240px',
              backgroundColor: '#0D0E11',
              border: '1px solid var(--color-border, #2D3748)',
              color: 'var(--color-text, #E5E7EB)',
              borderRadius: '4px',
              padding: '8px 12px',
              fontSize: '0.85rem',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid var(--color-border, #2D3748)',
                color: 'var(--color-text-muted, #9CA3AF)',
                borderRadius: '4px',
                padding: '0 12px',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              クリア
            </button>
          )}
        </div>

        {/* 種別タブボタン */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {Object.entries(KIND_LABELS).map(([k, label]) => {
            const isActive = selectedKind === k;
            return (
              <button
                key={k}
                onClick={() => setSelectedKind(k)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: isActive ? 700 : 500,
                  backgroundColor: isActive ? 'var(--color-ally, #4FB6E3)' : '#0D0E11',
                  color: isActive ? '#000' : 'var(--color-text-muted, #9CA3AF)',
                  border: `1px solid ${isActive ? '#4FB6E3' : '#2D3748'}`,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. メインコンテンツ（品目一覧 ＆ 詳細パネル） */}
      {!snapshot || snapshot.items.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 16px',
            backgroundColor: 'var(--color-surface, #1A1D24)',
            borderRadius: '8px',
            border: '1px solid var(--color-border, #2D3748)',
          }}
        >
          <p style={{ margin: '0 0 12px', fontSize: '1rem', color: 'var(--color-warning, #F28C38)' }}>
            端末にオフライン用カタログのスナップショットがまだ保存されていません。
          </p>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted, #9CA3AF)' }}>
            オンライン時に「商店」や「キャラ作成」画面を開くと、オフライン閲覧用データが自動的に保存されます。
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: selectedItem ? '1fr 340px' : '1fr',
            gap: '16px',
            alignItems: 'start',
          }}
        >
          {/* リスト表示 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #9CA3AF)' }}>
              該当品目: {filteredItems.length} 件
            </div>
            {filteredItems.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  backgroundColor: 'var(--color-surface, #1A1D24)',
                  borderRadius: '6px',
                  color: 'var(--color-text-muted, #9CA3AF)',
                }}
              >
                検索条件に一致する品目が見つかりませんでした。
              </div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = selectedItem?.id === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedItem(isSelected ? null : item)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      backgroundColor: isSelected ? '#1E2530' : 'var(--color-surface, #1A1D24)',
                      border: `1px solid ${isSelected ? '#4FB6E3' : '#2D3748'}`,
                      cursor: 'pointer',
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '2px 6px',
                            borderRadius: '3px',
                            backgroundColor: '#0D0E11',
                            color: '#4FB6E3',
                            border: '1px solid #2D3748',
                          }}
                        >
                          {KIND_LABELS[item.kind] || item.kind}
                        </span>
                        <strong style={{ fontSize: '0.95rem', color: 'var(--color-text, #E5E7EB)' }}>
                          {item.name_ja}
                        </strong>
                      </div>
                      {item.name_en && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #9CA3AF)' }}>
                          {item.name_en}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span
                        style={{
                          fontSize: '0.95rem',
                          fontWeight: 700,
                          fontFamily: "'JetBrains Mono', monospace",
                          color: '#4FB6E3',
                        }}
                      >
                        {item.price.toLocaleString()} eb
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 詳細パネル（サイドバーまたはモーダル） */}
          {selectedItem && (
            <div
              style={{
                backgroundColor: 'var(--color-surface, #1A1D24)',
                border: '1px solid var(--color-ally, #4FB6E3)',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                position: 'sticky',
                top: '16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      backgroundColor: '#0D0E11',
                      color: '#4FB6E3',
                      border: '1px solid #2D3748',
                    }}
                  >
                    {KIND_LABELS[selectedItem.kind] || selectedItem.kind}
                  </span>
                  <h3 style={{ margin: '6px 0 0', fontSize: '1.1rem', color: '#FFF' }}>
                    {selectedItem.name_ja}
                  </h3>
                  {selectedItem.name_en && (
                    <span style={{ fontSize: '0.8rem', color: '#9CA3AF' }}>{selectedItem.name_en}</span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#9CA3AF',
                    fontSize: '1.2rem',
                    cursor: 'pointer',
                    padding: '0 4px',
                  }}
                >
                  ✕
                </button>
              </div>

              <div
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 900,
                  fontFamily: "'JetBrains Mono', monospace",
                  color: '#4FB6E3',
                  borderBottom: '1px solid #2D3748',
                  paddingBottom: '8px',
                }}
              >
                {selectedItem.price.toLocaleString()} eb
              </div>

              {/* 性能情報（stats） */}
              {selectedItem.stats && Object.keys(selectedItem.stats).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#9CA3AF', fontWeight: 700 }}>性能データ</span>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(2, 1fr)',
                      gap: '6px',
                      backgroundColor: '#0D0E11',
                      padding: '8px',
                      borderRadius: '4px',
                      border: '1px solid #2D3748',
                      fontSize: '0.8rem',
                    }}
                  >
                    {Object.entries(selectedItem.stats).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: '#9CA3AF', fontSize: '0.7rem' }}>{k}</span>
                        <span style={{ fontWeight: 600, color: '#E5E7EB' }}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 説明文 */}
              {selectedItem.description && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '0.75rem', color: '#9CA3AF', fontWeight: 700 }}>解説</span>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '0.85rem',
                      lineHeight: '1.5',
                      color: '#D1D5DB',
                      backgroundColor: '#0D0E11',
                      padding: '8px',
                      borderRadius: '4px',
                      border: '1px solid #2D3748',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {selectedItem.description}
                  </p>
                </div>
              )}

              {/* アクション制約説明 */}
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--color-warning, #F28C38)',
                  backgroundColor: 'rgba(242, 140, 56, 0.1)',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid rgba(242, 140, 56, 0.3)',
                  textAlign: 'center',
                }}
              >
                オフライン閲覧モードのため購入申請はできません
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
