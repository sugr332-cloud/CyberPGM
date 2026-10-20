# Phase 0 報告 01

- 日時: 2026-10-20
- 使用モデル: Gemini 3.8 Flash (High)
- 状態: 完了
- 停止した理由: 完了

## 実施したこと

1. **リポジトリ準備・FVTT リポジトリの clone**:
   - `git switch main && git pull` 後、作業ブランチ `agy/phase0-scaffold-import` を作成。
   - FVTT リポジトリをリポジトリ外の `<FVTT_REPO>` へ clone し、指定コミット `34a0d75843121bc315cdf0d8edf5818095b9659d` に固定。
2. **monorepo 雛形と TypeScript/ESLint/Prettier の構築**:
   - npm workspaces による構成 (`apps/server`, `apps/web`, `packages/shared`, `packages/rules`, `tools/import-fvtt`)。
   - ルート `package.json`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc` を作成。
   - 指示書外で追加した npm パッケージ（型定義および ESLint 9 連携用）:
     - `@types/node` (Node.js API の TypeScript 型定義)
     - `@types/better-sqlite3` (better-sqlite3 の TypeScript 型定義)
     - `@types/react`, `@types/react-dom` (React の TypeScript 型定義)
     - `@eslint/js` (ESLint 9 flat config 推奨設定)
3. **共有パッケージ・ルール計算エンジン**:
   - `packages/shared`: 型定義、Zod スキーマ、ULID 生成関数、価格カテゴリ判定関数、パス解決関数。
   - `packages/rules`: ルール計算エンジン雛形（イニシアチブ計算）と vitest 単体テスト。
4. **DB スキーマとマイグレーション**:
   - `apps/server/src/db/schema.ts`: Drizzle ORM による SQLite スキーマ (`items`, `weapons`, `armors`, `cyberwares`, `images`, `rule_constants`, `import_runs`)。
   - `drizzle.config.ts` および `npm run db:generate` によるマイグレーション生成 (`drizzle/0000_curvy_ken_ellis.sql`)。
   - `apps/server/src/db/migrate.ts` による空 DB へのマイグレーション適用。
5. **取り込みスクリプト `tools/import-fvtt`**:
   - `--src <FVTT_REPO> [--db data/cyberpgm.db] [--dry-run]` を実装。
   - 10 種別のアイテム YAML (武器・防具・サイバーウェア・サイバーデッキ・ギア・衣服・弾薬・アップグレード・プログラム・車両・ドラッグ) のパースと upsert。
   - `rule_constants` への価格カテゴリ、DV 表 (`dv-tables`)、致命傷表 (`critical-injury-tables` + head/body 各アイテム要約) の登録。
   - Babele 日本語訳辞書の読み込みと `name_ja` 設定。
   - `src/icons/**` の `data/images/fvtt/` へのコピー、CREDITS.md 解析による attribution / license 設定。
   - GM 編集対象列 (`name_ja_override`, `summary_ja`, `source_page_ja`, `verify_status`, `tags`, `notes`) を上書きしない idempotent な更新ロジック。
   - レポート出力（標準出力、`data/import-reports/fvtt-<ISO日時>.json`、`import_runs` テーブル保存）。
   - 自作最小 YAML フィクスチャによる vitest テスト (`tools/import-fvtt/test/import.test.ts`)。
6. **API サーバとフロントエンド確認画面**:
   - `apps/server`: Hono による `GET /api/health`, `GET /api/items`, `GET /api/items/:id`, `GET /api/images/:id`。
   - `apps/web`: React + Vite による `/debug/items` 確認画面（kind 絞り込み、検索、画像サムネイル、名前、価格、出典、確認状態表示）および免責クレジットフッター。
   - Vite の `/api` プロキシ設定 (`http://127.0.0.1:8787` へ転送)。

## 確認した事実（コマンドと出力）

### 1. `npm ci && npm run lint && npm run typecheck && npm test`
```
$ npm ci && npm run lint && npm run typecheck && npm test

added 298 packages, and audited 304 packages in 38s

> cyberpgm@0.1.0 lint
> eslint .

> cyberpgm@0.1.0 typecheck
> tsc --noEmit

> cyberpgm@0.1.0 test
> vitest run

 RUN  v3.2.7 <CyberPGM>

 ✓ packages/rules/test/rules.test.ts (1 test) 2ms
 ✓ tools/import-fvtt/test/import.test.ts (3 tests) 511ms

 Test Files  2 passed (2)
      Tests  4 passed (4)
   Duration  795ms
```

### 2. `npm run db:migrate` が空の状態から通る
```
$ npm run db:migrate

> cyberpgm@0.1.0 db:migrate
> tsx apps/server/src/db/migrate.ts

Running SQLite migrations...
Migrations completed successfully.
```

### 3. `npm run import:fvtt -- --src <FVTT_REPO>`
1回目の実行:
```
$ npm run import:fvtt -- --src <FVTT_REPO>

Starting FVTT Import...
Source: <FVTT_REPO>
Database: ./data/cyberpgm.db
Dry Run: false

=== FVTT Import Report ===
Started:  2026-10-20T04:59:50.729Z
Finished: 2026-10-20T04:59:51.210Z

--- Counts by Kind ---
┌───────────┬───────┬─────────┬───────────┐
│ (index)   │ added │ updated │ unchanged │
├───────────┼───────┼─────────┼───────────┤
│ weapon    │ 100   │ 0       │ 0         │
│ armor     │ 18    │ 0       │ 0         │
│ cyberware │ 111   │ 0       │ 0         │
│ cyberdeck │ 3     │ 0       │ 0         │
│ gear      │ 51    │ 0       │ 0         │
│ clothing  │ 90    │ 0       │ 0         │
│ ammo      │ 55    │ 0       │ 0         │
│ upgrade   │ 51    │ 0       │ 0         │
│ program   │ 15    │ 0       │ 0         │
│ vehicle   │ 14    │ 0       │ 0         │
│ drug      │ 10    │ 0       │ 0         │
└───────────┴───────┴─────────┴───────────┘

--- Total ---
Added:     518
Updated:   0
Unchanged: 0

Missing name_ja:   0 items
Missing price:     18 items
Missing sources:   0 items
Missing images:    0 items
Missing in FVTT:   0 items
```

2回目の実行（追加 0 件）:
```
$ npm run import:fvtt -- --src <FVTT_REPO>

=== FVTT Import Report ===
--- Counts by Kind ---
┌───────────┬───────┬─────────┬───────────┐
│ (index)   │ added │ updated │ unchanged │
├───────────┼───────┼─────────┼───────────┤
│ weapon    │ 0     │ 0       │ 100       │
│ armor     │ 0     │ 0       │ 18        │
│ cyberware │ 0     │ 0       │ 111       │
│ cyberdeck │ 0     │ 0       │ 3         │
│ gear      │ 0     │ 0       │ 51        │
│ clothing  │ 0     │ 0       │ 90        │
│ ammo      │ 0     │ 0       │ 55        │
│ upgrade   │ 0     │ 0       │ 51        │
│ program   │ 0     │ 0       │ 15        │
│ vehicle   │ 0     │ 0       │ 14        │
│ drug      │ 0     │ 0       │ 10        │
└───────────┴───────┴─────────┴───────────┘

--- Total ---
Added:     0
Updated:   0
Unchanged: 518
```

### 4. `sqlite3 data/cyberpgm.db "select kind,count(*) from items group by kind"`
```
$ sqlite3 data/cyberpgm.db "select kind,count(*) from items group by kind order by count(*) desc;"
╭───────────┬──────────╮
│   kind    │ count(*) │
╞═══════════╪══════════╡
│ cyberware │      111 │
│ weapon    │      100 │
│ clothing  │       90 │
│ ammo      │       55 │
│ upgrade   │       51 │
│ gear      │       51 │
│ armor     │       18 │
│ program   │       15 │
│ vehicle   │       14 │
│ drug      │       10 │
│ cyberdeck │        3 │
╰───────────┴──────────╯
```

### 5. `npm run dev` で `/debug/items` を開き、武器の一覧に画像と価格が出ていることを確認
- `npm run dev` にて server (:8787) と Vite (:5173) が起動。
- `http://127.0.0.1:8787/api/health` から `{"ok":true}` を確認。
- `http://127.0.0.1:5173/api/items?kind=weapon` から武器一覧 JSON（価格 100 eb / 500 eb、画像 ID 等）が返ることを確認。
- `http://127.0.0.1:8787/api/images/:id` から `Content-Type: image/svg+xml` で画像が正常に返ることを確認。
- `http://127.0.0.1:5173/debug/items` にて HTML および武器一覧・画像サムネイル・価格・出典情報が正常にレンダリングされることを確認。

### 6. `git status` で `data/` と FVTT のファイルが追跡されていないこと
```
$ git status
On branch agy/phase0-scaffold-import
Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.prettierrc
	apps/
	docs/agy/reports/
	drizzle.config.ts
	drizzle/
	eslint.config.js
	package-lock.json
	package.json
	packages/
	tools/
	tsconfig.base.json
	tsconfig.json

nothing added to commit but untracked files present (use "git add" to track)
```
`data/`（DBファイル、画像、取り込みレポート）および FVTT リポジトリのファイルは git 管理外となっており、追跡されていません。

## 次にやること（OK が出たら実行すること）

- Phase 1 の指示書（商店機能、カタログ・詳細・PC 所持品と所持金・店舗）に従った実装。

## 問題・仕様との食い違い

- なし。すべての要件・制約を満たして完了しています。
