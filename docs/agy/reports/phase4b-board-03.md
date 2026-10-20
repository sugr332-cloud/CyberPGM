# Phase 4b 盤面・別ウィンドウ・TV レビュー指摘 03 対応報告

- **作成日**: 2026-10-21
- **作業ブランチ**: `agy/phase4b-board`
- **対象ドキュメント**: `docs/agy/phase4b-board.md` §13

---

## 1. 指摘事項ごとの対応内容

### 1.1 木箱越しの射線が赤で描かれている問題の修正（指摘 1）
- **原因**:
  - `checkLineOfSight` が返却する射線状態の型 `LosStatus`（`@cyberpgm/rules`）は `'clear' | 'cover' | 'blocked'` で定義されています。
  - `apps/web/src/components/BoardView.tsx`（688〜717 行目）において、黄色判定を `losLine.status === 'partial'` と比較していたため、遮蔽物（木箱）通過時の状態 `'cover'` が合致せず、赤色（`#EF4444`）にフォールバックしていました。
- **対応内容**:
  - `BoardView.tsx`:
    - `BoardViewProps.losLine.status` の型定義を `LosStatus` に統一。
    - `<line>` および `<circle>` の `stroke` 判定を `losLine.status === 'cover' ? '#EAB308' : '#EF4444'` に修正。
    - `strokeDasharray` の判定も `losLine.status === 'cover'` に修正。
  - `CombatView.tsx`:
    - `losOverride` の型を `'auto' | LosStatus` に統一。
    - 射線テキスト・選択肢・遮蔽ダメージ枠の判定における `'partial'` を `LosStatus` の `'cover'` に統一。
- **対応テスト**:
  - `e2e/board-combat.spec.ts`: `Test Shooting with Line of Sight (Yellow Cover vs Red Blocked)`
    - 壁越し（`blocks_los: 'full'`）の対象（ブースター）選択時に、射線の `stroke` が赤（`#EF4444`）であり `射線: × 射撃不可` となることを検証。
    - 木箱越し（`blocks_los: 'partial'`）の対象（ガンガー）選択時に、射線の `stroke` が黄色（`#EAB308`）であり `射線: △ 遮蔽越し` となることを検証。
- **スクリーンショット**:
  - `docs/agy/reports/img/phase4b-board-combat-1440.png`

### 1.2 TV 共有画面の盤面拡大表示（指摘 2）
- **原因**:
  - `BoardView.tsx` の `<svg>` 要素に `width={boardWidth * scale}`、`height={boardHeight * scale}`（標準 800px × 600px）が固定で指定されており、1920px の TV 画面において枠内に右側・下側の大きな空きが生じていました。
- **対応内容**:
  - `ScreenPage.tsx`:
    - `<main>` および盤面コンテナ `<div style={{ flex: 1, height: '100%', minWidth: 0, minHeight: 0, ... }}>` のスタイルを整備し、利用可能な領域全体を占有。
  - `BoardView.tsx`:
    - `isScreen === true` の場合、コンテナおよび SVG ラッパーを `width: 100%`, `height: 100%`, `minHeight: 0`, `overflow: hidden` に設定。
    - `<svg>` に `width={isScreen ? '100%' : boardWidth * scale}`, `height={isScreen ? '100%' : boardHeight * scale}`, `viewBox={`0 0 ${boardWidth} ${boardHeight}`}`, `preserveAspectRatio="xMidYMid meet"` を設定。
    - これにより、盤面の縦横比（4:3）を完全に維持したまま、1920x1080 画面の高さ枠（約 988px）に合わせて横幅約 1317px まで自動拡大され、中央に配置されます。
    - また、SVG 上のクリック座標変換（`getCellFromEvent`）も `createSVGPoint` と `getScreenCTM()?.inverse()` を用いた SVG 行列逆変換に刷新し、任意の拡大率・CSS レイアウト下でも正確なセル座標を取得可能としました。
- **対応テスト**:
  - `e2e/board-combat.spec.ts`: `Test TV Shared Screen /screen (1920px)`
    - TV 画面の盤面 `<svg>` のバウンディングボックスを取得し、800px 固定ではなく拡大されていること（`height > 800` かつ `width > 1000`）を検証。
- **スクリーンショット**:
  - `docs/agy/reports/img/phase4b-board-tv-1920.png`

---

## 2. スクリーンショット一覧

### 2.1 盤面つき戦闘画面（射線 1440px）
- 木箱越しの射線が黄色（`#EAB308`、破線 `6 4`）で正しく描画されている状態。
![盤面つき戦闘画面 - 射線（1440px）](img/phase4b-board-combat-1440.png)

### 2.2 TV 共有画面 `/screen` (1920px)
- 盤面が枠の高さに合わせて拡大され、右側・下側の余白が解消された全面表示状態。
![TV 共有画面（1920px）](img/phase4b-board-tv-1920.png)

### 2.3 盤面つき戦闘画面（移動範囲 1440px）
![盤面つき戦闘画面 - 移動範囲（1440px）](img/phase4b-board-combat-move-1440.png)

### 2.4 別ウィンドウ `/gm/combat` (1280px)
![別ウィンドウ（1280px）](img/phase4b-board-window-1280.png)

### 2.5 スマホ幅（390px）
![スマホ幅の盤面（390px）](img/phase4b-board-mobile-390.png)

---

## 3. テスト実行結果

### 3.1 単体・統合テスト (`npm test`)
- **23 テストスイート 146 テスト全件パス**
  - `packages/rules/test/movement.test.ts` (13 tests)
  - `apps/server/test/board.test.ts` (6 tests)
  - `apps/server/test/combat.test.ts` (16 tests)
  - 他 20 テストファイル全件パス

### 3.2 E2E テスト (`npx playwright test`)
- **5 テスト全件パス**
  - `e2e/board-combat.spec.ts`:
    - 壁越し射線の赤（`#EF4444`）および射撃不可の検証
    - 木箱越し射線の黄色（`#EAB308`）および遮蔽越しの検証
    - TV 画面の盤面 SVG 拡大（高さ > 800px, 幅 > 1000px）の検証
    - 味方 HP 表示・健康な敵の負傷バッジ非表示・GM コマ 0/1 非表示の検証
  - `e2e/character-creation.spec.ts`
  - `e2e/combat.spec.ts`
  - `e2e/session-flow.spec.ts`
  - `e2e/shop-item-flow.spec.ts`

### 3.3 リント・型チェック
- `npm run lint`: 0 errors
- `npm run typecheck`: 0 errors
- `npm run build -w @cyberpgm/web`: 正常ビルド完了

---

## 4. 遵守事項の確認
- `npm start`（8787 ポート）のプロセスには一切接触・停止・実行していません。
- 本番の `data/cyberpgm.db` には一切触れていません（E2E は専用の `data/test-e2e.db` で動作）。
