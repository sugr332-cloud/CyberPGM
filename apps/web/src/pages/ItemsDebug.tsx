import React, { useState, useEffect } from 'react';
import { ITEM_KINDS, ItemDetail } from '@cyberpgm/shared';

export const ItemsDebug: React.FC = () => {
  const [items, setItems] = useState<ItemDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedKind, setSelectedKind] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 50;

  useEffect(() => {
    fetchItems();
  }, [selectedKind, page]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedKind) params.set('kind', selectedKind);
      if (searchQuery) params.set('q', searchQuery);
      params.set('limit', String(pageSize));
      params.set('offset', String(page * pageSize));

      const res = await fetch(`/api/items?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { items: ItemDetail[]; total: number };
        setItems(data.items);
        setTotal(data.total);
      }
    } catch (err) {
      console.error('Failed to fetch items:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    fetchItems();
  };

  return (
    <div style={{ padding: '16px', fontFamily: 'sans-serif' }}>
      <h1>CyberPGM - Items Debug</h1>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <select
          value={selectedKind}
          onChange={(e) => {
            setSelectedKind(e.target.value);
            setPage(0);
          }}
          style={{ padding: '6px' }}
        >
          <option value="">すべての種類 ({total} 件)</option>
          {ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="名前で検索 (日英)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ padding: '6px', width: '250px' }}
        />

        <button type="submit" style={{ padding: '6px 16px' }}>
          検索
        </button>
      </form>

      <div style={{ marginBottom: '8px' }}>
        <span>
          {total} 件中 {page * pageSize + 1} - {Math.min((page + 1) * pageSize, total)} 件表示
        </span>
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          style={{ marginLeft: '12px', padding: '4px 8px' }}
        >
          前へ
        </button>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={(page + 1) * pageSize >= total}
          style={{ marginLeft: '6px', padding: '4px 8px' }}
        >
          次へ
        </button>
      </div>

      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <table
          border={1}
          cellPadding={8}
          style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}
        >
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={{ width: '60px' }}>画像</th>
              <th>名前（日本語 / 英語）</th>
              <th>種類</th>
              <th>価格</th>
              <th>出典</th>
              <th>確認状態</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center' }}>
                  アイテムがありません
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const primaryImg = item.images?.[0];
                const displayName = item.name_ja_override || item.name_ja || item.name_en;
                return (
                  <tr key={item.id}>
                    <td style={{ textAlign: 'center' }}>
                      {primaryImg ? (
                        <img
                          src={`/api/images/${primaryImg.id}`}
                          alt={displayName}
                          style={{
                            width: '40px',
                            height: '40px',
                            objectFit: 'contain',
                            background: '#222',
                            borderRadius: '4px',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '40px',
                            height: '40px',
                            background: '#ccc',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            color: '#666',
                          }}
                        >
                          No img
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 'bold' }}>{displayName}</div>
                      {displayName !== item.name_en && (
                        <div style={{ fontSize: '0.85em', color: '#666' }}>{item.name_en}</div>
                      )}
                    </td>
                    <td>{item.kind}</td>
                    <td>
                      {item.price_eb !== null ? (
                        <div>
                          {item.price_eb.toLocaleString()} eb
                          {item.price_category && (
                            <span
                              style={{
                                marginLeft: '6px',
                                fontSize: '0.8em',
                                background: '#e0e0e0',
                                padding: '2px 4px',
                                borderRadius: '3px',
                              }}
                            >
                              {item.price_category}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: '#999' }}>-</span>
                      )}
                    </td>
                    <td>
                      <div>{item.source_book || '-'}</div>
                      <div style={{ fontSize: '0.85em', color: '#666' }}>
                        {item.source_page_en && `p.${item.source_page_en} (EN)`}
                        {item.source_page_ja && ` / p.${item.source_page_ja} (JA)`}
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: '0.8em',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background:
                            item.verify_status === 'official_verified' ? '#d4edda' : '#fff3cd',
                          color:
                            item.verify_status === 'official_verified' ? '#155724' : '#856404',
                        }}
                      >
                        {item.verify_status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};
