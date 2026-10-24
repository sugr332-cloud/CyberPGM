# phase6i-db-io 報告 01

- 日時: 2026-10-24
- 使用モデル: Gemini 3.8 Flash (High)
- 状態: 完了（Codex 監査指摘事項の改修・検証完了）
- 停止した理由: 完了

---

## 1. 実施概要

CyberPGM Issue #36（DBの全エンティティのCSV/JSON入出力、確認状態の一括変更、未確認品の一覧）の実装、および Codex 監査に基づく非破壊 Upsert / 厳格バリデーションへの修正・回帰テストの拡充を完了しました。
`docs/SPEC.md` §5.4・§10、既存スキーマおよびアーキテクチャに準拠し、以下の機能を設計・実装・テストしました。

### A. DB 全エンティティ（40テーブル）の CSV / JSON 入出力
- **対象テーブル**: `items`, `weapons`, `armors`, `cyberwares`, `images`, `rule_constants`, `import_runs`, `players`, `characters`, `devices`, `money_log`, `char_log`, `saves`, `app_settings`, `shops`, `shop_stock`, `transactions`, `purchase_requests`, `character_submissions`, `skill_notes`, `boards`, `board_objects`, `board_tokens`, `board_drops`, `combats`, `combat_participants`, `combat_log`, `scenarios`, `scenario_versions`, `scenes`, `scene_links`, `scene_choices`, `clues`, `handouts`, `encounters`, `random_tables`, `scenario_sessions`, `session_log`, `story_checks`, `audio` の計40エンティティ。
- **エンドポイント**:
  - `GET /api/db/entities`: 全テーブル一覧、レコード件数、カラム定義（型・必須・PK）、外部キー参照関係を返却。
  - `GET /api/db/export/:entity?format=json|csv`: 単一エンティティの全データを JSON または RFC 4180 準拠 CSV でエクスポート。
  - `GET /api/db/export-all`: 全エンティティの全レコードを包括した JSON ダンプを出力。
  - `POST /api/db/import/:entity`: 単一エンティティへ JSON または CSV データをインポート。
  - `POST /api/db/import-all`: 全エンティティを一括インポート。
- **入力検証・整合性・アトミック性の担保**:
  - `PRAGMA table_info` および `PRAGMA foreign_key_list` を活用したスキーマ同期型バリデーション。
  - **形式・オブジェクト検証**: RFC 4180 CSV（引用符エスケープ・改行対応）および JSON 構造をパース検証。非オブジェクト行（配列やプリミティブ）は 400 で即時拒否。
  - **未知のカラム拒否**: テーブル定義に存在しないカラムが含まれている場合は無視せず HTTP 400 で拒否し、行番号とカラム名を特定。
  - **必須項目検証**: `notnull === 1` かつデフォルト値なしのカラムの欠損・空文字を検出し、行番号とカラム名を特定して拒否。
  - **型検証**: `INTEGER`, `REAL` 等の数値カラムへの不正値入力を検出。
  - **参照整合性検証**: 外部キー（Foreign Key）参照先のテーブル・列に対応するレコードが存在するか検証。ダングリングポインタを防止。
  - **アトミック性（部分更新の完全防止）**: 検証エラーが1件でもあればインポートを即座に中断し、エラー一覧を返却。書き込みは `sqlite.transaction` 内でアトミックに実行され、例外時は自動ロールバックされるため、データが中途半端に部分更新されることは一切ありません。
  - **非破壊 Upsert（Codex 監査対応）**:
    - SQLite の `INSERT OR REPLACE` は競合時に既存行を内部的に DELETE してから再 INSERT するため、親行更新時に子行（`weapons`, `armors`, `cyberwares`）が失われる危険性がありました。
    - これを完全に解消するため、`INSERT ... ON CONFLICT(primary-key columns) DO UPDATE SET col = excluded.col` に改修しました。
    - 主キー列は `PRAGMA table_info` の `pk > 0` を `pk` 順序付きで取得・特定し、更新対象は入力された非主キー列のみに限定。
    - 主キーのないテーブルは標準の `INSERT` のみとし、制約違反時はトランザクション全体をロールバックします。
    - 主キー以外の UNIQUE 制約競合時もトランザクション全体がロールバックされエラーとなります。

### B. 確認状態の一括変更（Bulk verify_status update）
- **対象**: `items` テーブルの `verify_status`（許容4値: `official_verified` | `unofficial` | `unverified` | `homebrew`）。
- **エンドポイント**: `POST /api/db/items/bulk-verify`
  - 複数アイテムの ID 配列（`item_ids`）と変更先ステータスを受け取り、トランザクション内で一括更新。
  - 変更件数とステータスを返却。未定義のステータス値は 400 エラーで拒否。

### C. 未確認品の一覧（Unverified items list）
- **エンドポイント**: `GET /api/db/unverified-items`
  - `verify_status = 'unverified'` の品目を抽出。
  - 種別（`kind`）絞り込み、キーワード検索（日英品名）、ページネーションに対応。
  - 全体の未確認件数および種別ごとの未確認件数をサマリーとして返却。

### D. GM画面 DB タブ UI 実装
- `apps/web/src/pages/GmPage.tsx` のプレースホルダーであった DB タブに、専用コンポーネント `DbAdminTab` を統合。
- **サブタブ 1: 未確認品一覧 & 一括確認**:
  - 種別ドロップダウンフィルター、品名検索バー、未確認品サマリーバッジ。
  - 全選択 / 個別選択チェックボックス。
  - 1件以上選択時に表示される一括変更アクションバー（「公式確認済み」「非公式」「GM独自」）。
  - 各行のクイックステータス変更ボタン。
- **サブタブ 2: 全エンティティ入出力**:
  - 全40テーブルのレコード件数付きサイドリスト。
  - 単一エンティティの JSON / CSV エクスポートボタン（ブラウザからの即時ファイルダウンロード）。
  - 全テーブル一括エクスポート (JSON) ボタン。
  - カラム定義、必須フラグ、外部キー参照先の一覧表示。
  - JSON / CSV のファイル選択・ドラッグ＆ドロップ読込・テキスト貼り付け対応のインポートエディタ。
  - 検証エラー時の赤枠・詳細リスト表示、成功時のメッセージ表示。
- **レスポンシブ対応**: PC 幅（1440px）およびスマホ幅（390px）の両方で破綻なく操作可能。

---

## 2. 変更内容一覧

| 変更ファイル | 変更内容 |
| :--- | :--- |
| `packages/shared/src/csv.ts` | **新規**: RFC 4180 準拠の CSV シリアライザ（`exportToCsv`）およびパーサ（`parseCsv`）の実装。外部 npm パッケージ追加なし。 |
| `packages/shared/src/index.ts` | `csv.ts` のエクスポートを追加。 |
| `packages/shared/test/csv.test.ts` | **新規**: CSV エスケープ・パース・配列変換の単体テスト（4 tests）。 |
| `apps/server/src/routes/db-admin.ts` | **新規/改修**: DB 管理 API。<br>1. 全40エンティティ一覧・単一/一括エクスポート・インポート・未確認品一覧・一括確認更新。<br>2. **Codex監査対応**: `INSERT OR REPLACE` を廃止し、`PRAGMA table_info` から順序付き主キー列を特定した `INSERT ... ON CONFLICT(pk) DO UPDATE SET` へ改修（入力非PK列のみ更新、PKなしテーブルは標準INSERT）。<br>3. **Codex監査対応**: 未知のカラムおよび非オブジェクト行を HTTP 400 で拒否するバリデーションを追加。 |
| `apps/server/src/index.ts` | `dbAdminRoutes` を `/api/db` にマウント。 |
| `apps/server/test/db-admin.test.ts` | **新規/拡充**: DB 管理 API の総合テスト（計10 tests）。<br>- 全40エンティティ取得・メタデータ検証<br>- JSON/CSV 単一エクスポート<br>- JSON/CSV 単一インポート<br>- 必須列欠損時の 400 検証およびアトミックロールバック（部分更新なし）<br>- 未知のカラム・非オブジェクト行の 400 拒否およびロールバック<br>- **Codex監査対応回帰テスト（単一インポート）**: 親 `items` 行の更新時に、子 `weapons`・`armors`・`cyberwares` の 3 テーブルすべての既存行が削除されず保持されることの実証検証<br>- 外部キー参照整合性エラーの検出とロールバック<br>- 未確認品一覧・種別絞り込み・検索<br>- 一括ステータス更新 (`bulk-verify`)<br>- **Codex監査対応回帰テスト（一括インポート）**: 全テーブル一括エクスポート・インポート時に、親 `items` 行更新後も子 `weapons`・`armors`・`cyberwares` の 3 テーブルすべての既存行が削除されず保持されることの実証検証、および未知カラム時の 400 拒否とロールバック検証 |
| `apps/web/src/api.ts` | DB 管理用の API クライアント関数およびインターフェース（`getDbEntities`, `exportAllDb`, `getUnverifiedItems`, `bulkVerifyItems`, `importDbEntity`, `importAllDb`）を追加。 |
| `apps/web/src/components/DbAdminTab.tsx` | **新規**: GM 画面の DB タブ用コンポーネント（未確認品一覧・一括変更・全エンティティ一覧・CSV/JSON入出力エディタ）。 |
| `apps/web/src/pages/GmPage.tsx` | DB タブプレースホルダーを `DbAdminTab` に差し替え。 |
| `e2e/phase6i.spec.ts` | **新規**: Phase 6i の E2E 回帰テスト（GM画面での未確認品一覧、UIチェックボックス一括更新、全エンティティ入出力タブ操作）。 |
| `tools/capture-phase6i-screenshots.ts` | **新規**: 承認用スクリーンショット（1440px / 390px）の自動撮影ツール。 |

---

## 3. 確認した事実（コマンドと出力）

### `npm run lint`
```text
> cyberpgm@0.1.0 lint
> eslint .

✖ 779 problems (0 errors, 779 warnings)
```
- エラー 0 件で正常終了。

### `npm run typecheck`
```text
> cyberpgm@0.1.0 typecheck
> tsc --noEmit
```
- 全ワークスペースで型エラー 0 件。

### `npm test`（単体・結合テスト結果）
```text
Test Files  1 failed | 50 passed (51)
     Tests  2 failed | 348 passed (350)
```
- **Phase 6i 新規・拡充テスト**:
  - `apps/server/test/db-admin.test.ts` (10 tests) : **全件成功 (10 passed)**
    - 単一インポート (`POST /api/db/import/items`) での `weapons`, `armors`, `cyberwares` 子行保持検証: **成功**
    - 一括インポート (`POST /api/db/import-all`) での `weapons`, `armors`, `cyberwares` 子行保持検証: **成功**
  - `packages/shared/test/csv.test.ts` (4 tests) : **全件成功 (4 passed)**
- **失敗テストの特定と分析**:
  - 失敗ファイル: `apps/server/test/item-notes.test.ts`
  - 失敗したテスト名:
    1. `Item effect and flavor notes (Phase 5c) > seeds every item from the drafts and marks them as drafts`
       - エラー内容: `AssertionError: expected 1 to be 5` (`apps/server/test/item-notes.test.ts:29`)
    2. `Item effect and flavor notes (Phase 5c) > only GM-edited notes go into the save file`
       - エラー内容: `AssertionError: expected 1 to be less than 0` (`apps/server/test/item-notes.test.ts:94`)
  - **原因**:
    - 本 worktree 内のテスト DB (`data/test-e2e.db`) の初期フィクスチャにおいて、`fvtt_id` を持つアイテムの件数が Phase 5c の初期作成時フィクスチャ（5件）と異なり 1 件であることによる、以前のフェーズ（Phase 5c）由来の既知のベースライン差異です。
    - 指示に従い、無関係な既存テストの修正は行わず、成功件数・失敗件数および対象テスト名をそのまま記録しています。

---

## 4. スクリーンショット

### A. 未確認品一覧 & 一括確認（Unverified Items & Bulk Verify）
- **PC 幅（1440px）**:
  ![未確認品一覧 PC](img/phase6i-db-io-unverified-1440.png)
- **スマホ幅（390px）**:
  ![未確認品一覧 スマホ](img/phase6i-db-io-unverified-390.png)

### B. 全エンティティ入出力（All Entities I/O）
- **PC 幅（1440px）**:
  ![全エンティティ入出力 PC](img/phase6i-db-io-entities-1440.png)
- **スマホ幅（390px）**:
  ![全エンティティ入出力 スマホ](img/phase6i-db-io-entities-390.png)

---

## 5. Codex 監査への対応根拠

1. **非破壊 Upsert の実装**:
   - `INSERT OR REPLACE` から `INSERT ... ON CONFLICT(pk) DO UPDATE SET col=excluded.col` に改修。
   - `PRAGMA table_info` から `pk > 0` を `pk` 昇順で特定し、コンフリクトターゲットに設定。
   - 更新列は入力データに含まれる非主キー列に限定。
   - 主キーのないテーブルは `INSERT` のみとし、衝突時はトランザクション全体をロールバック。
   - これにより、親 `items` 行の更新時に子テーブル（`weapons`, `armors`, `cyberwares`）の行が暗黙に削除されることがなくなりました。
2. **厳格なスキーマ検証**:
   - 未知のカラムや非オブジェクト行が含まれる場合、即座に HTTP 400 エラーを返しトランザクションを中断。
   - 部分更新（一部の正常行だけが保存される状態）が発生しないことを回帰テストで証明。
3. **回帰テストの拡充（子行保持の実証）**:
   - `db-admin.test.ts` にて、単一インポート（`POST /api/db/import/items`）と一括インポート（`POST /api/db/import-all`）の双方で、親アイテムを更新した際に子テーブル 3 種（`weapons`・`armors`・`cyberwares`）の既存行がすべて削除されず完全に保持されることを実証検証しました。
   - 未知カラム・非オブジェクト行の 400 拒否とロールバック検証を追加（計 10 tests）。

---

## 6. 次にやること（OK が出たら実行すること）

- 本修正内容の確認を受け、問題がなければ PR のマージへ進む。
- （※指示に従い、`main` へのマージやプッシュは行わず、`agy/phase6i-db-io` ブランチのみを更新・プッシュします）

---

## 7. 問題・仕様との食い違い（残課題）

- 仕様との食い違いや未決事項はありません。
- 外部 npm パッケージの新規追加は行わず、自作の RFC 4180 パーサで完結しています。
- 破壊的操作は一切行わず、ON CONFLICT DO UPDATE とアトミックトランザクション保護により既存データの安全性を確保しています。
