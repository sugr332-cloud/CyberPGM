# Phase 1 報告 02

- 日時: 2026-10-20
- 使用モデル: Gemini 3.8 Flash (High)
- 状態: 完了
- 停止した理由: 完了

## 実施したこと（指示書 §14「レビュー指摘 02」の対応）

### 1. 指摘 1: 一定以下の SP を無視（ignoreBelowSP）の修正
- `packages/rules/src/damage.ts` において、防具無視の判定条件を `sp <= input.ignoreBelowSP` から `sp < input.ignoreBelowSP`（厳密な未満）に修正。
- `packages/rules/test/damage.test.ts` に境界値テストを追加:
  - `sp === ignoreBelowSP`（4 vs 4）のとき、防具は無視されず effectiveSp は 4。
  - `sp < ignoreBelowSP`（3 vs 4）のとき、防具は無視され effectiveSp は 0。

### 2. 指摘 2: 盾仕様の修正（FVTT `_applyDamage` 準拠）
- `packages/rules/src/damage.ts` の盾処理を修正:
  - 盾のダメージ吸収量: `min(rawTotal + critBonus, shieldHp)`
  - **非爆発物の攻撃**: 盾で完全に止まり、体には一切通らない（`shieldHpAfter: input.shieldHp - shieldDmg`, `penetrating: 0`, `hpLoss: 0`, `spAfter: input.sp`, `criticalInjuryTable: null`）。
  - **爆発物の攻撃（isExplosive: true）**: 盾 HP が残っていれば攻撃は止まる。盾が破壊（`shieldHpAfter === 0`）された場合は、**減殺前の元のダメージ（rawTotal）** がそのまま防具計算に進む（Issue #14）。
- `packages/rules/test/damage.test.ts`:
  - 誤った旧テスト「盾 HP 10・ダメージ 16 → 残り 6 が体へ」を削除。
  - 「盾 HP 10・ダメージ 16 → shieldHpAfter 0, hpLoss 0, spAfter 変わらず, criticalInjuryTable null」のテストに変更。
  - 爆発物で盾が残るケース（盾 HP 20、ダメージ 16 → shieldHpAfter 4, hpLoss 0）を追加。
  - 爆発物で盾が破壊されるケース（盾 HP 10、ダメージ 16、体 SP 7 → shieldHpAfter 0, penetrating 9, hpLoss 9, spAfter 6）を追加（テスト名に Issue #14 を明記）。

### 3. 指摘 3: 非致死の攻撃（lethal / currentHp）の実装
- `packages/rules/src/damage.ts` の `ResolveDamageInput` に `lethal?: boolean`（既定 true）と `currentHp?: number` を追加。
- `lethal: false` かつ `currentHp` が渡された場合、HP が 1 未満にならないよう `hpLoss` を `Math.min(hpLoss, Math.max(0, currentHp - 1))` に制限（`currentHp <= 0` なら `hpLoss: 0`）。
- `packages/rules/test/damage.test.ts` に非致死攻撃のテストを追加（ダメージ 15 vs currentHp 10 → hpLoss 9、currentHp 0 または負数の場合 hpLoss 0、currentHp 20 vs ダメージ 5 で制限なし、lethal: true の既定動作確認）。

### 4. 指摘 4: FVTT アイコンの公開範囲の移行（データ移行の 1 回化と GM カスタマイズの保護）
- `drizzle/0001_migrate_fvtt_icon_visibility.sql` を作成し、既存 DB に対して `UPDATE images SET visibility = 'players' WHERE origin = 'fvtt_icon' AND visibility = 'gm';` のマイグレーションを適用。
- `tools/import-fvtt/src/importer.ts` を修正:
  - 新規追加される `fvtt_icon` のみ `visibility = 'players'` を初期値として設定。
  - 既存更新時（差分検出・UPDATE 文）では `visibility` カラムを更新対象から除外し、触らないように変更。
- `tools/import-fvtt/test/import.test.ts` にテストを追加:
  - 初回インポート後、GM が手動で `visibility = 'gm'` に変更した状態で再インポートを実行しても、`visibility` が `gm` のまま維持されることを検証。

---

## 確認した事実（コマンドと出力）

### 1. `npm run test:coverage`
```
$ npm run test:coverage

 RUN  v3.2.7 <CyberPGM>
      Coverage enabled with v8

 ✓ packages/rules/test/movement.test.ts (3 tests) 3ms
 ✓ packages/rules/test/attack.test.ts (5 tests) 5ms
 ✓ packages/rules/test/initiative.test.ts (4 tests) 6ms
 ✓ packages/rules/test/dice.test.ts (8 tests) 6ms
 ✓ packages/rules/test/wounds.test.ts (4 tests) 5ms
 ✓ packages/rules/test/damage.test.ts (12 tests) 6ms
 ✓ packages/rules/test/check.test.ts (9 tests) 7ms
 ✓ packages/rules/test/humanity.test.ts (3 tests) 3ms
 ✓ packages/rules/test/index.test.ts (1 test) 2ms
 ✓ tools/import-fvtt/test/import.test.ts (5 tests) 795ms

 Test Files  10 passed (10)
      Tests  54 passed (54)
   Duration  1.46s

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
...ages/rules/src  |     100 |    96.72 |     100 |     100 |                   
  attack.ts        |     100 |    96.55 |     100 |     100 | 45                
  check.ts         |     100 |    93.33 |     100 |     100 | 42,100            
  constants.ts     |     100 |      100 |     100 |     100 |                   
  damage.ts        |     100 |      100 |     100 |     100 |                   
  dice.ts          |     100 |      100 |     100 |     100 |                   
  humanity.ts      |     100 |      100 |     100 |     100 |                   
  index.ts         |     100 |      100 |     100 |     100 |                   
  initiative.ts    |     100 |       92 |     100 |     100 | 76,102            
  movement.ts      |     100 |      100 |     100 |     100 |                   
  wounds.ts        |     100 |       95 |     100 |     100 | 63                
-------------------|---------|----------|---------|---------|-------------------
```
`packages/rules/src` において **全ファイルで行カバレッジ 100%、全体ブランチ網羅率 96.72%（基準 90% 以上達成）** を確認。全 54 テスト合格。

### 2. `npm run lint` & `npm run typecheck`
```
$ npm run lint
> eslint .

$ npm run typecheck
> tsc --noEmit
```
ともにエラー・警告ゼロで通過。

### 3. `npm run build`
```
$ npm run build
> npm run build --workspaces --if-present
✓ built in 636ms
```
全ワークスペースのビルドが成功。

---

## コミット履歴（作業ブランチ: agy/phase1-rules-engine）
- `3389b7b`: Merge branch 'origin/main' into agy/phase1-rules-engine
- `91a7afa`: fix(rules,tools): レビュー指摘02対応（盾仕様・ignoreBelowSP・非致死攻撃・アイコン公開範囲マイグレーション）

## 次にやること
- Phase 2 以降の指示書に従った実装。

## 問題・仕様との食い違い
- なし。レビュー指摘 02 の 4 点（ignoreBelowSP 未満判定、盾の爆発物/非爆発物分岐、非致死攻撃制限、アイコン公開範囲マイグレーションとインポーターの visibility 保護）をすべて満たし、全テストをパスしています。
