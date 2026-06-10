# PhoenixDevOps

DevOps x AI Agent Hackathon 2026 用リポジトリです。

## ディレクトリ構成

```text
PhoenixDevOps/
├── apps/
│   ├── api/                    # API
│   ├── ui/                     # UI
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

## 🔎 Gemini PR自動レビューの設定と使い方

本リポジトリには、GitHub ActionsとGemini APIを利用してプルリクエストを自動レビューするワークフローが統合されています。

### 1. セットアップ方法（初回のみ）

1. **Gemini APIキーの取得**:
   - [Google AI Studio](https://aistudio.google.com/) にアクセスし、APIキー（無償版で可）を取得します。
2. **GitHub Secretsへの登録**:
   - リポジトリのページから **Settings** > **Secrets and variables** > **Actions** の順に進みます。
   - **New repository secret** をクリックし、以下の通り登録します。
     - **Name**: `GEMINI_API_KEY`
     - **Secret**: （取得したAPIキーの値）

### 2. レビューの実行方法

#### ① 自動レビュー（PR作成・更新時）
プルリクエストが **作成（opened）**、**再オープン（reopened）**、または **コード更新（synchronize）** された際に、自動的にレビューワークフローが起動し、PRの各コード行に対してGeminiがインラインレビューコメントを投稿します。

#### ② コメントによる手動オンデマンド実行
PRのコメント欄に以下のコマンドを投稿することで、いつでもレビューを再実行させることができます（リポジトリのOWNER, MEMBER, COLLABORATORのみ実行可能）。
```
@gemini-cli /review
```

また、特定の観点（セキュリティ、パフォーマンスなど）を指定してレビューさせることも可能です。
* `@gemini-cli /review focus on security`（セキュリティに焦点を当ててレビュー）
* `@gemini-cli /review check performance and memory usage`（パフォーマンスやメモリ使用率をチェック）
* `@gemini-cli /review look for breaking changes`（破壊的変更がないか確認）

#### ③ Actionsタブからの手動実行（Workflow Dispatch）
1. GitHubリポジトリの **Actions** タブを選択します。
2. 左側メニューから **🔎 Gemini Review** を選択します。
3. **Run workflow** をクリックし、レビュー対象の **プルリクエスト番号（Pull Request number）** と、必要に応じて指示（additional_context）を入力して実行します。
