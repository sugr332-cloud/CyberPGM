# Phase 5a シナリオメーカー・画像管理報告 02（レビュー指摘 02 対応）

- **作成日**: 2026-10-21
- **作業ブランチ**: `agy/phase5a-scenario-maker`
- **対象ドキュメント**: `docs/agy/phase5a-scenario-maker.md` §10「レビュー指摘 02」

---

## 1. 修正概要

`docs/agy/phase5a-scenario-maker.md` §10「レビュー指摘 02」に基づき、以下の 4 点を修正しました。

### 1. 絵文字の排除
- `ScenarioMakerView.tsx` のフローチャートノード内「📍」を削除（`{scene.location || '場所未指定'}`）。
- 背景画像ピッカーボタンの「🖼」を削除（`{selectedScene.background_image_id ? '背景画像設定済' : '背景画像選択'}`）。
- ランダム表エディタの見出し「🎲 出目テスト・リアルダイス評価」から絵文字を削除し「出目テスト・リアルダイス評価」に変更。
- ランダム表の警告バナー「⚠️ 範囲の警告があります:」から絵文字を削除し「範囲の警告があります:」に変更。
- シーン詳細エディタの手がかり（`🔑`）、ハンドアウト（`📜`）、エンカウンター（`⚔️`）から絵文字を削除。
- 閉じるボタン（「✕」）は指摘どおり保持。
- プロジェクト内を検索し、新規作成部分に不要な絵文字が残っていないことを確認。

### 2. 値に見える入力例の修正
- **推奨人数**: `placeholder="3-4"` を削除（空欄化）。ラベルを「推奨人数（人）」に変更。
- **想定時間**: `placeholder="3"` を削除（空欄化）。ラベルを「想定時間（時間）」に変更。
- **報酬目安**: `placeholder="500eb + 武器1点"` を削除（空欄化、金額の作り話を排除）。
- **場所**: `placeholder="例: リトル・チャイナのアフターライフ"` を削除（空欄化）。

### 3. フローチャートの全体表示・拡大縮小・分岐文字の修正
- **全体を表示ボタン**: ツールバーに「全体を表示」ボタン（`data-testid="btn-fit-flowchart"`）を追加。
- **拡大・縮小コントロール**: 拡大（`+`）、縮小（`-`）、現在のズーム率（`%`）を追加。
- **自動フィッティング (`fitToView`)**:
  - シナリオ内の全シーンノードの座標範囲（Bounding Box）を計算し、キャンバス領域に適切な余白（padding: 40px）をつけて全ノードが完全に収まるよう `zoom` と `pan` を自動計算。
  - シナリオ読み込み時および雛形生成時に自動的に実行され、画面右端で第 5 ノード（「報酬」）が切れる問題を解消。
  - 背景ドラッグによるキャンバスのパン操作、およびズーム状態に対応したノードドラッグ（`getSvgCanvasPoint`）を実装。
- **分岐条件文字の修正**:
  - `link.condition` が空または空白文字の場合は、テキスト要素（バッジ）を一切描画しないよう修正。「条件なし」という文字がノードに重なる問題を解消。
  - 条件が設定されている場合のみ、ベジェ曲線の中心点（`midX`, `midY - 6`）に視認性の高いアウトライン付きテキストを描画。

### 4. スマホ幅（390px）での GM 下部タブ対応
- `GmPage.tsx` に `isMobile`（`window.innerWidth <= 640`）状態およびリサイズ監視を実装。
- SPEC §5.0「スマホでは下部タブにする」に従い、390px 幅ではヘッダー内のタブ（PC, 戦闘, シナリオ, 商店, 技能, DB）を非表示化。
- 上部ヘッダーは `CYBERPGM GM` ロゴと「参加用 QR」「保存・読込」ボタンをコンパクトに 1 行で配置し、文字の縦折り返しやはみ出しを解消。
- 画面最下部に固定のボトムナビゲーションバー（`data-testid="gm-bottom-nav"`）を配置。6 つのタブ（`PC`, `戦闘`, `シナリオ`, `商店`, `技能`, `DB`）を等幅で並べ、アクティブタブの上部にシアンのインジケーターを表示。
- メインコンテナに `paddingBottom: 56px` を付与し、ボトムバーによるコンテンツの隠れを防止。

---

## 2. スクリーンショット

### 1. フローチャートの「全体を表示」とシーン編集 (1440px)
全 5 ノード（「依頼」「調査」「潜入」「戦闘」「報酬」）がキャンバス内に完全に収まり、入力例の空欄化とラベル単位表記、絵文字なし、分岐矢印のクリーンな表示を確認。

![フローチャート全体表示 (1440px)](/docs/agy/reports/img/phase5a-scenario-flowchart-1440.png)

### 2. スマホ幅（390px）のシーン一覧と GM 下部タブ
上部ヘッダーの折り返しが解消され、画面下部に GM タブ（PC, 戦闘, シナリオ, 商店, 技能, DB）が固定表示されていることを確認。

![390px GM下部タブ](/docs/agy/reports/img/phase5a-scenario-mobile-390.png)

### 3. ランダム表 (1440px)
絵文字が排除された「出目テスト・リアルダイス評価」と出目評価結果を確認。

![ランダム表 (1440px)](/docs/agy/reports/img/phase5a-scenario-random-table-1440.png)

---

## 3. 項目ごとのテスト名

### 1. フローチャート全体表示・拡大縮小・分岐文字
- **E2E テスト (`e2e/scenario-maker.spec.ts`)**:
  - `Phase 5a Scenario Maker E2E: Template creation, scene editing, choice with DV guideline, flowchart interaction, persistence & screenshots`:
    - 雛形生成後の全 5 シーンノード（依頼、調査、潜入、戦闘、報酬）の SVG 可視性検証
    - 「全体を表示」ボタン（`data-testid="btn-fit-flowchart"`）のクリック検証
    - 「条件なし」テキストが描画されないことの検証（`page.locator('text=条件なし').toHaveCount(0)`）
    - 絵文字「📍」が描画されないことの検証（`page.locator('text=📍').toHaveCount(0)`）
    - ノードドラッグ移動と画面リロード後の座標永続化検証
- **サーバー単体テスト (`apps/server/test/scenario.test.ts`)**:
  - `POST /api/scenarios with use_template creates 5 scenes and 4 links with empty texts`
  - `PATCH /api/scenarios/scenes/:sceneId updates scene properties`

### 2. 値に見える入力例の修正
- **E2E テスト (`e2e/scenario-maker.spec.ts`)**:
  - 推奨人数（人）、想定時間（時間）、報酬目安の空欄入力検証
- **サーバー単体テスト (`apps/server/test/scenario.test.ts`)**:
  - `POST /api/scenarios creates new scenario with meta`

### 3. 絵文字の排除
- **E2E テスト (`e2e/scenario-maker.spec.ts`)**:
  - フローチャート上で絵文字「📍」が 0 件であることの検証
  - ランダム表上で絵文字「🎲」が 0 件であることの検証
  - 見出し「出目テスト・リアルダイス評価」の表示検証

### 4. 390px スマホ幅 GM 下部タブ
- **E2E テスト (`e2e/scenario-maker.spec.ts`)**:
  - ビューポート 390px 幅での GM 下部ナビゲーションバー（`data-testid="gm-bottom-nav"`）の表示検証
  - 下部ナビゲーション内のタブボタン（`gm-tab-scenario`, `gm-tab-combat` など）の可視性検証
- **既存の GM E2E テスト（タブ操作の互換性確認）**:
  - `e2e/combat.spec.ts`: `Combat E2E: Participant Check, Initiative, Player Attack via Mobile, GM Apply, and Undo`
  - `e2e/board-combat.spec.ts`: `Phase 4b Board Combat E2E: 30x30 board, movement with BFS, shooting LoS with cover, separate window, TV view without enemy HP`
  - `e2e/shop.spec.ts`: `Shop E2E: GM sets Heavy Pistol for Viper, reflected on Player Sheet via me:update and notify`
  - `e2e/session.spec.ts`: `Session E2E: GM direct access (no PIN), player QR join, and real-time fund notification flow`
  - `e2e/character-creation.spec.ts`: `Character Creation E2E: Player creates character on mobile, submits to GM, GM accepts in reception, and checks skills`

---

## 4. 検証結果

- **`npm run typecheck`**: エラー 0 件で合格
- **`npm run lint`**: エラー 0 件で合格（既存の warning のみ）
- **`npm test`**: 25 テストファイル、159 テスト全件合格
- **`npx playwright test`**: 6 テストスイート全件合格

---

## 5. 遵守事項・補足

- テスト用に起動している `npm start`（ポート 8787）は停止せず、一切触れていません（E2E は独立したポート 8788 で実行）。
- 本番の `data/cyberpgm.db`（マイグレーションや画像登録）には一切触れていません。
- 本物の書籍スキャン画像（`data/images/book_scan/`）には一切触れていません。
