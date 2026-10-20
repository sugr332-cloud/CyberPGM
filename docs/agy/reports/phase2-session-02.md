# Phase 2 報告 02（レビュー指摘 02 対応）

- 日時: 2026-10-20
- 使用モデル: Gemini 3.8 Flash (High)
- ブランチ: `agy/phase2-session`
- 状態: 完了
- 停止した理由: 完了

---

## 実施したこと（§13 レビュー指摘 02 の 4 点）

### 1. 【最優先】フッターの免責文言およびクレジット修正
- **問題**: 許可を得ていないにもかかわらず「used with permission」と記載されていたため、即座に修正。
- **対応**:
  - `packages/shared/src/disclaimer.ts` に以下の定数を定義:
    - `RTG_DISCLAIMER_EN`: `CyberPGM is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.`
    - `FVTT_CREDITS_JA`: `データ: Cyberpunk RED - Core（Foundry VTT システム、GPLv3）。アイコン: game-icons.net ほか（CC-BY 3.0 など。詳細は CREDITS.md）`
    - `UNOFFICIAL_FAN_NOTE_JA`: `本ツールは非公式のファン作成ツールです。公式のルールブックおよび最新データをご参照ください。`
  - `apps/web/src/components/Footer.tsx`: 定数をインポートして表示するように置き換え（全画面共通）。
  - `README.md`: 同様に RTG Homebrew Content Policy 免責文言および FVTT / アイコンクレジットを同期。

### 2. 技能カタログの生成とキャラシートでの日本語仮訳表示
- **対応**:
  - `tools/gen-skill-catalog/`: FVTT の `src/packs/internal/skills/*.yaml`（全 63 技能）から機械的メタデータ（`key`, `name`, `stat`, `category`, `basic`, `difficulty`, `multiplier`, `sources`, `provisional: true`）を抽出し、RTG Homebrew Content Policy に準拠して説明文を除外したカタログを生成するツールを作成・コミット。
  - ルート `package.json` に `"gen:skills": "tsx tools/gen-skill-catalog/src/index.ts"` を追加し、`npm run gen:skills -- --src <FVTT_REPO>` を実行。
  - `packages/shared/src/skills-data.ts`: 全 63 技能のエントリを生成。
  - 指示書 §13 で指定された仮訳 21 種（知覚, 追跡, 集中, 運動, 隠密, 教養, 格闘, 回避, 近接武器, 拳銃, 肩撃ち武器, オートファイア, 説得, 取引, 裏社会の事情通, 会話, 人間の洞察, 応急手当, 基礎技術, 電子工学/セキュリティ, サイバーテック）を適用し、他技能は英語名のまま `provisional: true` を付与。
  - `packages/shared/src/skills.ts`: `getSkillDef(key)` および `formatSkillName(key)` を提供。
  - `apps/server/src/character-helper.ts`: `skillsList` 生成時に `formatSkillName(key)` による表示名設定およびカタログからの能力値（`stat`）取得を適用。
  - `apps/web/src/pages/PlayerPage.tsx`: キャラクタシート上の技能表示に日本語仮訳を表示。

### 3. GM 画面のボタンからの絵文字削除
- **対応**:
  - `apps/web/src/pages/GmPage.tsx` のヘッダーボタンから絵文字を削除:
    - `📱 参加用 QR` → `参加用 QR`
    - `💾 保存・読み込み` → `保存・読み込み`
    - `📂 ファイルを選択 (.cpgm-save)` → `ファイルを選択 (.cpgm-save)`

### 4. PIN の総当たり攻撃対策（レートリミット & タイミング攻撃防御）
- **対応**:
  - `apps/server/src/routes/auth.ts`:
    - **タイミング攻撃防御**: `crypto.timingSafeEqual` を用いて、入力 PIN と保存された GM PIN の SHA-256 ハッシュ（32 バイト固定長）同士を一定時間で比較。
    - **レート制限**: 送信元 IP ごとに連続失敗回数をインメモリ管理。同一 IP から 5 回連続で失敗した場合、60 秒間ロックし HTTP 429 Too Many Requests（`Retry-After: <秒数>` ヘッダー付き）を返却。
    - 認証成功時は失敗カウントをリセット。また、ロック中に正しい PIN が送られた場合でも 60 秒間は 429 で拒絶。
  - `apps/server/test/api.test.ts`:
    - 5 回連続失敗で 401 が返り、6 回目に 429 と `Retry-After` が返るテストを追加。
    - 異なる IP はロックされない独立性の検証テストを追加。
    - 途中で成功した場合は失敗カウントがリセットされるテストを追加。

---

## 確認した事実（コマンドと出力）

### 1. 技能カタログ生成
```
$ npm run gen:skills -- --src <FVTT_REPO>

> cyberpgm@0.1.0 gen:skills
> tsx tools/gen-skill-catalog/src/index.ts --src <FVTT_REPO>

Generating skill catalog from: <FVTT_REPO>
Parsed 63 skills.
Saved skill catalog to: <HOME>/orca/projects/CyberPGM/packages/shared/src/skills-data.ts
```

### 2. Lint と Typecheck
```
$ npm run lint

> cyberpgm@0.1.0 lint
> eslint .

$ npm run typecheck

> cyberpgm@0.1.0 typecheck
> tsc --noEmit
```
（いずれもエラー・警告なし 0 件でパス）

### 3. 単体・結合テスト（Vitest: 16 テストスイート全 80 テスト通過）
```
$ npm test

> cyberpgm@0.1.0 test
> vitest run

 ✓ tools/import-fvtt/test/import.test.ts (5 tests) 1313ms
 ✓ apps/server/test/ws.test.ts (1 test) 236ms
 ✓ apps/server/test/api.test.ts (7 tests) 108ms
 ✓ apps/server/test/saves.test.ts (3 tests) 28ms
 ✓ apps/server/test/net.test.ts (8 tests) 17ms
 ✓ packages/rules/test/dice.test.ts (8 tests) 3ms
 ✓ packages/rules/test/damage.test.ts (12 tests) 4ms
 ✓ packages/rules/test/check.test.ts (9 tests) 3ms
 ✓ packages/rules/test/initiative.test.ts (4 tests) 2ms
 ✓ packages/rules/test/wounds.test.ts (4 tests) 2ms
 ✓ packages/rules/test/attack.test.ts (5 tests) 2ms
 ✓ packages/rules/test/index.test.ts (1 test) 2ms
 ✓ packages/shared/test/skills.test.ts (6 tests) 2ms
 ✓ packages/rules/test/humanity.test.ts (3 tests) 2ms
 ✓ packages/rules/test/movement.test.ts (3 tests) 2ms
 ✓ tools/gen-skill-catalog/test/index.test.ts (1 test) 60ms

 Test Files  16 passed (16)
      Tests  80 passed (80)
   Duration  4.94s
```

### 4. Web アプリのビルドと E2E テスト（Playwright）
```
$ npm run build -w @cyberpgm/web

> @cyberpgm/web@0.1.0 build
> tsc -b && vite build

✓ 67 modules transformed.
dist/index.html                  1.63 kB │ gzip:   0.76 kB
dist/assets/index-XyRQTUe4.js  389.63 kB │ gzip: 110.63 kB
✓ built in 834ms

$ npm run test:e2e

> cyberpgm@0.1.0 test:e2e
> playwright test

Running 1 test using 1 worker

     1 ….ts:7:1 › GM login, player QR join, and real-time fund notification flow
  ✓  1 … › GM login, player QR join, and real-time fund notification flow (1.3s)
  1 passed (3.2s)
```

---

## 撮り直したスクリーンショット

### 1. GM 画面 — PC 管理（`docs/agy/reports/img/phase2-gm-pc.png`）
- ヘッダーボタンから絵文字が外れ、「参加用 QR」「保存・読み込み」となっていることを確認。
- フッターに RTG Homebrew Content Policy 免責文言および FVTT / アイコンのクレジットが表示されていることを確認。

![GM PC 管理](img/phase2-gm-pc.png)

### 2. GM 画面 — 参加用 QR（`docs/agy/reports/img/phase2-gm-qr.png`）
![GM 参加用 QR](img/phase2-gm-qr.png)

### 3. GM 画面 — 保存と読み込み（`docs/agy/reports/img/phase2-gm-saves.png`）
![GM 保存と読み込み](img/phase2-gm-saves.png)

### 4. プレイヤーのスマホ — 参加画面（`docs/agy/reports/img/phase2-player-join.png`）
![プレイヤー参加画面](img/phase2-player-join.png)

### 5. プレイヤーのスマホ — キャラシート（`docs/agy/reports/img/phase2-player-sheet.png`）
- 技能欄に「拳銃」「回避」「格闘」「肩撃ち武器」「運動」「知覚」「隠密」などの日本語仮訳が表示されていることを確認。
- フッターに正しい RTG 免責文言が表示されていることを確認。

![プレイヤーキャラシート](img/phase2-player-sheet.png)

### 6. プレイヤーのスマホ — 通知バナー（`docs/agy/reports/img/phase2-player-notify.png`）
![プレイヤー通知バナー](img/phase2-player-notify.png)

---

## 完了の確認
- §13 の 4 点（フッター免責文言、技能名カタログと仮訳表示、絵文字削除、PIN レートリミットと timingSafeEqual）をすべて反映。
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` がすべて正常終了。
- E2E スクリーンショット 6 点を最新状態で撮り直し。
- 本報告をもって作業ブランチ `agy/phase2-session` に commit & push して停止します。
