---
description: infra の Terraform を fmt / validate / plan する
argument-hint: "[env 名（省略時 dev）]"
---

`infra/terraform/envs/${ARGUMENTS:-dev}` を対象に、以下を順に実行して結果を報告してください。

1. `terraform -chdir=infra/terraform/envs/${ARGUMENTS:-dev} fmt -recursive -check` でフォーマット差分を確認
2. `terraform -chdir=infra/terraform/envs/${ARGUMENTS:-dev} init -backend=false` で初期化（バックエンド接続なし＝ローカル検証用）
3. `terraform -chdir=infra/terraform/envs/${ARGUMENTS:-dev} validate` で構文・型を検証
4. 認証情報と `terraform.tfvars` が揃っている場合のみ `terraform -chdir=infra/terraform/envs/${ARGUMENTS:-dev} plan` を実行

注意:
- 実際の `plan`（バックエンド接続あり）には GCP 認証・project_id・state バケットが必要。揃っていなければ 1〜3 までで止め、その旨を報告する。
- `apply` は CI（PR マージ後）で行う運用。このコマンドでは実行しない。
- secret（`*.tfvars` 実値・SA キー）を出力に貼らない。