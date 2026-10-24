// Google サイト埋め込み用 単一 HTML 書き出しジェネレータ (Phase 6j)
// 厳格な要件:
// - 外部サーバー、CDN、CyberPGM API へのネットワーク通信は一切行わない。
// - スクリプトタグの src 読み込み、外部 CSS link は一切含めない（完全自己完結）。
// - 画像・アイコン・スキャン画像・他プレイヤー情報・GM 保存データ・DB ダンプは含めない。
// - 既存デザインシステム（モック v5）に準拠したレスポンシブ UI（360px〜1440px）。
// - ルール検証（能力値・技能・資金・人間性）、localStorage 一時保存、ファイル保存、
//   Web Share API 検査、mailto 案内、破損検出チェックサム付きテキストコード出力を完備。

import { SKILL_CATALOG, SKILL_CATEGORIES } from '@cyberpgm/shared';

export interface GoogleSitesExportItem {
  id: string;
  kind: string;
  name_ja: string;
  name_en?: string;
  price: number;
  category?: string;
  description?: string;
  stats?: Record<string, string | number | boolean>;
}

export interface GoogleSitesExportOptions {
  gmEmail: string;
  creationMethodKey: 'streetrat' | 'edgerunner' | 'complete_package' | 'any';
  startingFunds: number;
  catalogItems: GoogleSitesExportItem[];
  skillNotes?: Record<string, string>;
}

export function generateGoogleSitesEmbedHtml(options: GoogleSitesExportOptions): string {
  // 1. カタログデータのサニタイズ（テキスト・数値のみ。画像や内部パスは完全排除）
  const sanitizedCatalog = options.catalogItems.map((item) => ({
    id: String(item.id),
    kind: String(item.kind || 'gear'),
    name: String(item.name_ja || ''),
    name_en: item.name_en ? String(item.name_en) : undefined,
    price: Number(item.price) || 0,
    category: item.category ? String(item.category) : undefined,
    description: item.description ? String(item.description) : undefined,
    stats: item.stats || {},
  }));

  // 2. 技能基本データの抽出（テキストのみ）
  const skillList = Object.values(SKILL_CATALOG).map((s) => ({
    key: s.key,
    name: s.name,
    stat: s.stat,
    category: s.category,
    basic: s.basic,
    diff: s.difficulty === 'difficult' ? 2 : 1,
    note: options.skillNotes?.[s.key] || '',
  }));

  // 埋め込み用設定 JSON
  const embedConfig = {
    gmEmail: options.gmEmail.trim(),
    method: options.creationMethodKey,
    startingFunds: options.startingFunds,
    catalog: sanitizedCatalog,
    skills: skillList,
    skillCategories: SKILL_CATEGORIES,
  };

  const serializedConfig = JSON.stringify(embedConfig).replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CyberPGM キャラクター作成</title>
  <style>
    :root {
      --color-bg: #0D0E11;
      --color-surface: #16181D;
      --color-surface-elevated: #1F2229;
      --color-border: #2A2D35;
      --color-border-light: #3D414D;
      --color-text: #ECEAE4;
      --color-text-muted: #9A9DA6;
      --color-ally: #4FB6E3;
      --color-enemy: #F28C38;
      --color-accent: #FF5A5F;
      --color-success: #7EE2A8;
      --color-warning: #F2C94C;
      --font-display: 'Chakra Petch', sans-serif, system-ui;
      --font-body: 'IBM Plex Sans JP', sans-serif, system-ui;
      --font-mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--color-bg);
      color: var(--color-text);
      font-family: var(--font-body);
      line-height: 1.5;
      padding: 16px;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .header-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .brand-title {
      font-size: 1.3rem;
      font-weight: 900;
      color: var(--color-ally);
      letter-spacing: 1px;
    }
    .gm-badge {
      font-size: 0.8rem;
      color: var(--color-text-muted);
      background: var(--color-bg);
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--color-border);
    }
    /* Steps Navigation */
    .steps-nav {
      display: flex;
      gap: 8px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 6px;
      overflow-x: auto;
    }
    .step-btn {
      flex: 1 1 0;
      padding: 8px 12px;
      background: transparent;
      border: none;
      color: var(--color-text-muted);
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 700;
      text-align: center;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .step-btn.active {
      background: var(--color-ally);
      color: #000;
    }
    .content-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .section-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--color-text);
      border-left: 4px solid var(--color-ally);
      padding-left: 8px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 0.85rem;
      color: var(--color-text-muted);
      font-weight: 600;
    }
    input[type="text"], input[type="number"], select {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      color: var(--color-text);
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 0.95rem;
    }
    input:focus, select:focus {
      outline: none;
      border-color: var(--color-ally);
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    /* Stat Counter Box */
    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
    }
    .stat-label {
      font-weight: 700;
      font-size: 0.9rem;
    }
    .counter-ctrls {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn-counter {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      border: 1px solid var(--color-border-light);
      background: var(--color-surface-elevated);
      color: var(--color-text);
      font-size: 1.1rem;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-counter:active {
      background: var(--color-ally);
      color: #000;
    }
    .counter-value {
      font-family: var(--font-mono);
      font-size: 1.1rem;
      font-weight: 700;
      min-width: 28px;
      text-align: center;
    }
    /* Action Buttons */
    .nav-actions {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 8px;
    }
    .btn {
      padding: 10px 20px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      border: none;
      transition: opacity 0.15s ease;
    }
    .btn:hover { opacity: 0.9; }
    .btn-primary { background: var(--color-ally); color: #000; }
    .btn-secondary { background: var(--color-surface-elevated); color: var(--color-text); border: 1px solid var(--color-border-light); }
    .btn-success { background: var(--color-success); color: #000; }
    .badge-info {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      background: var(--color-surface-elevated);
      color: var(--color-ally);
      border: 1px solid var(--color-border);
    }
    .alert-box {
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    .alert-warning {
      background: rgba(242, 201, 76, 0.12);
      border: 1px solid var(--color-warning);
      color: var(--color-warning);
    }
    .alert-success {
      background: rgba(126, 226, 168, 0.12);
      border: 1px solid var(--color-success);
      color: var(--color-success);
    }
    .item-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
    }
    .mono { font-family: var(--font-mono); }
    @media (max-width: 600px) {
      body { padding: 8px; }
      .steps-nav { font-size: 0.75rem; }
      .step-btn { padding: 6px 8px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-card">
      <div>
        <div class="brand-title">CYBERPGM // CHARACTER CREATOR</div>
        <div style="font-size: 0.8rem; color: var(--color-text-muted);">Cyberpunk RED 事前作成埋め込み（オフライン完結）</div>
      </div>
      <div class="gm-badge">GM宛先: <span id="display-gm-email"></span></div>
    </div>

    <!-- Step Navigation -->
    <div class="steps-nav" id="steps-nav">
      <button class="step-btn active" onclick="switchStep(1)">1. 基本</button>
      <button class="step-btn" onclick="switchStep(2)">2. 能力値</button>
      <button class="step-btn" onclick="switchStep(3)">3. 技能</button>
      <button class="step-btn" onclick="switchStep(4)">4. 装備</button>
      <button class="step-btn" onclick="switchStep(5)">5. GMに送る</button>
    </div>

    <!-- STEP 1: 基本 -->
    <div class="content-card" id="step-1">
      <div class="section-title">ステップ 1: 基本情報</div>
      <div class="form-group">
        <label>ハンドル名（キャラクター名）*</label>
        <input type="text" id="input-name" placeholder="例: ヴァイパー" oninput="saveDraft()">
      </div>
      <div class="form-group">
        <label>ロール（役割）*</label>
        <select id="input-role" onchange="saveDraft()">
          <option value="Solo">ソロ (Solo)</option>
          <option value="Netrunner">ネットランナー (Netrunner)</option>
          <option value="Tech">テク (Tech)</option>
          <option value="Medtech">メドテク (Medtech)</option>
          <option value="Media">メディア (Media)</option>
          <option value="Exec">エグゼク (Exec)</option>
          <option value="Lawman">ローマン (Lawman)</option>
          <option value="Fixer">フィクサー (Fixer)</option>
          <option value="Nomad">ノーマッド (Nomad)</option>
          <option value="Rockerboy">ロッカーボーイ (Rockerboy)</option>
        </select>
      </div>
      <div class="alert-box alert-warning">
        作成途中のデータは開いているブラウザ内に自動保存されます。ブラウザを閉じても再開可能です。外部サーバーへの通信は一切行われません。
      </div>
      <div class="nav-actions">
        <div></div>
        <button class="btn btn-primary" onclick="switchStep(2)">能力値へ進む →</button>
      </div>
    </div>

    <!-- STEP 2: 能力値 -->
    <div class="content-card" id="step-2" style="display: none;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        <div class="section-title">ステップ 2: 能力値配分</div>
        <div style="font-size: 0.9rem;">合計: <span id="stat-total" class="mono" style="font-weight: 700; color: var(--color-ally);">60</span> / 62 pt</div>
      </div>
      <div style="display: flex; gap: 16px; flex-wrap: wrap;">
        <div class="badge-info">最大人間性: <span id="stat-humanity" class="mono">60</span></div>
        <div class="badge-info">開始EMP: <span id="stat-emp-display" class="mono">6</span></div>
      </div>
      <div class="grid-2" id="stats-container">
        <!-- 動的レンダリング -->
      </div>
      <div class="nav-actions">
        <button class="btn btn-secondary" onclick="switchStep(1)">← 基本に戻る</button>
        <button class="btn btn-primary" onclick="switchStep(3)">技能へ進む →</button>
      </div>
    </div>

    <!-- STEP 3: 技能 -->
    <div class="content-card" id="step-3" style="display: none;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        <div class="section-title">ステップ 3: 技能習得</div>
        <div style="font-size: 0.9rem;">使用 pt: <span id="skill-points-total" class="mono" style="font-weight: 700; color: var(--color-ally);">0</span> / 86 pt</div>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <input type="text" id="skill-search" placeholder="技能名で検索..." oninput="renderSkills()" style="flex: 1 1 200px;">
        <select id="skill-cat-filter" onchange="renderSkills()">
          <option value="all">すべての系統</option>
          <option value="rangedWeaponSkills">遠隔戦闘系</option>
          <option value="fightingSkills">近接戦闘系</option>
          <option value="awarenessSkills">感知系</option>
          <option value="bodySkills">動作系</option>
          <option value="controlSkills">操作系</option>
          <option value="educationSkills">学術系</option>
          <option value="socialSkills">社交系</option>
          <option value="techniqueSkills">技術系</option>
          <option value="performanceSkills">芸能系</option>
        </select>
      </div>
      <div id="skills-container" style="display: flex; flexDirection: column; gap: 6px; max-height: 480px; overflow-y: auto;">
        <!-- 動的レンダリング -->
      </div>
      <div class="nav-actions">
        <button class="btn btn-secondary" onclick="switchStep(2)">← 能力値に戻る</button>
        <button class="btn btn-primary" onclick="switchStep(4)">装備へ進む →</button>
      </div>
    </div>

    <!-- STEP 4: 装備 -->
    <div class="content-card" id="step-4" style="display: none;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        <div class="section-title">ステップ 4: 装備・サイバーウェア購入</div>
        <div style="font-size: 0.9rem;">
          残金: <span id="funds-remaining" class="mono" style="font-weight: 700; color: var(--color-ally);">0</span> eb
          （開始資金: <span id="funds-initial" class="mono">0</span> eb）
        </div>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <input type="text" id="equip-search" placeholder="装備品を検索..." oninput="renderCatalog()" style="flex: 1 1 200px;">
        <select id="equip-kind-filter" onchange="renderCatalog()">
          <option value="all">すべての種別</option>
          <option value="weapon">武器</option>
          <option value="armor">防具</option>
          <option value="cyberware">サイバーウェア</option>
          <option value="gear">ギア・持ち物</option>
        </select>
      </div>
      <div style="font-size: 0.85rem; color: var(--color-text-muted); font-weight: 700;">購入可能な品目一覧</div>
      <div id="catalog-container" style="display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto;">
        <!-- カタログ -->
      </div>
      <div style="font-size: 0.85rem; color: var(--color-text-muted); font-weight: 700; margin-top: 8px;">現在の所持品</div>
      <div id="cart-container" style="display: flex; flex-direction: column; gap: 6px;">
        <!-- カート -->
      </div>
      <div class="nav-actions">
        <button class="btn btn-secondary" onclick="switchStep(3)">← 技能に戻る</button>
        <button class="btn btn-primary" onclick="switchStep(5)">GMに送るへ進む →</button>
      </div>
    </div>

    <!-- STEP 5: GMに送る -->
    <div class="content-card" id="step-5" style="display: none;">
      <div class="section-title">ステップ 5: キャラクターの送信・保存</div>
      <div id="validation-box" class="alert-box alert-success">
        作成内容を確認しました。問題ありません。
      </div>

      <div style="display: flex; flex-direction: column; gap: 14px; background: var(--color-bg); padding: 16px; border-radius: 6px; border: 1px solid var(--color-border);">
        <strong style="color: var(--color-ally); font-size: 1rem;">GM への送信方法</strong>
        <p style="font-size: 0.85rem; color: var(--color-text-muted); margin: 0;">
          Google サイト埋め込み環境ではセキュリティ制限（sandbox iframe）により、メーラーへのファイル直接添付が制限される場合があります。<br>
          以下の手順で GM（<span id="final-gm-email" style="color: var(--color-text); font-weight: 700;"></span>）へキャラクターをお送りください。
        </p>

        <!-- アクションボタン群 -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px;">
          <button class="btn btn-primary" onclick="downloadCpgmFile()">
            1. ファイル保存 (.cpgm)
          </button>
          <button class="btn btn-secondary" id="btn-webshare" onclick="handleWebShare()">
            2. 共有シートを開く (Web Share)
          </button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
          <a id="btn-mailto" href="#" class="btn btn-secondary" style="text-align: center; text-decoration: none; color: var(--color-ally); border-color: var(--color-ally);">
            ✉️ GM 宛てメール作成を開く
          </a>
          <span style="font-size: 0.75rem; color: var(--color-text-muted); text-align: center;">
            ※メーラーが自動起動したら、保存したファイル（.cpgm）を添付するか、下のコードを本文に貼り付けて送信してください。
          </span>
        </div>
      </div>

      <!-- テキストコード表示領域 -->
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 0.9rem;">テキストコード（メール本文コピー用）</strong>
          <button class="btn btn-secondary" onclick="copyCharacterCode()" style="padding: 4px 12px; font-size: 0.8rem;">
            コードをコピー
          </button>
        </div>
        <textarea id="output-code" rows="5" readonly style="width: 100%; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 6px; padding: 10px; color: var(--color-text); font-family: var(--font-mono); font-size: 0.8rem;"></textarea>
        <div id="code-length-info" style="font-size: 0.75rem; color: var(--color-text-muted);"></div>
      </div>

      <div class="nav-actions">
        <button class="btn btn-secondary" onclick="switchStep(4)">← 装備に戻る</button>
      </div>
    </div>
  </div>

  <script>
    // 埋め込みデータ
    const CONFIG = ${serializedConfig};
    const STORAGE_KEY = 'cpgm_embed_draft_v1';

    // ドラフトステート
    let draft = {
      name: '',
      role: 'Solo',
      stats: { int: 6, ref: 6, dex: 6, tech: 6, cool: 6, will: 6, luck: 6, move: 6, body: 6, emp: 6 },
      skills: {},
      cart: []
    };

    // 初期化と保存ドラフト復元
    function init() {
      document.getElementById('display-gm-email').textContent = CONFIG.gmEmail || '未設定';
      document.getElementById('final-gm-email').textContent = CONFIG.gmEmail || '未設定';
      document.getElementById('funds-initial').textContent = CONFIG.startingFunds.toLocaleString();

      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            draft = { ...draft, ...parsed };
          }
        }
      } catch (e) {
        console.warn('Failed to load local draft:', e);
      }

      document.getElementById('input-name').value = draft.name || '';
      document.getElementById('input-role').value = draft.role || 'Solo';

      renderStats();
      renderSkills();
      renderCatalog();
      renderCart();
      updateCalculations();
      setupMailtoLink();

      // Web Share API ファイル共有検査
      const shareBtn = document.getElementById('btn-webshare');
      if (!navigator.canShare) {
        shareBtn.style.opacity = '0.5';
        shareBtn.title = 'お使いのブラウザはWeb Share APIに対応していません';
      }
    }

    function saveDraft() {
      draft.name = document.getElementById('input-name').value;
      draft.role = document.getElementById('input-role').value;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      } catch (e) {}
      updateCalculations();
      setupMailtoLink();
    }

    function switchStep(stepNum) {
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('step-' + i);
        if (el) el.style.display = i === stepNum ? 'flex' : 'none';
      }
      const buttons = document.querySelectorAll('.step-btn');
      buttons.forEach((btn, idx) => {
        if (idx === stepNum - 1) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // 能力値
    const STAT_KEYS = [
      { key: 'int', label: '知力 (INT)' },
      { key: 'ref', label: '反応 (REF)' },
      { key: 'dex', label: '敏捷 (DEX)' },
      { key: 'tech', label: '技術 (TECH)' },
      { key: 'cool', label: '魅力 (COOL)' },
      { key: 'will', label: '意志 (WILL)' },
      { key: 'luck', label: '幸運 (LUCK)' },
      { key: 'move', label: '移動 (MOVE)' },
      { key: 'body', label: '体格 (BODY)' },
      { key: 'emp', label: '共感 (EMP)' },
    ];

    function renderStats() {
      const container = document.getElementById('stats-container');
      container.innerHTML = '';
      STAT_KEYS.forEach(s => {
        const val = draft.stats[s.key] || 6;
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = \`
          <span class="stat-label">\${s.label}</span>
          <div class="counter-ctrls">
            <button type="button" class="btn-counter" onclick="adjustStat('\${s.key}', -1)">-</button>
            <span class="counter-value" id="stat-val-\${s.key}">\${val}</span>
            <button type="button" class="btn-counter" onclick="adjustStat('\${s.key}', 1)">+</button>
          </div>
        \`;
        container.appendChild(row);
      });
    }

    function adjustStat(key, delta) {
      const current = draft.stats[key] || 6;
      const next = Math.max(2, Math.min(8, current + delta));
      draft.stats[key] = next;
      document.getElementById('stat-val-' + key).textContent = next;
      saveDraft();
    }

    // 技能
    function renderSkills() {
      const container = document.getElementById('skills-container');
      const cat = document.getElementById('skill-cat-filter').value;
      const q = (document.getElementById('skill-search').value || '').toLowerCase().trim();

      container.innerHTML = '';
      CONFIG.skills.forEach(s => {
        if (cat !== 'all' && s.category !== cat) return;
        if (q && !s.name.toLowerCase().includes(q) && !s.key.toLowerCase().includes(q) && !s.note.toLowerCase().includes(q)) return;

        const val = draft.skills[s.key] || (s.basic ? 2 : 0);
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.style.padding = '6px 12px';

        const baseStatVal = draft.stats[s.stat] || 0;
        const baseTotal = baseStatVal + val;

        row.innerHTML = \`
          <div style="display: flex; flex-direction: column;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-weight: 700; font-size: 0.85rem;">\${s.name}</span>
              \${s.diff > 1 ? '<span style="font-size: 0.7rem; color: var(--color-warning);">×2</span>' : ''}
              \${s.basic ? '<span style="font-size: 0.7rem; color: var(--color-ally);">基礎</span>' : ''}
            </div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted);">
              \${s.stat.toUpperCase()} \${baseStatVal} + Lv \${val} = 基本値 \${baseTotal}
              \${s.note ? '・ ' + s.note : ''}
            </div>
          </div>
          <div class="counter-ctrls">
            <button type="button" class="btn-counter" onclick="adjustSkill('\${s.key}', -1, \${s.basic})">-</button>
            <span class="counter-value">\${val}</span>
            <button type="button" class="btn-counter" onclick="adjustSkill('\${s.key}', 1, \${s.basic})">+</button>
          </div>
        \`;
        container.appendChild(row);
      });
    }

    function adjustSkill(key, delta, basic) {
      const min = basic ? 2 : 0;
      const current = draft.skills[key] != null ? draft.skills[key] : min;
      const next = Math.max(min, Math.min(6, current + delta));
      draft.skills[key] = next;
      saveDraft();
      renderSkills();
    }

    // カタログ
    function renderCatalog() {
      const container = document.getElementById('catalog-container');
      const kind = document.getElementById('equip-kind-filter').value;
      const q = (document.getElementById('equip-search').value || '').toLowerCase().trim();

      container.innerHTML = '';
      CONFIG.catalog.forEach(item => {
        if (kind !== 'all' && item.kind !== kind) return;
        if (q && !item.name.toLowerCase().includes(q) && !(item.name_en || '').toLowerCase().includes(q)) return;

        const row = document.createElement('div');
        row.className = 'item-card';
        row.innerHTML = \`
          <div style="display: flex; flex-direction: column;">
            <div style="font-weight: 700; font-size: 0.85rem;">\${item.name}</div>
            <div style="font-size: 0.75rem; color: var(--color-text-muted);">
              \${item.price.toLocaleString()} eb \${item.category ? '・' + item.category : ''}
            </div>
          </div>
          <button type="button" class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="addToCart('\${item.id}')">
            購入
          </button>
        \`;
        container.appendChild(row);
      });
    }

    function addToCart(id) {
      const item = CONFIG.catalog.find(c => c.id === id);
      if (!item) return;
      const found = draft.cart.find(c => c.id === id);
      if (found) {
        found.qty += 1;
      } else {
        draft.cart.push({ id: item.id, name: item.name, price: item.price, kind: item.kind, qty: 1 });
      }
      saveDraft();
      renderCart();
    }

    function removeFromCart(id) {
      const idx = draft.cart.findIndex(c => c.id === id);
      if (idx !== -1) {
        if (draft.cart[idx].qty > 1) {
          draft.cart[idx].qty -= 1;
        } else {
          draft.cart.splice(idx, 1);
        }
      }
      saveDraft();
      renderCart();
    }

    function renderCart() {
      const container = document.getElementById('cart-container');
      container.innerHTML = '';
      if (draft.cart.length === 0) {
        container.innerHTML = '<div style="font-size: 0.8rem; color: var(--color-text-muted);">所持品はありません</div>';
        return;
      }
      draft.cart.forEach(c => {
        const row = document.createElement('div');
        row.className = 'item-card';
        row.innerHTML = \`
          <div>
            <strong>\${c.name}</strong> × \${c.qty}
            <span style="font-size: 0.8rem; color: var(--color-ally); margin-left: 8px;">\${(c.price * c.qty).toLocaleString()} eb</span>
          </div>
          <button type="button" class="btn btn-secondary" style="padding: 2px 8px; font-size: 0.75rem;" onclick="removeFromCart('\${c.id}')">削除</button>
        \`;
        container.appendChild(row);
      });
    }

    // 計算とルール検証
    function updateCalculations() {
      let statSum = 0;
      Object.values(draft.stats).forEach(v => statSum += v);
      document.getElementById('stat-total').textContent = statSum;

      const emp = draft.stats.emp || 6;
      document.getElementById('stat-humanity').textContent = emp * 10;
      document.getElementById('stat-emp-display').textContent = emp;

      let skillSpent = 0;
      CONFIG.skills.forEach(s => {
        const val = draft.skills[s.key] != null ? draft.skills[s.key] : (s.basic ? 2 : 0);
        skillSpent += val * s.diff;
      });
      document.getElementById('skill-points-total').textContent = skillSpent;

      let spentEb = 0;
      draft.cart.forEach(c => spentEb += c.price * c.qty);
      const remaining = CONFIG.startingFunds - spentEb;
      document.getElementById('funds-remaining').textContent = remaining.toLocaleString();

      // 検証ボックス
      const valBox = document.getElementById('validation-box');
      const errors = [];
      if (!draft.name.trim()) errors.push('ハンドル名が入力されていません。');
      if (statSum > 62) errors.push(\`能力値ポイントが超過しています（現在 \${statSum} / 62 pt）。\`);
      if (skillSpent > 86) errors.push(\`技能ポイントが超過しています（現在 \${skillSpent} / 86 pt）。\`);
      if (remaining < 0) errors.push(\`所持金が不足しています（超過: \${Math.abs(remaining).toLocaleString()} eb）。\`);

      if (errors.length > 0) {
        valBox.className = 'alert-box alert-warning';
        valBox.innerHTML = '<strong>確認事項があります:</strong><br>' + errors.join('<br>');
      } else {
        valBox.className = 'alert-box alert-success';
        valBox.innerHTML = '<strong>ルール適合:</strong> 能力値・技能・開始資金のすべてがルール上限を満たしています。';
      }

      // テキストコード生成
      updateOutputCode();
    }

    // Adler-32 チェックサム計算
    function calculateAdler32(str) {
      let a = 1, b = 0;
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        a = (a + code) % 65521;
        b = (b + a) % 65521;
      }
      return (((b << 16) | a) >>> 0).toString(16).padStart(8, '0');
    }

    function buildCharacterJson() {
      return {
        format: 'cpgm-character',
        version: 1,
        character: {
          name: draft.name.trim() || '（無名）',
          role: draft.role,
          stats: draft.stats,
          skills: draft.skills,
          inventory: draft.cart.filter(c => c.kind !== 'cyberware').map(c => ({
            name: c.name,
            qty: c.qty,
            price_eb: c.price,
            category: c.kind
          })),
          cyberware: draft.cart.filter(c => c.kind === 'cyberware').map(c => ({
            name: c.name,
            type: 'cyberware'
          }))
        },
        created_with: {
          method: CONFIG.method,
          starting_funds: CONFIG.startingFunds
        }
      };
    }

    function updateOutputCode() {
      const data = buildCharacterJson();
      const jsonStr = JSON.stringify(data);
      const checksum = calculateAdler32(jsonStr);
      // UTF-8 to Base64
      const b64 = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
      const code = 'CPGM1:' + checksum + ':' + b64;
      document.getElementById('output-code').value = code;

      const len = code.length;
      const infoEl = document.getElementById('code-length-info');
      if (len > 1800) {
        infoEl.textContent = \`コード長: \${len}文字（推奨安全長1800文字を超えているため、mailto自動リンクではなく下の「コードをコピー」をご利用ください）\`;
        infoEl.style.color = 'var(--color-warning)';
      } else {
        infoEl.textContent = \`コード長: \${len}文字（メール本文への貼り付けに最適化されています）\`;
        infoEl.style.color = 'var(--color-text-muted)';
      }
    }

    function setupMailtoLink() {
      const mailtoBtn = document.getElementById('btn-mailto');
      const subject = \`[CyberPGM] キャラクター提出: \${draft.name.trim() || '無名'} (\${draft.role})\`;
      const code = document.getElementById('output-code')?.value || '';
      const body = \`GM 様\\n\\nCyberPGM にてキャラクターを作成しました。\\nハンドル名: \${draft.name.trim()}\\nロール: \${draft.role}\\n\\n【キャラクターコード】\\n\${code}\\n\\n※CyberPGM の「キャラ受付」画面で「コードから取り込む」を開き、上記のコードを貼り付けてください。\\n（または添付の .cpgm ファイルを取り込んでください）\`;

      mailtoBtn.href = \`mailto:\${CONFIG.gmEmail}?subject=\${encodeURIComponent(subject)}&body=\${encodeURIComponent(body)}\`;
    }

    function downloadCpgmFile() {
      const data = buildCharacterJson();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`\${draft.name.trim() || 'character'}.cpgm\`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function copyCharacterCode() {
      const code = document.getElementById('output-code').value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
          alert('キャラクターコードをクリップボードにコピーしました！');
        }).catch(() => {
          prompt('以下のコードをコピーしてください:', code);
        });
      } else {
        prompt('以下のコードをコピーしてください:', code);
      }
    }

    async function handleWebShare() {
      const data = buildCharacterJson();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const filename = \`\${draft.name.trim() || 'character'}.cpgm\`;
      const file = new File([blob], filename, { type: 'application/json' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: \`CyberPGM キャラクター: \${draft.name.trim()}\`,
            text: \`GM (\${CONFIG.gmEmail}) 宛てキャラクターデータ\`
          });
        } catch (e) {
          if (e.name !== 'AbortError') {
            alert('共有シートの起動に失敗しました。ファイル保存をお使いください。');
          }
        }
      } else {
        alert('この端末またはブラウザは Web Share API のファイル添付共有に対応していません。「1. ファイル保存」または「コードをコピー」をご利用ください。');
      }
    }

    window.addEventListener('DOMContentLoaded', init);
  </script>
</body>
</html>`;
}
