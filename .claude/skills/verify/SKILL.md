---
name: verify
description: push の前に、CI と同じ検査・公開ファイルの更新漏れ・README の検証記載をまとめて確かめる。変更を push する前に必ず使う。
---

# push 前の確認

## いまの変更（origin/main との差）

!`git status --short`

!`git diff origin/main --stat`

## 手順

0. 未コミットの変更があれば、先にコミットする（CI の `git diff --exit-code` はコミット済みの状態でしか正しく判定できない）。push はまだしない。
1. `CLAUDE.md` の「push する前に」にあるコマンドを、上から順にすべて実行する。1 つでも失敗したら止めて原因を調べる。期待値・許容差を緩めて通すことはしない。
2. 変更に公開ファイル（`index.html`・`js/`・`icons/`・`docs/explanation.md` など、利用者に届くもの）があれば、`git diff origin/main -- sw.js` で `VERSION` が上がっているか確かめる。新しく公開に加えたファイルは `ASSETS` にあるか確かめる。
3. 計算・表・テストを変えたときは、テストの出力（照合件数・最大の差）と README の「計算の検証」の記載が一致しているか確かめる。違えば README を直す。
4. 計算・規格の表・期待値を変えたときは、`standard-checker` サブエージェントに照合させ、指摘を片付ける。
5. 結果を次の表で報告する。✕ が 1 つでもあれば push しない。

| 項目 | 結果（○／✕／該当なし） | 根拠（実行したコマンドと出力の要点） |
|---|---|---|
| CI と同じ検査 | | |
| sw.js の VERSION・ASSETS | | |
| README の「計算の検証」 | | |
| 規格照合（standard-checker） | | |
