import React, { useState } from 'react';
import { generateGoogleSitesEmbedHtml, GoogleSitesExportItem } from '../utils/googleSitesExport.js';
import { api } from '../api.js';

interface GoogleSitesExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultStartingFunds: number;
}

export const GoogleSitesExportModal: React.FC<GoogleSitesExportModalProps> = ({
  isOpen,
  onClose,
  defaultStartingFunds,
}) => {
  const [gmEmail, setGmEmail] = useState<string>('');
  const [creationMethod, setCreationMethod] = useState<'complete_package' | 'streetrat' | 'edgerunner' | 'any'>('complete_package');
  const [startingFunds, setStartingFunds] = useState<number>(defaultStartingFunds || 2550);
  const [catalogScope, setCatalogScope] = useState<'official_verified' | 'all'>('official_verified');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExport = async () => {
    setErrorMsg(null);
    if (!gmEmail.trim() || !gmEmail.includes('@')) {
      setErrorMsg('有効な GM メールアドレスを入力してください。');
      return;
    }

    setIsExporting(true);
    try {
      // 1. カタログデータと技能メモを取得
      const [itemsRes, notesRes] = await Promise.all([
        api.getItems({ limit: 1000 }),
        api.getSkillNotes(),
      ]);

      const rawItems = itemsRes.items || [];
      // 公開範囲のフィルタリング
      const filtered = catalogScope === 'official_verified'
        ? rawItems.filter((i: any) => i.verify_status === 'official_verified')
        : rawItems;

      const exportItems: GoogleSitesExportItem[] = filtered.map((i: any) => ({
        id: String(i.id),
        kind: String(i.kind || 'gear'),
        name_ja: String(i.name_ja || i.name || ''),
        name_en: i.name_en ? String(i.name_en) : undefined,
        price: Number(i.price) || 0,
        category: i.category ? String(i.category) : undefined,
        description: i.description ? String(i.description) : undefined,
        stats: i.weapon || i.armor || i.cyberware || undefined,
      }));

      // 2. 単一 HTML の生成
      const htmlContent = generateGoogleSitesEmbedHtml({
        gmEmail: gmEmail.trim(),
        creationMethodKey: creationMethod,
        startingFunds,
        catalogItems: exportItems,
        skillNotes: notesRes.notes || {},
      });

      // 3. ブラウザダウンロード
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cyberpgm-character-create-embed.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onClose();
    } catch (err: any) {
      console.error('Failed to export Google Sites embed HTML:', err);
      setErrorMsg(err.message || 'HTML の書き出しに失敗しました。');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--color-surface, #16181D)',
          border: '1px solid var(--color-ally, #4FB6E3)',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '560px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3
            style={{
              margin: 0,
              fontSize: '1.15rem',
              fontWeight: 800,
              color: 'var(--color-ally, #4FB6E3)',
            }}
          >
            Google サイト用キャラ作成 HTML 書き出し
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted, #9CA3AF)',
              fontSize: '1.2rem',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted, #9CA3AF)', lineHeight: '1.5' }}>
          GM 設定や文字品目カタログを内包した、自己完結型の単一 HTML ファイルを出力します。<br />
          Google サイトの「埋め込み &gt; コードを埋め込む」にそのまま貼り付けて利用できます。
        </p>

        {errorMsg && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '4px',
              backgroundColor: 'rgba(255, 90, 95, 0.15)',
              border: '1px solid var(--color-accent, #FF5A5F)',
              color: 'var(--color-accent, #FF5A5F)',
              fontSize: '0.85rem',
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* 1. GM メールアドレス */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text, #ECEAE4)' }}>
            GM のメールアドレス *（プレイヤーからの提出宛先）
          </label>
          <input
            type="email"
            value={gmEmail}
            onChange={(e) => setGmEmail(e.target.value)}
            placeholder="gm@example.com"
            style={{
              backgroundColor: 'var(--color-bg, #0D0E11)',
              border: '1px solid var(--color-border, #2A2D35)',
              color: 'var(--color-text, #ECEAE4)',
              padding: '10px 12px',
              borderRadius: '6px',
              fontSize: '0.9rem',
            }}
          />
        </div>

        {/* 2. 作成方法 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text, #ECEAE4)' }}>
            許可する作成方法
          </label>
          <select
            value={creationMethod}
            onChange={(e: any) => setCreationMethod(e.target.value)}
            style={{
              backgroundColor: 'var(--color-bg, #0D0E11)',
              border: '1px solid var(--color-border, #2A2D35)',
              color: 'var(--color-text, #ECEAE4)',
              padding: '10px 12px',
              borderRadius: '6px',
              fontSize: '0.9rem',
            }}
          >
            <option value="complete_package">スクラッチビルド（自由配分 62pt / 2,550eb）</option>
            <option value="streetrat">ストリートラット（テンプレート方式 500eb）</option>
            <option value="edgerunner">エッジランナー（簡易選択方式 500eb）</option>
            <option value="any">すべての方式から選択可能</option>
          </select>
        </div>

        {/* 3. 開始資金 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text, #ECEAE4)' }}>
            開始資金 (eb)
          </label>
          <input
            type="number"
            value={startingFunds}
            onChange={(e) => setStartingFunds(Number(e.target.value) || 0)}
            style={{
              backgroundColor: 'var(--color-bg, #0D0E11)',
              border: '1px solid var(--color-border, #2A2D35)',
              color: 'var(--color-text, #ECEAE4)',
              padding: '10px 12px',
              borderRadius: '6px',
              fontSize: '0.9rem',
            }}
          />
        </div>

        {/* 4. 品目カタログ範囲 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text, #ECEAE4)' }}>
            公開する品目カタログの範囲
          </label>
          <select
            value={catalogScope}
            onChange={(e: any) => setCatalogScope(e.target.value)}
            style={{
              backgroundColor: 'var(--color-bg, #0D0E11)',
              border: '1px solid var(--color-border, #2A2D35)',
              color: 'var(--color-text, #ECEAE4)',
              padding: '10px 12px',
              borderRadius: '6px',
              fontSize: '0.9rem',
            }}
          >
            <option value="official_verified">公式確認済み品目のみ（推奨・安全）</option>
            <option value="all">登録済みの全品目（非公式・GM独自含む）</option>
          </select>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #9A9DA6)' }}>
            ※画像やアイコンは含まれず、名前・価格・性能の文字データのみが安全に出力されます。
          </span>
        </div>

        {/* アクションボタン */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <button
            onClick={onClose}
            disabled={isExporting}
            style={{
              padding: '10px 16px',
              borderRadius: '6px',
              border: '1px solid var(--color-border-light, #3D414D)',
              backgroundColor: 'transparent',
              color: 'var(--color-text-muted, #9A9DA6)',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            キャンセル
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            style={{
              padding: '10px 20px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: 'var(--color-ally, #4FB6E3)',
              color: '#000',
              fontWeight: 800,
              cursor: isExporting ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
            }}
          >
            {isExporting ? '生成中…' : 'HTML を書き出す'}
          </button>
        </div>
      </div>
    </div>
  );
};
