# PhoenixDevOps

DevOps x AI Agent Hackathon 2026 用リポジトリです。

## ディレクトリ構成

```text
PhoenixDevOps/
├── apps/
│   └── analysis-worker/        # Cloud Tasks から起動される解析ワーカー
├── documents/
│   ├── product/                # プロダクト概要
│   └── features/               # 機能仕様
├── infra/                      # GCP構成、デプロイ手順、IaC関連ファイル
├── input/                      # ハッカソン条件などの外部入力資料
└── README.md
```

## 各ディレクトリの役割

- `apps/`: アプリケーションを置きます。
- `documents/`: プロダクト概要、機能仕様、設計メモなどのドキュメントを置きます。
- `infra/`: GCP リソース構成、デプロイ手順、IaC 関連ファイルを置きます。MVP では Cloud Functions、Cloud Tasks、Cloud Storage、Firestore、IAM などの構成をここで管理する想定です。
- `input/`: ハッカソンの技術条件など、外部から与えられた入力資料を置きます。
