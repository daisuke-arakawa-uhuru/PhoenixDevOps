# CLAUDE.md

このファイルは、Claude Code をはじめとする AI エージェントが本リポジトリで作業する際の
中心的なコンテキスト（プロジェクト憲法）です。**作業を始める前に必ず読み込まれます。**

他ツール（Cursor / Codex / 各種エージェント）向けの入口は [AGENTS.md](AGENTS.md) にあります。
内容はこの `CLAUDE.md` を正としており、AGENTS.md はそこへの参照です。

---

## 1. プロダクト概要

**PhoenixDevOps** は、前任者の退職・他社引き継ぎで生じた「ドキュメントと実態の乖離」「IaC の崩壊」
といった負の遺産を再生する **AI エージェントシステム**です（DevOps x AI Agent Hackathon 2026）。

- プロダクト概要: [documents/product/index.md](documents/product/index.md)
- MVP 機能仕様（ドキュメント・ドリフト検知エージェント）: [documents/features/01-document-drift-agent.md](documents/features/01-document-drift-agent.md)
- ハッカソン技術条件: [input/技術の使用条件.md](input/技術の使用条件.md)

## 2. アーキテクチャ（MVP）

Web 画面から API を呼び、解析ジョブを非同期実行する構成です。

```
ユーザー → Web画面 → Cloud Functions(API) ── Cloud Storage(uploads/results)
                          │                 ├ Firestore(ジョブ状態)
                          │                 └ Cloud Tasks(analysis-job-queue)
                          └ Cloud Tasks → Cloud Functions(解析ワーカー) → Gemini API
```

| レイヤ | 採用技術 | 用途 |
| --- | --- | --- |
| API 実行基盤 | Cloud Functions | ジョブ作成 / 状態取得 / 成果物取得 API |
| 非同期実行 | Cloud Tasks | 解析ジョブのキューイング・ワーカー起動・リトライ |
| ジョブ状態管理 | Firestore | `queued / running / succeeded / failed` |
| ファイル保管 | Cloud Storage | ソースコード群・既存ドキュメント群・生成成果物 |
| AI 技術 | Gemini API | ソースコード解析・差分比較・成果物生成 |

## 3. ディレクトリ構成

```text
PhoenixDevOps/
├── apps/              # アプリ（api / ui / analysis-worker）
│   ├── api/           # HTTP API（Hono / Cloud Functions）
│   ├── ui/            # Web UI（Vite + React + TypeScript）
│   └── analysis-worker/ # 解析ワーカー（Cloud Functions / Gemini API）
├── documents/         # プロダクト概要・機能仕様・設計メモ
│   ├── product/       # プロダクト概要書
│   ├── features/      # 機能仕様書
│   ├── design/        # 設計ドキュメント（アーキテクチャ・静的解析・Firestore）
│   ├── engineering/   # 開発・ハーネス運用の規約
│   └── infra/         # インフラ関連の参考資料（構成図等）
├── infra/             # GCP 構成（Terraform / IaC）
│   └── terraform/     # modules/ と envs/ に分割
├── input/             # ハッカソン条件などの外部入力資料
├── sample/            # 解析テスト用サンプルデータ
├── .github/workflows/ # CI/CD（Terraform plan/apply）
├── .claude/           # エージェントのハーネス設定（commands / agents / settings）
├── AGENTS.md          # 他ツール向けエージェント入口
└── CLAUDE.md          # このファイル
```

## 4. 開発の進め方（重要な規約）

### ブランチ・コミット
- ブランチ名は `feature/issue-<番号>-<担当者>` 形式（例: `feature/issue-2-arakawa`）。
- 1 つの Issue / 担当領域に対し 1 ブランチ。`master` への直接コミットはしない。
- コミット作者はリポジトリのローカル git 設定に従う（担当者ごとに `includeIf` で自動切替）。
- コミットメッセージは日本語可。**何を・なぜ** が分かる粒度で。

### Issue 駆動
- 作業はまず該当 Issue とそのコメント欄を確認し、担当範囲（アサイン）を特定してから着手する。
- 担当外の領域には踏み込まない。境界が曖昧なら Issue で確認する。

### IaC（インフラ）の鉄則
- **GCP リソースはすべて Terraform で管理する**。コンソールからの手動変更は禁止
  （手動変更による「IaC の崩壊」こそ本プロダクトが解決したい課題そのものであり、自分たちが再現してはならない）。
- 変更は必ず PR → `terraform plan` を CI で確認 → レビュー → マージ後 `apply` の順。
- state は GCS バックエンドで共有。ローカル state はコミットしない。
- 認証は Workload Identity 連携（WIF）。サービスアカウントの長期キーは作らない・コミットしない。

### ドキュメントの扱い
- 「ソースコードを正」とする本プロダクトの思想に倣い、**実装とドキュメントを乖離させない**。
  構成・スキーマ・運用を変えたら、対応するドキュメント（このファイル含む）も同じ PR で更新する。

## 5. このリポジトリでよく使うコマンド

エージェント用のカスタムスラッシュコマンドを `.claude/commands/` に用意しています。

| コマンド | 用途 |
| --- | --- |
| `/spec` | MVP 機能仕様・プロダクト概要を読み込んで把握する |
| `/tf-plan` | infra の Terraform を fmt/validate/plan する手順を実行する |
| `/issue-branch` | Issue 番号から担当ブランチを作成する |

サブエージェント（`.claude/agents/`）:

| エージェント | 役割 |
| --- | --- |
| `iac-reviewer` | Terraform / GCP 構成をベストプラクティス観点でレビュー |
| `spec-guardian` | 変更が機能仕様と整合しているか、ドキュメント更新漏れがないか点検 |

## 6. ハーネスエンジニアリング方針

本リポジトリは「git-agent 思想」に基づき、**AI エージェントの作業環境（ハーネス）そのものを
git 管理対象として育てる**方針をとります。CLAUDE.md・AGENTS.md・`.claude/`（commands / agents /
settings）・規約ドキュメントはすべてバージョン管理し、チーム全員が同じ前提でエージェントを動かします。

詳細・運用ルールは [documents/engineering/harness.md](documents/engineering/harness.md) を参照。

## 7. 禁止事項・注意

- 本番相当リソースを破壊する操作（`terraform destroy`、バケット削除等）はユーザー承認なしに実行しない。
- シークレット（API キー、SA キー、`*.tfvars` の実値）はコミットしない。Secret Manager / GitHub Secrets を使う。
- 担当外（他メンバーのアサイン領域）のリソースを勝手に変更しない。