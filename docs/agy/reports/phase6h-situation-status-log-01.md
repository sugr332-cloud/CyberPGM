# Phase 6h 完了報告: 状況修正・状態異常の付け外し・戦闘ログをセッションログへ

- **フェーズ**: Phase 6h
- **作業ブランチ**: `agy/phase6h-situation-status-log`
- **使用モデル**: Gemini 4 Argon (High)
- **報告作成日時**: 2026-10-24

---

## 1. 実施概要

指示書 `docs/agy/phase6h-situation-status-log.md` および `docs/agy/README.md` に従い、以下の3項目を実装・検証しました。

1. **A. 状況修正（Issue #31）**:
   - 日本語版ルールブック p.130「不利な状況修正」表の10項目を `@cyberpgm/shared` に定義（`SITUATION_MODIFIERS`）。
   - GM戦闘画面の行動入力欄に複数選択チェックボックスと「その他 ±」の数値入力を追加。
   - 「戦闘の既定として保存」「既定に戻す」により、`combats.settings.default_situations` および `default_situation_custom` へ永続化。
   - 射撃・照準射撃・フルオート射撃・制圧射撃・近接攻撃・格闘・武術攻撃・応急手当の計算および内訳（例: `煙や暗闇で視界が悪い −4`、`その他 −2`）に反映。スマホ側にも内訳として送信。

2. **B. 状態異常の付け外し（Issue #34）**:
   - アプリの判定ロジックで実際に使われている状態異常（気絶・伏せ・つかみ・炎上・酸・毒・放射線）を手動で付与・解除可能に実装。
   - 付与時に残りラウンド数（1〜、空欄で永続）を設定可能とし、ラウンド進行時の `statusRounds` 自動減少・解除と連携。
   - HP連動状態（重傷・瀕死・死亡）は手動解除不可とし、ツールチップ（「HP を直すと変わる」）を表示して保護。
   - つかみ状態（`grappling` / `grappled_by`）を手動解除した場合は、双方のペアを同時に解除。
   - 状態の付与・解除は戦闘ログ（`combat_log`）に記録され、「↶ 一手戻る」で undo 可能。
   - 参加者カードおよびスマホ側の行動画面・キャラシートに「気絶 あと 2R」のように残りラウンドを表示。

3. **C. 戦闘ログをセッションログへ（Issue #35）**:
   - シナリオセッションに紐付く戦闘が終了（「戦闘を終える」）した際、取り消されていない `combat_log` を集計・構造化してシナリオのセッションログ（`session_log`、`kind: 'combat'`）に保存。
   - 戦闘名・ラウンド数・開始/終了時刻・各参加者の生存状況・被弾・消費弾数・各ラウンドの行動内訳を読みやすいテキストで出力。
   - 2重保存防止（すでにサマリーが存在する場合は重複挿入を抑止）。

---

## 2. 状態異常の一覧と判定への影響箇所

手動で付け外しできる状態異常は、コード上で実際に効果を発揮するもののみを対象としています（新規の未定義状態名は作成していません）。

| 状態名 | 種類 | 効果・判定への影響 | コード該当箇所（ファイルと行番号） |
| :--- | :--- | :--- | :--- |
| **気絶** | 手動付与/解除可 | `death_save`・`hazard`・`hazard_end`・`release` 以外の全アクションを禁止。ラウンド進行で `statusRounds` が 0 になると自動解除。 | `apps/server/src/services/combat-resolver.ts:287-290`<br>`apps/server/src/routes/combat.ts:979-995` |
| **伏せ** | 手動付与/解除可 | `move`・`run`・`take_cover`（移動系行動）を禁止。「立ち上がる」アクションで解除。 | `apps/server/src/services/combat-resolver.ts:322-323`<br>`apps/server/src/services/combat-resolver.ts:854, 864` |
| **つかみ** | 手動付与/解除可 | つかまれている側は自力移動不可。手動解除時は `grappling` / `grappled_by` の双方を同時に解除。 | `apps/server/src/services/combat-resolver.ts:324-326`<br>`apps/server/src/routes/combat.ts:1685-1700, 1746-1755` |
| **炎上** | 手動付与/解除可 | 環境ダメージ判定の対象。ターン開始時/終了時に火炎ダメージが発生。 | `apps/server/src/services/combat-resolver.ts:1532, 1550` |
| **酸** | 手動付与/解除可 | 環境ダメージ判定の対象。装甲 SP を腐食・低下させる。 | `apps/server/src/services/combat-resolver.ts:1535` |
| **毒** | 手動付与/解除可 | 環境ダメージ判定の対象。装甲を無視して HP に直接ダメージ。 | `apps/server/src/services/combat-resolver.ts:1538` |
| **放射線** | 手動付与/解除可 | 環境ダメージ判定の対象。放射線被曝によるダメージ。 | `apps/server/src/services/combat-resolver.ts:1541` |
| **重傷** | HP自動連動 | 手動解除不可（API で 400 エラーを返し、UI 上で「HP連動」と表示）。HP が最大値の半分以下で付与、回復で解除。 | `packages/rules/src/wounds.ts:28-36`<br>`apps/server/src/routes/combat.ts:1620-1623` |
| **瀕死** | HP自動連動 | 手動解除不可。HP が 1 以上最大値の半分未満かつ致命傷時、または HP 0 時。毎ターンの死亡セーヴを要求。 | `packages/rules/src/wounds.ts:28-36`<br>`apps/server/src/services/combat-resolver.ts:287` |
| **死亡** | HP自動連動 | 手動解除不可。全行動不可。 | `packages/rules/src/wounds.ts:28-36`<br>`apps/server/src/services/combat-resolver.ts:284-286` |

---

## 3. 状況修正が効く判定

日本語版ルールブック p.130 の10項目および「その他 ±」は、以下の判定処理に適用されます。

1. **射撃攻撃（`ranged`・`aimed`・`autofire`）**:
   - ファイル: `apps/server/src/services/attack-modifiers.ts:89-98`、`apps/server/src/services/combat-resolver.ts:2547-2554`
   - 修正値合計が命中判定の攻撃側基準値に加算され、内訳テキスト（例: `煙や暗闇で視界が悪い −4`）が出力されます。
2. **制圧射撃（`suppressive`）**:
   - ファイル: `apps/server/src/services/combat-resolver.ts:2828-2834`
   - 制圧射撃の目標値（REF + 技能 + 1d10 + 修正）に加算されます。
3. **近接武器・格闘・武術（`melee`・`brawl`・`martial_arts`）**:
   - ファイル: `apps/server/src/services/attack-line.ts:107-111`、`apps/server/src/services/combat-resolver.ts:2009-2015, 2977-2983`
   - 近接攻撃の命中判定に加算され、攻撃ラインと内訳に表示されます。
4. **応急手当（`first_aid`）**:
   - ファイル: `apps/server/src/services/attack-line.ts:122-126`、`apps/server/src/services/combat-resolver.ts:3125-3132`
   - TECH + 〈応急手当〉の技能チェックに状況修正が適用されます。

---

## 4. セッションログの kind と出力例

- **`session_log.kind`**: `'combat'`（既存の仕様に準拠し、シナリオ画面でオレンジ色・等幅・改行保持で表示）
- **戦闘ログ要約の出力例**:

```text
【戦闘ログ要約: 暴徒との戦闘6h】
ラウンド数: 3 / 開始: 2026/10/24 14:29 / 終了: 2026/10/24 14:29

■ 参加者状況
・ジャック6h (味方): HP 40/40, 使用弾数: 1発
・ガンナー6h (敵): HP 30/30

■ ラウンド別行動ログ
[R3] ジャック6h → ガンナー6h | 射撃 (ヘビーピストル6h) 命中 (基準値 14 + 出目 8 = 22 vs DV 13) | 3d6: [4,5,3] = 12 ダメージ (SP 4 で 8 通る)
```

---

## 5. dv_table.DV Pistol 消失の原因調査と修正について

- **原因**:
  - 先程の E2E テスト作成過程で、試験用武器の登録・削除処理の記述時に、`rule_constants` テーブルから `key = 'dv_table.DV Pistol'` を削除するコード（`DELETE FROM rule_constants WHERE key = ...`）を `e2e/phase6h.spec.ts` のクリーンアップおよび `afterAll` に誤って含めてしまっていました。
  - そのため、Phase 6h の E2E テストが実行・終了した時点でテスト用 DB から `dv_table.DV Pistol` のレコードが消去され、後続の既存テスト（`board-combat`、`combat`、`phase6f` など大型拳銃を使用するテスト）が DV テーブルを参照できずに失敗していました。
- **恒久対策**:
  - `e2e/phase6h.spec.ts` から `rule_constants` に対するすべての `DELETE` および `INSERT` 処理を完全に削除しました。
  - テスト用 DB に恒常的に存在する共通ルール定数は一切変更せず、既存の定数をそのまま参照する安全なテスト実装に改修しました。

---

## 6. スクリーンショット

### A. 状況修正（Issue #31）
- **PC 幅（1440px）**:
  ![状況修正 1440px](img/phase6h-situation-modifier-1440.png)
- **スマホ幅（390px）**:
  ![状況修正 390px](img/phase6h-situation-modifier-390.png)

### B. 状態異常の付け外し（Issue #34）
- **PC 幅（1440px）**:
  ![状態異常の付け外し 1440px](img/phase6h-status-management-1440.png)
- **スマホ幅（390px）**:
  ![状態異常の付け外し 390px](img/phase6h-status-management-390.png)

### C. 戦闘ログをセッションログへ（Issue #35）
- **PC 幅（1440px）**:
  ![セッションログ要約 1440px](img/phase6h-session-log-1440.png)
- **スマホ幅（390px）**:
  ![セッションログ要約 390px](img/phase6h-session-log-390.png)

---

## 7. テスト結果

### `npm run lint`
```text
> cyberpgm@0.1.0 lint
> eslint .

✖ 744 problems (0 errors, 744 warnings)
```

### `npm run typecheck`
```text
> cyberpgm@0.1.0 typecheck
> tsc --noEmit

（エラーなし）
```

### `npm test`
```text
 Test Files  49 passed (49)
      Tests  333 passed (333)
   Start at  14:41:45
   Duration  25.96s
```

### 関連 Playwright E2E テスト
```text
Running 8 tests using 1 worker

  ✓  1 e2e/action-guard.spec.ts (2.6s)
  ✓  2 e2e/board-combat.spec.ts (2.4s)
  ✓  3 e2e/combat-flow.spec.ts (8.2s)
  ✓  4 e2e/combat.spec.ts (2.4s)
  ✓  5 e2e/phase6a.spec.ts [1] (2.5s)
  ✓  6 e2e/phase6a.spec.ts [2] (2.2s)
  ✓  7 e2e/phase6f.spec.ts (3.5s)
  ✓  8 e2e/phase6h.spec.ts (3.4s)

  8 passed (30.7s)
```
