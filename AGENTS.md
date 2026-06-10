# AGENTS.md

このリポジトリで作業する AI エージェント（Claude Code / Cursor / Codex など）向けの共通入口です。

**規約・コンテキストの正本は [CLAUDE.md](CLAUDE.md) です。** まずそちらを読んでください。
このファイルは、`CLAUDE.md` を直接読まないツールのための要点コピーです。

## 最低限守ること

1. **Issue 駆動**: 着手前に対象 Issue とコメント欄を読み、自分（担当者）のアサイン範囲を特定する。担当外には踏み込まない。
2. **ブランチ**: `feature/issue-<番号>-<担当者>` を切る。`master` へ直接コミットしない。
3. **IaC は Terraform のみ**: GCP リソースはコンソール手動変更禁止。`infra/` 配下で Terraform 管理する。
4. **secret をコミットしない**: API キー / SA キー / `*.tfvars` の実値は Git に載せない。
5. **ドキュメントを乖離させない**: 構成・スキーマ・運用を変えたら、対応ドキュメントも同じ PR で更新する。
6. **破壊的操作は承認を取る**: `terraform destroy`、バケット削除等はユーザー承認なしに実行しない。

## よく使う入口

- プロダクト概要: [documents/product/index.md](documents/product/index.md)
- MVP 機能仕様: [documents/features/01-document-drift-agent.md](documents/features/01-document-drift-agent.md)
- インフラ（IaC）: [infra/README.md](infra/README.md)
- ハーネス運用規約: [documents/engineering/harness.md](documents/engineering/harness.md)