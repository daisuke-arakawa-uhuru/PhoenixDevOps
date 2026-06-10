---
description: Issue 番号から担当範囲を確認し、規約に沿った作業ブランチを作成する
argument-hint: "<Issue番号> [担当者ローマ字]"
---

引数: `$ARGUMENTS`（1 つ目 = Issue 番号、2 つ目 = 担当者の英字表記。省略時は git のローカル user.name から推測）

手順:

1. `gh issue view <Issue番号> --json number,title,body,assignees,comments` で Issue 本文とコメント欄を取得する。
2. コメント欄のアサイン記述から、担当者（自分）の担当範囲を特定して要約する。担当境界が不明なら、ここで止めてユーザーに確認する。
3. 規約のブランチ名 `feature/issue-<番号>-<担当者>` で `git checkout -b` する。
   - 担当者英字が引数で渡されていればそれを使う。なければ user.name から英字を推測し、確定前にユーザーへ提示する。
4. 作成後、`git branch --show-current` と `git config user.name` / `git config user.email` を表示し、
   コミット作者が正しい担当アカウントに解決されているか確認する。

注意: 既存の同名ブランチがある場合は新規作成せず、切り替えるかどうかをユーザーに確認する。