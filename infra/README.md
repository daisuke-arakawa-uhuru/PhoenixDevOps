# infra

GCP リソース構成、デプロイ手順、IaC 関連ファイルを管理するディレクトリです。

MVP では、まず Cloud Functions、Cloud Tasks、Cloud Storage、Firestore、IAM などを再現できる手順をここに集約します。Terraform などの IaC は、リソース数が増える、複数環境を作る、手作業との差分が問題になる、といった段階で導入します。

想定する配置例です。

```text
infra/
├── README.md
├── scripts/        # gcloud などのデプロイ・初期化スクリプト
└── terraform/      # Terraform を採用した場合の .tf ファイル
```

現時点では Terraform 採用は未確定です。
