# Phase 6f 実装報告

- 作業ブランチ: `codex/phase6f-suppressive-modifiers`
- 使用モデル: GPT-6.1-Sol
- 対象指示書: `docs/agy/phase6f-suppressive-modifiers.md`

## 実装内容

制圧射撃を、射手の【反応】＋〈フルオート射撃〉＋1d10と、各対象の【意志】＋〈精神集中〉＋1d10による対抗判定にしました。対象候補は盤面上の距離・前方・遮蔽・ヴィークル・視線で絞り、GMが追加・除外できます。敗北した対象には「制圧（次の移動は遮蔽へ）」を付け、次の移動または速足で解除します。GM画面と対象プレイヤーのスマホに案内し、一手戻る処理にも対応しました。対象プレイヤーは自分の抵抗出目をスマホから送れます。

射撃修正値は共通関数 `rangedAttackModifiers` から解決処理と成功ラインの案内へ渡すようにしました。高品質武器、神経接続されたスマートガン・リンク、条件を満たす狙撃用スコープ、ソロの精密攻撃、運命、負傷、重傷無視薬、つかみの修正を名前付きで表示します。対象を選んだ場合は距離・距離帯・難易度を示し、武器の距離帯表では該当帯を強調します。GM画面とスマホで共通の内訳を表示します。

低品質武器は攻撃の決定的失敗で動作不良になり、修理まで攻撃に使えません。「動作不良を直す」は判定不要の1アクションです。武器の `attachments` に付属品の所持品IDを保存し、GMのキャラ編集とプレイヤーの装備タブから付け外しできます。

武器品質は、所持品 `quality`、武器データの `quality`、品目 `raw_system.quality` の順に確認し、これらに値がない場合は品目名の「(高品質)」「(低品質)」を使います。明示された未知の品質値は通常品質として扱います。

## 案内と解決の差

修正前は、成功ラインの案内にREF・技能・負傷・照準だけが出ていました。解決処理にあったソロの精密攻撃、つかみペナルティ、重傷無視薬の効果が案内に反映されず、品質や付属品の修正も表示されていませんでした。今回、案内と解決が同じ修正値計算関数を使うようにし、単体テストで一致を確認しました。

## テストと成果物

- `npm run lint` — 成功、エラー 0、警告 712
- `npm run typecheck` — 成功
- `npm test` — 成功、46ファイル・322テスト
- `npm run build -w @cyberpgm/web` — 成功。既存のNode組み込み外部化と大きなチャンクに関する警告あり
- `PORT=8791 npm run test:e2e -- e2e/phase6f.spec.ts e2e/combat-flow.spec.ts e2e/combat.spec.ts e2e/board-combat.spec.ts e2e/action-guard.spec.ts e2e/phase6a.spec.ts` — 成功、7テスト
- `git diff --check` — 成功

E2Eで制圧射撃の抵抗・状態付与、修正値のGM/スマホ表示、付属品の付け外し、低品質武器の動作不良・攻撃不可・修理を確認しました。新しい画面キャプチャ:

- 制圧射撃: [phase6f-suppressive-1440.png](img/phase6f-suppressive-1440.png)
- 成功ライン（GM）: [phase6f-modifier-line-1440.png](img/phase6f-modifier-line-1440.png)
- 成功ライン（スマホ）: [phase6f-modifier-line-390.png](img/phase6f-modifier-line-390.png)
- 武器の付属品（スマホ）: [phase6f-weapon-attachments-390.png](img/phase6f-weapon-attachments-390.png)

E2Eが更新した既存フェーズの画像は、コミット前に元へ戻しました。テスト用サーバーはポート8791で起動し、テストランナーの終了時に停止しました。ポート8787および本番データには触れていません。
