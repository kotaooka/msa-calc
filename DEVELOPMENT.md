# 開発者向け情報（msa-calc）

利用者向けの説明は [README.md](README.md) にあります。

## ファイル構成

```
index.html             画面（スタイルを含む）。解説は docs/explanation.md から埋め込む
js/msa.js              MSA の計算（GRR・偏り・直線性・安定性・Type-1・計数値）。Node でも読み込み可
js/stats.js            分布関数・管理図・異常判定ルール（cpk-calc と同じファイル）
js/table.js            入力表（キー操作・複数セルの貼り付け）と数値の読み取り
js/importer.js         Excel・CSV・貼り付けた表から各解析の入力を読み取る
js/xlsx.js             .xlsx の読み書きと CSV の読み込み（cpk-calc と同じファイル）
js/charts.js           SVG のグラフと PNG 保存（cpk-calc と同じファイル）
js/app.js              画面処理
sw.js                  オフライン用のキャッシュ処理（Service Worker）
manifest.webmanifest   アプリとして追加するための設定
icons/                 アプリアイコン（tools/make_icons.py で作成）
docs/explanation.md    「解説」タブの原稿
docs/screenshots/      README 用のスクリーンショット（tools/screenshots.py で撮影）
tools/build.py         解説を index.html に埋め込む
tests/                 テスト（下記）
.github/workflows/     push 時の自動テスト
```

## 更新して公開するとき

- `index.html`・`js/`・`icons/` を変更したら、**`sw.js` 先頭の `VERSION` を必ず上げてから** push してください。上げないと、すでに使っている人の端末に古いファイルが残り続けます
- 解説を直すときは `docs/explanation.md` を編集し、`python tools/build.py`（`pip install markdown`）で index.html に埋め込んでください。埋め込み忘れは CI で検出します
- `js/stats.js`・`js/xlsx.js`・`js/charts.js` は cpk-calc と共通です。直すときは両方に反映してください
- GitHub Pages は main ブランチのルートを公開しています

## テスト

```
node tests/test.js                 # 不一致があれば終了コード 1
python tests/make_reference.py     # 参照値 tests/reference.json を作り直す（numpy・scipy・pandas・statsmodels・scikit-learn、1 分ほどかかる）
```

- 参照値は js/msa.js と別の方法で計算しています。d2・d3・d2* は範囲の確率密度を scipy で積分（js/msa.js は分布関数を使う）、分散分析は statsmodels の `anova_lm`、κ は scikit-learn、信頼区間は scipy のベータ分布です
- テストが計算の誤りを検出できることは、式を一部変えて失敗することで確かめています

## 実装のメモ

- **範囲の係数**：m 個の標準正規乱数の範囲 W について、E[W] = ∫(1 − Φ^m − (1−Φ)^m)dx、E[W²] = ∫2w(1 − P(W ≤ w))dw をシンプソン則（刻み 0.02）で求めます。d2 = E[W]、d3 = √(E[W²] − E[W]²)、d2*(g=1) = √E[W²]。AIAG の K1 = 1/d2（回数）、K2 = 1/d2*（測定者数）、K3 = 1/d2*（部品数）
- **平均・範囲法の管理限界**：D4 = 1 + 3 d3/d2、A2 = 3/(d2 √r) を同じ数値積分の値から求めます
- **ANOVA 法**：釣り合い型の二元配置。交互作用の F 検定の p 値がプールの有意水準（既定 0.05）を超えたら、交互作用と誤差の平方和・自由度を合わせます。負の分散成分は 0
- **ndc**：1.41 × PV/GRR を切り捨て（1 未満は 1）
- **計数値**：κ は同じ部品・同じ回の判定を組にしたクロス表から求めます。有効性は全回とも基準と一致した部品の割合、ミス率・誤警報率は判定 1 回ずつを数えた割合（AIAG と同じ）。信頼区間は Clopper-Pearson（不完全ベータ関数を二分法で逆算）
- **安定性**：stats.js の管理図と JIS Z 9020-2 の 8 ルールを使います（管理図の係数は表の値）
- **入力の保存**：ブラウザの localStorage（キー `msa-calc-v1`）に全タブの入力と設定を保存します
