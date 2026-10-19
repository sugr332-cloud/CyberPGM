# Phase 0 指示書: リポジトリ雛形と FVTT データ取り込み

- 作成: 2026-10-20（Claude）
- 作業ブランチ: `agy/phase0-scaffold-import`
- 報告: `docs/agy/reports/phase0-scaffold-import-<連番>.md`
- 前提として読むもの: `docs/SPEC.md`（特に §3 権利、§4 構成、§6 データモデル、§8 取り込み）、`docs/agy/README.md`

## ゴール

1. TypeScript の monorepo 雛形があり、`npm run dev` でサーバとフロントエンドが起動する
2. SQLite のスキーマ（Drizzle）があり、マイグレーションで DB を作れる
3. `npm run import:fvtt -- --src <FVTT_REPO>` で FVTT のデータ約 700 件が DB に入り、取り込みレポートが出る
4. フロントエンドに、取り込んだアイテムを一覧表示するだけの確認画面がある（本格的な商店 UI は Phase 1）

## 0. 準備

```
git switch main && git pull
git switch -c agy/phase0-scaffold-import
```

FVTT リポジトリはリポジトリの **外** に clone し、指示書のコミットに固定する。

```
git clone https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core.git <FVTT_REPO>
git -C <FVTT_REPO> checkout 34a0d75843121bc315cdf0d8edf5818095b9659d
```

環境: Node.js v24 / npm 11（LivingPC にインストール済み）。pnpm や yarn は使わない。

## 1. ディレクトリ構成

npm workspaces で構成する。

```
/
├─ package.json            # workspaces, 共通スクリプト
├─ tsconfig.base.json      # strict: true
├─ eslint.config.js / .prettierrc
├─ apps/
│   ├─ server/             # Hono + @hono/node-server + Drizzle + better-sqlite3
│   │   └─ src/{index.ts, db/schema.ts, db/client.ts, routes/items.ts}
│   └─ web/                # React + Vite + TypeScript
│       └─ src/{main.tsx, App.tsx, pages/ItemsDebug.tsx}
├─ packages/
│   ├─ shared/             # 型・zod スキーマ（API の入出力。server と web で共有）
│   └─ rules/              # ルール計算（Phase 0 は雛形と vitest のサンプルテスト 1 本だけ）
├─ tools/
│   └─ import-fvtt/        # 取り込みスクリプト（tsx で実行）
├─ drizzle/                # マイグレーション SQL（commit する）
└─ data/                   # git 管理外: cyberpgm.db, images/, backups/
```

使うパッケージ（これ以外を追加するときは報告に書く）:
`hono`, `@hono/node-server`, `drizzle-orm`, `drizzle-kit`, `better-sqlite3`, `zod`, `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`, `tsx`, `vitest`, `eslint`, `typescript-eslint`, `prettier`, `yaml`, `concurrently`

## 2. ルートの npm スクリプト

| スクリプト | 内容 |
|---|---|
| `dev` | server（:8787）と web（Vite :5173、`/api` を server へプロキシ）を同時に起動する |
| `build` | 全ワークスペースをビルドする |
| `lint` / `typecheck` / `test` | ESLint / `tsc --noEmit` / vitest |
| `db:generate` / `db:migrate` | drizzle-kit でマイグレーションを生成・適用する（DB: `data/cyberpgm.db`） |
| `import:fvtt` | `tsx tools/import-fvtt/src/index.ts` |

- サーバの待ち受けは既定で `127.0.0.1`。環境変数 `HOST` で変えられるようにするが、Phase 0 では変えない（0.0.0.0 にするのは「止まる場面 2」）
- 開発中の Vite も `127.0.0.1` で待ち受ける

## 3. DB スキーマ（Phase 0 で作る範囲）

docs/SPEC.md §6 のうち、次のテーブルだけを作る。キャラクター、店舗、シナリオ、戦闘は後のフェーズで追加する。

**items**（共通）
| 列 | 型 | 備考 |
|---|---|---|
| id | text PK | ULID などで生成する |
| kind | text | weapon / armor / cyberware / cyberdeck / gear / clothing / ammo / upgrade / program / vehicle / drug |
| name_en | text | FVTT の `name` |
| name_ja | text null | babele の訳 |
| name_ja_override | text null | GM が手で直した訳（取り込みでは上書きしない） |
| summary_ja | text null | GM が書く要約（取り込みでは触らない） |
| description_en | text null | FVTT の `system.description.value`（HTML のまま。**GM の画面でだけ表示する**参考情報） |
| price_eb | integer null | `system.price.market` |
| price_category | text null | price_eb と rule_constants の価格カテゴリから計算する |
| source_book | text null | `system.sources[0].book` |
| source_page_en | integer null | `system.sources[0].page` |
| source_page_ja | integer null | GM が入力する（取り込みでは上書きしない） |
| origin | text | fvtt / manual / homebrew |
| verify_status | text | official_verified / unofficial / unverified / homebrew。取り込みの初期値は unofficial（取り込みでは上書きしない） |
| fvtt_id | text unique null | FVTT の `_id` |
| fvtt_type | text null | FVTT の `type` |
| raw_system | text(JSON) | FVTT の `system` をそのまま保存する（後のフェーズで列を増やすときの元データ） |
| tags | text(JSON) | `[]` |
| notes | text null | |
| created_at / updated_at | integer | |

**weapons**（item_id FK）: weapon_type, skill, damage, rof, magazine_max, hands, concealable(bool), quality, autofire(int), crit_fail_effect, dv_table_key, ammo_types(JSON), is_ranged(bool)

**armors**（item_id FK）: sp_head, sp_body, is_head(bool), is_body(bool), is_shield(bool), shield_hp, penalty

**cyberwares**（item_id FK）: cw_type, install_location, humanity_loss_roll, humanity_loss_static, is_core(bool), slot_size

**images**: id, item_id FK null, path（`data/images/` からの相対パス）, origin（book_scan / user / fvtt_icon）, license, attribution, source_book, source_page, visibility（gm / players）, is_primary(bool)

**rule_constants**: key PK, value(JSON), source_page_ja null, note

**import_runs**: id, source, source_commit, started_at, finished_at, report(JSON)

## 4. 取り込みスクリプト `tools/import-fvtt`

引数: `--src <FVTT_REPO>`（必須）、`--db data/cyberpgm.db`（既定）、`--dry-run`

### 4.1 読むもの

| FVTT のパス | 行き先 |
|---|---|
| `src/packs/core/{weapons,armor,cyberware,gear,clothing,ammo,upgrades,programs,vehicles,drugs}/*.yaml` | items と各サブテーブル |
| `src/packs/internal/dv-tables/*.yaml` | rule_constants `dv_table.<key>`（`results[].range` と `description` の DV） |
| `src/packs/internal/critical-injury-tables/*.yaml` と `src/packs/core/critical-injuries-{head,body}/*.yaml` | rule_constants `critical_injury.head` / `critical_injury.body`（出目の範囲、名称、効果の要約。説明文は英語のまま `note` に入れる） |
| `src/babele/ja-JP/cyberpunk-red-core.core_<pack>.json` | `entries[<英語名>].name` → name_ja |
| `src/icons/**` | `data/images/fvtt/` へコピーし、images に登録（origin=fvtt_icon） |
| `CREDITS.md` | アイコンのライセンス・作者を images.license / attribution に設定（判定できないものは `see CREDITS.md`） |

- `skills-*`、`roles`、`packs/other` は Phase 0 では取り込まない
- FVTT の `type` と kind の対応: weapon→weapon, armor→armor, cyberware→cyberware, cyberdeck→cyberdeck, gear→gear, clothing→clothing, ammo→ammo, itemUpgrade→upgrade, program→program, vehicle→vehicle, drug→drug
- `img` の `systems/cyberpunk-red-core/` は `<FVTT_REPO>/src/` に読み替える

### 4.2 書き込みのルール

- キーは `fvtt_id`。既にあれば更新し、なければ追加する（upsert）
- 更新のとき、**GM が編集する列は上書きしない**: name_ja_override, summary_ja, source_page_ja, verify_status, tags, notes、origin が fvtt_icon 以外の images
- FVTT から消えた品目は削除せず、レポートに「FVTT 側に存在しない」として列挙する
- 全体を 1 トランザクションで行う。`--dry-run` ではロールバックしてレポートだけ出す
- 価格カテゴリの初期値を rule_constants `price_category` に入れる（既にあれば上書きしない）:
  `[{max:10,key:"cheap"},{max:20,key:"everyday"},{max:50,key:"costly"},{max:100,key:"premium"},{max:500,key:"expensive"},{max:1000,key:"very_expensive"},{max:5000,key:"luxury"},{max:null,key:"super_luxury"}]`
  表示名（日本語）は GM が後で入れるので、`label_ja` は空にしておく

### 4.3 レポート

標準出力と `data/import-reports/fvtt-<日時>.json` に出し、import_runs にも保存する。

- 種類ごとの件数（追加 / 更新 / 変更なし）
- name_ja がない品目の一覧
- price が null または 0 の品目の一覧
- sources がない品目の一覧
- 画像ファイルが見つからなかった品目の一覧
- FVTT 側に存在しない品目の一覧

### 4.4 テスト（vitest）

`tools/import-fvtt/test/fixtures/` に **自作の最小 YAML**（武器 1・防具 1・サイバーウェア 1。数値は架空でよい。FVTT のファイルはコピーしない）を置き、次を確認する。

- 変換結果が期待する列の値になる
- 2 回実行しても件数が増えない
- name_ja_override などの GM 編集列が 2 回目で上書きされない

## 5. API と確認画面

- `GET /api/health` → `{ok:true}`
- `GET /api/items?kind=&q=&limit=&offset=` → 一覧（name_en / name_ja / name_ja_override の部分一致検索）
- `GET /api/items/:id` → 詳細（サブテーブルと images を含む）
- `GET /api/images/:id` → 画像ファイルを返す。**visibility=gm の画像は、Phase 0 では返してよいが TODO コメントを残す**（認証は Phase 1）
- web: `/debug/items` に、kind での絞り込み、検索、表（画像サムネイル・名前（日本語/英語）・価格・出典ページ）を出す。見た目は最低限でよい
- フッターに README の RTG 免責表示と「Icons: game-icons.net ほか (CC-BY), data: fvtt-cyberpunk-red-core (GPLv3)」を出す

## 6. 完了条件（報告に出力を貼る）

1. `npm ci && npm run lint && npm run typecheck && npm test` が通る
2. `npm run db:migrate` が空の状態から通る
3. `npm run import:fvtt -- --src <FVTT_REPO>` の 1 回目のレポート（種類ごとの件数）。2 回目で「追加 0」になること
4. `sqlite3 data/cyberpgm.db "select kind,count(*) from items group by kind"` の出力
5. `npm run dev` で `/debug/items` を開き、武器の一覧に画像と価格が出ていることを確認した旨（スクリーンショットは不要）
6. `git status` で `data/` と FVTT のファイルが追跡されていないこと

## 7. やらないこと

- 商店・戦闘・シナリオの UI（Phase 1 以降）
- 認証、PWA、systemd 化
- FVTT の YAML・アイコンのリポジトリへのコピー（`data/` に入れるのは可、commit は不可）
- ルールブックの本文の入力
