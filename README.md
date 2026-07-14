# PhoenixDevOps

DevOps x AI Agent Hackathon 2026 用リポジトリです。

## ディレクトリ構成

```text
PhoenixDevOps/
├── apps/
│   ├── api/                    # HTTP API（Hono / Cloud Functions Gen2）
│   ├── ui/                     # Web UI（Vite + React + TypeScript）
│   └── analysis-worker/        # Cloud Tasks から起動される解析ワーカー
├── documents/
│   ├── product/                # プロダクト概要
│   ├── features/               # 機能仕様
│   ├── design/                 # 設計ドキュメント（アーキテクチャ・静的解析・Firestore）
│   ├── engineering/            # 開発規約・ハーネス運用・監視ガイド
│   └── infra/                  # インフラ関連の参考資料（構成図等）
├── infra/                      # GCP構成、IaC関連ファイル（Terraform）
├── input/                      # ハッカソン条件などの外部入力資料
├── sample/                     # 解析テスト用サンプルデータ
├── .github/workflows/          # CI/CD（Terraform plan/apply）
├── .claude/                    # AI エージェントハーネス設定
└── README.md
```

## 各ディレクトリの役割

- `apps/`: アプリケーションを置きます。
  - `apps/api/`: ファイルアップロード、解析ジョブ作成・状態取得・成果物 URL 取得の HTTP API です。
  - `apps/ui/`: ソースコードと既存ドキュメントをアップロードし、解析結果をプレビュー・ダウンロードする Web UI です。
  - `apps/analysis-worker/`: Cloud Tasks から非同期起動される解析ワーカーです。Gemini API でソースコード解析・仕様生成を行います。
- `documents/`: プロダクト概要、機能仕様、設計ドキュメント、開発規約を置きます。
- `infra/`: GCP リソース構成を Terraform で管理します。MVP では Cloud Functions、Cloud Tasks、Cloud Storage、Firestore、IAM などの構成をここで管理します。
- `input/`: ハッカソンの技術条件など、外部から与えられた入力資料を置きます。
- `sample/`: 解析ワーカーのローカル実行テスト用のサンプルデータ（ソースコード ZIP / ドキュメント PDF）を置きます。
- `.github/workflows/`: Terraform の plan/apply を実行する CI/CD ワークフローを置きます。
- `.claude/`: AI エージェント（Claude Code）のハーネス設定（コマンド・サブエージェント・権限設定）を置きます。
