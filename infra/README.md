# infra — GCP インフラ（Terraform）

PhoenixDevOps の GCP リソースを Terraform で管理します。**コンソールからの手動変更は禁止**
（手動変更による IaC 崩壊こそ本プロダクトが解決したい課題であり、自分たちで再現しない）。

## 担当範囲（Issue #2 / #4 / #14）

本ディレクトリで現在管理しているのは、以下の領域です。

| 領域 | リソース | モジュール |
| --- | --- | --- |
| Cloud Storage | `*-assets` バケット（`uploads/` `results/` プレフィックス） | [modules/storage](terraform/modules/storage) |
| Cloud Tasks | 解析ジョブキュー `analysis-job-queue` | [modules/tasks](terraform/modules/tasks) |
| Firestore | `(default)` DB + `jobs` 複合インデックス | [modules/firestore](terraform/modules/firestore) |
| Cloud Functions | 解析ワーカー `*-analysis-worker` + 実行/呼び出し SA | [modules/analysis_worker](terraform/modules/analysis_worker) |

> Firestore の `jobs` コレクション設計は [documents/design/firestore-jobs.md](../documents/design/firestore-jobs.md) を参照。
> GCP プロジェクト本体・API 有効化・Gemini/Secret Manager は **山本担当**（別途）。

## ディレクトリ構成

```text
infra/terraform/
├── modules/            # 再利用可能なリソース定義
│   ├── storage/
│   ├── tasks/
│   ├── analysis_worker/
│   └── firestore/
└── envs/
    └── dev/            # dev 環境のルート（モジュールを束ねる）
        ├── backend.tf          # GCS バックエンド（bucket は init 時に指定）
        ├── providers.tf        # provider/version 制約
        ├── variables.tf
        ├── main.tf             # モジュール呼び出し
        ├── outputs.tf
        └── terraform.tfvars.example
```

## 前提（ブートストラップ — 一度だけ）

実 `plan`/`apply` には、プロジェクトセットアップ側で以下が用意されている必要があります。

1. **GCP プロジェクト**と必要 API の有効化
   `storage.googleapis.com` / `cloudtasks.googleapis.com` / `firestore.googleapis.com` /
   `cloudfunctions.googleapis.com` / `cloudbuild.googleapis.com` / `run.googleapis.com` /
   `artifactregistry.googleapis.com` / `secretmanager.googleapis.com`
2. **state 用 GCS バケット**（例: `phoenixdevops-tfstate`）。バージョニング有効を推奨。
   - このバケット自身は Terraform 管理外（鶏卵問題回避のため手動 or 別 bootstrap）。
3. **Workload Identity 連携（WIF）**
   - Workload Identity Pool + Provider（GitHub OIDC `token.actions.githubusercontent.com`）
   - terraform 実行用サービスアカウント（必要最小限のロール: 例 `roles/storage.admin`,
     `roles/cloudtasks.admin`, `roles/datastore.owner`, `roles/cloudfunctions.developer`,
     `roles/run.admin`, `roles/iam.serviceAccountAdmin`, `roles/iam.serviceAccountUser` 等。
     `owner`/`editor` は付与しない）
   - 当該 SA に対し、対象リポジトリの WIF プリンシパルからの
     `roles/iam.workloadIdentityUser` 借用を許可

### GitHub に設定するシークレット

CI（[.github/workflows](../.github/workflows)）が参照します。

| シークレット | 内容 |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<番号>/locations/global/workloadIdentityPools/<pool>/providers/<provider>` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | terraform 実行用 SA のメールアドレス |
| `GCP_PROJECT_ID` | 対象 GCP プロジェクト ID |
| `TFSTATE_BUCKET` | state 保存先 GCS バケット名 |

## ローカルでの検証（認証不要）

provider のダウンロードのみでフォーマット・構文検証ができます。

```bash
cd infra/terraform/envs/dev
terraform fmt -recursive -check
terraform init -backend=false      # バックエンド接続なし（検証用）
terraform validate
```

スラッシュコマンド `/tf-plan` でも同じ手順を実行できます。

## 実 plan / apply（認証あり）

```bash
cd infra/terraform/envs/dev
cp terraform.tfvars.example terraform.tfvars   # 実値を記入（コミット禁止）
terraform init -backend-config="bucket=<TFSTATE_BUCKET>"
terraform plan
# apply は原則 CI（master マージ）で実行する
```

### 解析ワーカーの secret 設定

Gemini API キーの実値は Terraform 変数や `*.tfvars` に書かず、Secret Manager で管理します。
Terraform には secret ID のみを渡します。

```hcl
gemini_api_key_secret_id      = "gemini-api-key"
gemini_api_key_secret_version = "latest"
```

未指定の場合、Cloud Functions には `GEMINI_API_KEY` が設定されず、解析ワーカー側の dry-run client に
フォールバックします。

API 側が Cloud Tasks の HTTP target を作成する際は、Terraform output の
`analysis_worker_function_uri` を URL に、`analysis_task_invoker_service_account_email` を OIDC token の
service account に指定します。API 実行 SA には、この invoker SA への `iam.serviceAccounts.actAs`
相当の権限付与が別途必要です。

## CI のゲート（重要）

- `apply` ワークフローは GitHub Environment `dev` を通します。**`dev` に required reviewers を
  必ず設定**してください（未設定だと承認なしで apply が通ります）。
- `apply` は適用前に `plan` をログ出力し、その plan ファイルをそのまま適用します。承認者は
  ログの差分を確認してから approve してください（再計算による差分乖離を防ぐ運用）。
- `plan` ワークフローは fork PR では実行しません（WIF クレデンシャル露出防止）。あわせて
  WIF プロバイダ側の attribute condition で `assertion.repository` を本リポジトリに限定してください。

## 既知の注意点（初回 apply 時に確認）

- **Firestore `(default)` の重複**: 本 IaC は `google_firestore_database`（`(default)`）を作成します。
  プロジェクトセットアップ（山本担当）側で Firestore を既に有効化・作成済みの場合、初回 apply が
  `409 Already Exists` になります。その場合は手動作成せず、
  `terraform import 'module.firestore.google_firestore_database.default' "<project_id>/(default)"`
  で取り込んでください。
- **API 有効化のラグ**: `firestore.googleapis.com` 有効化直後はデータベース/インデックス作成が
  間に合わず初回 apply が失敗することがあります。少し待って再実行で解消します。
- **IAM（アクセス権付与）の担当**: API など未実装領域の実行 SA への権限付与は、各担当 PR で扱います。
  解析ワーカーについては Issue #4/#14 の Terraform 実装として、worker SA に assets bucket の
  `roles/storage.objectAdmin` と project の `roles/datastore.user`、Cloud Tasks 用 invoker SA に
  `roles/cloudfunctions.invoker` / `roles/run.invoker` を付与します。
- **Cloud Functions Gen2 の build SA 権限**: default build service account
  `<project-number>-compute@developer.gserviceaccount.com` が GCF 内部 source bucket を読めないと、
  `gcs-fetcher` が `Storage Object Viewer permission` 不足で失敗します。解析ワーカーモジュールでは
  この build SA に `roles/storage.objectViewer` / `roles/artifactregistry.writer` /
  `roles/logging.logWriter` を付与し、IAM 伝播待ちを入れてから関数を作成します。初回 apply で
  これらの project IAM を作成するため、terraform 実行 SA には project IAM policy 更新権限が必要です。

## ロケーション表記について

GCS は大文字のロケーション名（`ASIA-NORTHEAST1`）、Cloud Tasks / Firestore は小文字の
リージョン/ロケーション ID（`asia-northeast1`）を取ります。表記差は各 API 仕様に沿った
**意図的なもの**で誤記ではありません。

## 運用ルール

- 変更は **PR → CI で `plan` 確認 → レビュー → マージ → CI で `apply`（Environment 承認）** の順。
- `terraform destroy`・バケット削除等の破壊操作は**承認なしに実行しない**。
- secret（`*.tfvars` 実値・SA キー）はコミットしない（`.gitignore` 済み）。
- 構成・命名・スキーマを変えたら、本 README と関連ドキュメントを同じ PR で更新する。
- provider lock は複数プラットフォーム分を保持する（macOS 開発 + Linux CI）。provider を更新したら
  `terraform -chdir=infra/terraform/envs/dev providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64`
  を実行して lock を作り直すこと。
