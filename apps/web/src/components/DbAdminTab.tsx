import React, { useState, useEffect, useRef } from 'react';
import { api, DbEntitySummary, UnverifiedItem } from '../api.js';
import { ITEM_KINDS } from '@cyberpgm/shared';

export const DbAdminTab: React.FC = () => {
  const [subTab, setSubTab] = useState<'unverified' | 'entities'>('unverified');

  // Unverified items state
  const [unverifiedItems, setUnverifiedItems] = useState<UnverifiedItem[]>([]);
  const [totalUnverified, setTotalUnverified] = useState(0);
  const [overallTotal, setOverallTotal] = useState(0);
  const [countsByKind, setCountsByKind] = useState<Record<string, number>>({});
  const [selectedKind, setSelectedKind] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [loadingUnverified, setLoadingUnverified] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  // Entities state
  const [entities, setEntities] = useState<DbEntitySummary[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string>('items');
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [importFormat, setImportFormat] = useState<'json' | 'csv'>('json');
  const [importContent, setImportContent] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    message: string;
    details?: string[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const allImportFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadUnverifiedItems();
    loadEntities();
  }, []);

  const loadUnverifiedItems = async (kind = selectedKind, q = searchQuery) => {
    setLoadingUnverified(true);
    try {
      const res = await api.getUnverifiedItems({ kind: kind || undefined, q: q || undefined, limit: 300 });
      setUnverifiedItems(res.items);
      setTotalUnverified(res.total);
      setOverallTotal(res.overall_total);
      setCountsByKind(res.counts_by_kind);
      // Clean up selection
      setSelectedItemIds(new Set());
    } catch (err: any) {
      console.error('Failed to load unverified items:', err);
    } finally {
      setLoadingUnverified(false);
    }
  };

  const loadEntities = async () => {
    setLoadingEntities(true);
    try {
      const res = await api.getDbEntities();
      setEntities(res.entities);
    } catch (err: any) {
      console.error('Failed to load entities:', err);
    } finally {
      setLoadingEntities(false);
    }
  };

  // Toggle selection
  const handleToggleSelectAll = () => {
    if (selectedItemIds.size === unverifiedItems.length && unverifiedItems.length > 0) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(unverifiedItems.map((i) => i.id)));
    }
  };

  const handleToggleItem = (id: string) => {
    const next = new Set(selectedItemIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedItemIds(next);
  };

  // Bulk verify execution
  const handleBulkVerify = async (status: string) => {
    if (selectedItemIds.size === 0) return;
    setIsBulkUpdating(true);
    setBulkMessage(null);
    try {
      const res = await api.bulkVerifyItems(Array.from(selectedItemIds), status);
      setBulkMessage({ text: res.message });
      await loadUnverifiedItems();
      await loadEntities();
    } catch (err: any) {
      setBulkMessage({ text: err?.message || '一括変更に失敗しました', isError: true });
    } finally {
      setIsBulkUpdating(false);
    }
  };

  // Export handlers
  const handleExportSingle = (format: 'json' | 'csv') => {
    const token = localStorage.getItem('cpgm_gm_token');
    const url = `/api/db/export/${selectedEntity}?format=${format}`;
    const a = document.createElement('a');
    a.href = url;
    // For authenticated download
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error('エクスポートに失敗しました');
        return res.blob();
      })
      .then((blob) => {
        const blobUrl = window.URL.createObjectURL(blob);
        a.href = blobUrl;
        a.download = `${selectedEntity}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
      })
      .catch((err) => alert(err.message));
  };

  const handleExportAll = async () => {
    try {
      const dump = await api.exportAllDb();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `cyberpgm-all-db-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      alert(`一括エクスポートに失敗しました: ${err?.message}`);
    }
  };

  // Import handler for single entity
  const handleImportSingle = async () => {
    if (!importContent.trim()) {
      setImportResult({ success: false, message: 'インポートするデータが入力されていません。' });
      return;
    }
    setIsImporting(true);
    setImportResult(null);

    try {
      let dataToSend: any = importContent;
      if (importFormat === 'json') {
        try {
          dataToSend = JSON.parse(importContent);
        } catch (e: any) {
          setImportResult({ success: false, message: `JSONの形式が不正です: ${e.message}` });
          setIsImporting(false);
          return;
        }
      }

      const res = await api.importDbEntity(selectedEntity, dataToSend, importFormat === 'csv');
      setImportResult({ success: true, message: res.message });
      setImportContent('');
      await loadEntities();
      await loadUnverifiedItems();
    } catch (err: any) {
      setImportResult({
        success: false,
        message: err.message || 'インポートに失敗しました（データは更新されていません）。',
        details: err.details,
      });
    } finally {
      setIsImporting(false);
    }
  };

  // Import file change handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isCsv = file.name.endsWith('.csv');
    setImportFormat(isCsv ? 'csv' : 'json');

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setImportContent(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Import all file handler
  const handleImportAllUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        setIsImporting(true);
        setImportResult(null);
        const res = await api.importAllDb(parsed);
        setImportResult({ success: true, message: res.message });
        await loadEntities();
        await loadUnverifiedItems();
      } catch (err: any) {
        setImportResult({
          success: false,
          message: err.message || '一括インポートに失敗しました。',
          details: err.details,
        });
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const selectedEntityMeta = entities.find((e) => e.name === selectedEntity);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header & Sub-tab Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: '1px solid var(--color-border)',
          paddingBottom: '12px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
            データベース管理（DB I/O）
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
            全エンティティの CSV/JSON 入出力、確認状態の一括管理、未確認品リスト
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setSubTab('unverified')}
            style={{
              padding: '8px 16px',
              fontSize: '0.875rem',
              fontWeight: 500,
              borderRadius: '6px',
              border: subTab === 'unverified' ? '1px solid #4FB6E3' : '1px solid var(--color-border)',
              backgroundColor: subTab === 'unverified' ? 'rgba(79, 182, 227, 0.15)' : 'var(--color-surface)',
              color: subTab === 'unverified' ? '#4FB6E3' : 'var(--color-text)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>未確認品一覧 & 一括確認</span>
            <span
              style={{
                backgroundColor: overallTotal > 0 ? '#F28C38' : 'var(--color-border)',
                color: overallTotal > 0 ? '#0D0E11' : 'var(--color-text-muted)',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '1px 6px',
                borderRadius: '10px',
              }}
            >
              {overallTotal}
            </span>
          </button>

          <button
            onClick={() => setSubTab('entities')}
            style={{
              padding: '8px 16px',
              fontSize: '0.875rem',
              fontWeight: 500,
              borderRadius: '6px',
              border: subTab === 'entities' ? '1px solid #4FB6E3' : '1px solid var(--color-border)',
              backgroundColor: subTab === 'entities' ? 'rgba(79, 182, 227, 0.15)' : 'var(--color-surface)',
              color: subTab === 'entities' ? '#4FB6E3' : 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            全エンティティ入出力（{entities.length} テーブル）
          </button>
        </div>
      </div>

      {/* Sub-tab 1: Unverified Items & Bulk Verify */}
      {subTab === 'unverified' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Notification Message */}
          {bulkMessage && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '6px',
                backgroundColor: bulkMessage.isError ? 'rgba(255, 90, 95, 0.15)' : 'rgba(79, 182, 227, 0.15)',
                border: `1px solid ${bulkMessage.isError ? '#FF5A5F' : '#4FB6E3'}`,
                color: bulkMessage.isError ? '#FF5A5F' : '#4FB6E3',
                fontSize: '0.875rem',
              }}
            >
              {bulkMessage.text}
            </div>
          )}

          {/* Filter Bar */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap',
              backgroundColor: 'var(--color-surface)',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
              alignItems: 'center',
            }}
          >
            {/* Kind Filter */}
            <select
              value={selectedKind}
              onChange={(e) => {
                setSelectedKind(e.target.value);
                loadUnverifiedItems(e.target.value, searchQuery);
              }}
              style={{
                padding: '8px 12px',
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                color: 'var(--color-text)',
                fontSize: '0.875rem',
                minWidth: '160px',
              }}
            >
              <option value="">すべての種別 ({overallTotal} 件)</option>
              {ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k} ({countsByKind[k] || 0} 件)
                </option>
              ))}
            </select>

            {/* Keyword Search */}
            <div style={{ display: 'flex', gap: '6px', flex: 1, minWidth: '200px' }}>
              <input
                type="text"
                placeholder="品名で検索 (日英)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadUnverifiedItems(selectedKind, searchQuery);
                }}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  backgroundColor: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  color: 'var(--color-text)',
                  fontSize: '0.875rem',
                }}
              />
              <button
                onClick={() => loadUnverifiedItems(selectedKind, searchQuery)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                検索
              </button>
            </div>
          </div>

          {/* Bulk Action Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '10px 14px',
              backgroundColor: selectedItemIds.size > 0 ? 'rgba(79, 182, 227, 0.08)' : 'transparent',
              border: selectedItemIds.size > 0 ? '1px solid rgba(79, 182, 227, 0.3)' : '1px solid transparent',
              borderRadius: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.875rem' }}>
                <input
                  type="checkbox"
                  checked={selectedItemIds.size === unverifiedItems.length && unverifiedItems.length > 0}
                  onChange={handleToggleSelectAll}
                  disabled={unverifiedItems.length === 0}
                />
                <span>全選択 ({selectedItemIds.size}/{totalUnverified} 件)</span>
              </label>
            </div>

            {selectedItemIds.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>選択中の確認状態を一括変更:</span>
                <button
                  onClick={() => handleBulkVerify('official_verified')}
                  disabled={isBulkUpdating}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#4FB6E3',
                    color: '#0D0E11',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  公式確認済み (official_verified)
                </button>
                <button
                  onClick={() => handleBulkVerify('unofficial')}
                  disabled={isBulkUpdating}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#F28C38',
                    color: '#0D0E11',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  非公式 (unofficial)
                </button>
                <button
                  onClick={() => handleBulkVerify('homebrew')}
                  disabled={isBulkUpdating}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#FF5A5F',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  GM独自 (homebrew)
                </button>
              </div>
            )}
          </div>

          {/* Items Table */}
          <div
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              overflowX: 'auto',
            }}
          >
            {loadingUnverified ? (
              <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                未確認品を読み込み中...
              </div>
            ) : unverifiedItems.length === 0 ? (
              <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <p style={{ fontSize: '1.1rem', margin: '0 0 8px', color: 'var(--color-text)' }}>
                  未確認品はありません
                </p>
                <p style={{ fontSize: '0.85rem', margin: 0 }}>
                  すべての品目の確認が完了しているか、条件に合致する品目がありません。
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                    <th style={{ padding: '10px 12px', width: '40px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedItemIds.size === unverifiedItems.length && unverifiedItems.length > 0}
                        onChange={handleToggleSelectAll}
                      />
                    </th>
                    <th style={{ padding: '10px 12px' }}>品名 (日 / 英)</th>
                    <th style={{ padding: '10px 12px', width: '120px' }}>種別</th>
                    <th style={{ padding: '10px 12px', width: '100px' }}>価格 (eb)</th>
                    <th style={{ padding: '10px 12px', width: '110px' }}>状態</th>
                    <th style={{ padding: '10px 12px', width: '140px' }}>クイック変更</th>
                  </tr>
                </thead>
                <tbody>
                  {unverifiedItems.map((item) => {
                    const isSelected = selectedItemIds.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        style={{
                          borderBottom: '1px solid var(--color-border)',
                          backgroundColor: isSelected ? 'rgba(79, 182, 227, 0.06)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleItem(item.id)}
                          />
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                            {item.name_ja_override || item.name_ja || item.name_en}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {item.name_en}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(255,255,255,0.08)',
                              fontSize: '0.75rem',
                            }}
                          >
                            {item.kind}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace' }}>
                          {item.price_eb !== null ? `${item.price_eb.toLocaleString()} eb` : '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(242, 140, 56, 0.15)',
                              color: '#F28C38',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}
                          >
                            未確認
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              onClick={() => {
                                setSelectedItemIds(new Set([item.id]));
                                handleBulkVerify('official_verified');
                              }}
                              title="公式確認済みにする"
                              style={{
                                padding: '4px 8px',
                                backgroundColor: 'rgba(79, 182, 227, 0.15)',
                                color: '#4FB6E3',
                                border: '1px solid rgba(79, 182, 227, 0.3)',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                              }}
                            >
                              公式済
                            </button>
                            <button
                              onClick={() => {
                                setSelectedItemIds(new Set([item.id]));
                                handleBulkVerify('unofficial');
                              }}
                              title="非公式データにする"
                              style={{
                                padding: '4px 8px',
                                backgroundColor: 'rgba(242, 140, 56, 0.15)',
                                color: '#F28C38',
                                border: '1px solid rgba(242, 140, 56, 0.3)',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                              }}
                            >
                              非公式
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Sub-tab 2: Entities I/O (CSV / JSON) */}
      {subTab === 'entities' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Top Overall Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '14px',
              backgroundColor: 'var(--color-surface)',
              borderRadius: '8px',
              border: '1px solid var(--color-border)',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: '0.95rem' }}>
                データベース全体の一括入出力
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                全40テーブルの全レコードを包括した JSON ダンプの出力および取り込み（トランザクション保護）
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={handleExportAll}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'rgba(79, 182, 227, 0.15)',
                  border: '1px solid #4FB6E3',
                  color: '#4FB6E3',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                全テーブル一括エクスポート (JSON)
              </button>

              <button
                onClick={() => allImportFileRef.current?.click()}
                disabled={isImporting}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                全テーブル一括インポート (JSON)
              </button>
              <input
                ref={allImportFileRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleImportAllUpload}
              />
            </div>
          </div>

          {/* Single Entity Panel */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(260px, 320px) 1fr',
              gap: '20px',
            }}
            className="db-admin-grid"
          >
            {/* Entity Selector List */}
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '650px',
                overflowY: 'auto',
              }}
            >
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px' }}>
                対象エンティティ選択 ({loadingEntities ? '読み込み中...' : `${entities.length} テーブル`})
              </div>
              {entities.map((e) => {
                const isSelected = e.name === selectedEntity;
                return (
                  <button
                    key={e.name}
                    onClick={() => {
                      setSelectedEntity(e.name);
                      setImportResult(null);
                    }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      backgroundColor: isSelected ? 'rgba(79, 182, 227, 0.15)' : 'transparent',
                      border: isSelected ? '1px solid #4FB6E3' : '1px solid transparent',
                      borderRadius: '6px',
                      color: isSelected ? '#4FB6E3' : 'var(--color-text)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: isSelected ? 600 : 400 }}>
                      {e.name}
                    </span>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        backgroundColor: isSelected ? '#4FB6E3' : 'rgba(255,255,255,0.06)',
                        color: isSelected ? '#0D0E11' : 'var(--color-text-muted)',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        fontWeight: 600,
                      }}
                    >
                      {e.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Entity Detail & I/O Workspace */}
            <div
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              }}
            >
              {/* Header info */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '12px',
                  borderBottom: '1px solid var(--color-border)',
                  paddingBottom: '14px',
                }}
              >
                <div>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: '1.15rem',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: 'var(--color-text)',
                    }}
                  >
                    {selectedEntity}
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                    レコード数: {selectedEntityMeta?.count ?? 0} 件 | 列数: {selectedEntityMeta?.columns.length ?? 0}
                    {selectedEntityMeta?.foreignKeys.length ? ` | 外部キー参照: ${selectedEntityMeta.foreignKeys.length}件` : ''}
                  </div>
                </div>

                {/* Export Buttons */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleExportSingle('json')}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: 'rgba(79, 182, 227, 0.15)',
                      border: '1px solid #4FB6E3',
                      color: '#4FB6E3',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    JSON エクスポート
                  </button>
                  <button
                    onClick={() => handleExportSingle('csv')}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: 'rgba(79, 182, 227, 0.15)',
                      border: '1px solid #4FB6E3',
                      color: '#4FB6E3',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    CSV エクスポート
                  </button>
                </div>
              </div>

              {/* Columns & Schema Preview */}
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px' }}>
                  カラム定義 & 参照整合性
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {selectedEntityMeta?.columns.map((col) => {
                    const fk = selectedEntityMeta.foreignKeys.find((f) => f.from === col.name);
                    return (
                      <div
                        key={col.name}
                        style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(255,255,255,0.04)',
                          border: '1px solid var(--color-border)',
                          fontSize: '0.75rem',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: col.isPk ? '#4FB6E3' : 'var(--color-text)' }}>
                          {col.name}
                        </span>
                        <span style={{ color: 'var(--color-text-muted)', marginLeft: '4px' }}>
                          :{col.type}
                        </span>
                        {col.required && (
                          <span style={{ color: '#FF5A5F', marginLeft: '4px' }}>*必須</span>
                        )}
                        {fk && (
                          <span style={{ color: '#F28C38', marginLeft: '4px' }}>
                            →{fk.targetTable}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Import Area */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    {selectedEntity} へのデータインポート
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: '4px', overflow: 'hidden' }}>
                      <button
                        onClick={() => setImportFormat('json')}
                        style={{
                          padding: '4px 10px',
                          backgroundColor: importFormat === 'json' ? '#4FB6E3' : 'transparent',
                          color: importFormat === 'json' ? '#0D0E11' : 'var(--color-text)',
                          border: 'none',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        JSON
                      </button>
                      <button
                        onClick={() => setImportFormat('csv')}
                        style={{
                          padding: '4px 10px',
                          backgroundColor: importFormat === 'csv' ? '#4FB6E3' : 'transparent',
                          color: importFormat === 'csv' ? '#0D0E11' : 'var(--color-text)',
                          border: 'none',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        CSV
                      </button>
                    </div>

                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                    >
                      ファイル読込
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,.csv"
                      style={{ display: 'none' }}
                      onChange={handleFileUpload}
                    />
                  </div>
                </div>

                <textarea
                  placeholder={
                    importFormat === 'json'
                      ? '[\n  {\n    "id": "...",\n    "name_ja": "..."\n  }\n]'
                      : 'id,name_ja,price_eb\nval1,名前1,100\nval2,名前2,200'
                  }
                  value={importContent}
                  onChange={(e) => setImportContent(e.target.value)}
                  rows={8}
                  style={{
                    width: '100%',
                    padding: '10px',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.8rem',
                    backgroundColor: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    color: 'var(--color-text)',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    onClick={() => {
                      setImportContent('');
                      setImportResult(null);
                    }}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: 'transparent',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-muted)',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    クリア
                  </button>
                  <button
                    onClick={handleImportSingle}
                    disabled={isImporting || !importContent.trim()}
                    style={{
                      padding: '8px 20px',
                      backgroundColor: '#4FB6E3',
                      border: 'none',
                      color: '#0D0E11',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: isImporting || !importContent.trim() ? 'not-allowed' : 'pointer',
                      opacity: isImporting || !importContent.trim() ? 0.6 : 1,
                    }}
                  >
                    {isImporting ? '検証＆インポート中...' : `${selectedEntity} にインポート実行`}
                  </button>
                </div>

                {/* Import Result Feedback */}
                {importResult && (
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '6px',
                      backgroundColor: importResult.success
                        ? 'rgba(79, 182, 227, 0.15)'
                        : 'rgba(255, 90, 95, 0.15)',
                      border: `1px solid ${importResult.success ? '#4FB6E3' : '#FF5A5F'}`,
                      color: importResult.success ? '#4FB6E3' : '#FF5A5F',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{importResult.message}</div>
                    {importResult.details && importResult.details.length > 0 && (
                      <ul style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: '0.8rem' }}>
                        {importResult.details.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
