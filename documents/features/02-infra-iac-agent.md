# インフラ・IaC個別解析エージェント 機能仕様書

Issue #31（親 Issue #17 / STEP 2-①）の機能仕様。

## 1. この機能で解決すること

レガシーシステムでは、インフラ構成図やネットワーク定義書が古くなり、実際のクラウド構成と乖離していることが多い。
本エージェントは、インフラ構成と IaC（Terraform / docker-compose / Kubernetes マニフェスト）のコードを専門に解析し、
**本来構成されるべきクラウドリソースとセキュリティ設計をコードから逆算・抽出**して、
インフラ物理/論理構成仕様（`infrastructure_spec.md`）を自動生成する。

基本方針はリポジトリ全体の思想と揃える。

- IaC コードを「正」として扱う。
- 根拠（ファイルパス）を示せない内容は断定しない。
- 抽出できない箇所は「判断不能」として明示する。

## 2. 位置づけ

`apps/analysis-worker` の解析パイプラインに組み込まれる個別エージェント。
ソースコード解析（F-02）やドキュメント抽出（F-03）と並行し、IaC に特化した成果物を 1 つ追加する。

- 実装: `apps/analysis-worker/src/infra.js`
- オーケストレータ: `apps/analysis-worker/src/orchestrator.js` の `infrastructureAgent`
- 成果物: `infrastructure_spec.md`

## 3. 入力仕様

解析対象のソースコード群に含まれる、次の IaC ファイルを自動判別して解析する。

| 種別 | 判定条件 |
| --- | --- |
| Terraform | 拡張子 `.tf` / `.tfvars` / `.hcl` |
| docker-compose | ファイル名 `docker-compose*.yml` / `compose*.yml` |
| Kubernetes マニフェスト | `.yaml` / `.yml` かつ `apiVersion:` と `kind:` を含む |

非 IaC ファイルは prompt に含めず、IaC ファイルだけを抽出してエージェントに渡す。

## 4. 処理の流れ

1. 入力ソースから IaC ファイルのみを抽出する（`filterIacFiles`）。
2. 外部 CLI に依存しない軽量な静的構造抽出を行う（`buildIacOverview`）。
   - Terraform: provider / resource / data / module / variable / output / backend ブロック。
   - docker-compose: サービス名・イメージ・公開ポート。
   - Kubernetes: kind / name / namespace（`---` 区切りの複数ドキュメントに対応）。
   - セキュリティ着目点: セキュリティグループ/ファイアウォール、IAM・権限、暗号鍵、シークレット、公開設定をリソースタイプから分類抽出。
3. 静的抽出結果を Markdown サマリーに整形する（`renderIacOverviewMarkdown`）。
4. サマリーと IaC 入力本文を `[TASK: INFRASTRUCTURE_SPEC]` prompt に組み立てる（`buildInfrastructureSpecPrompt`）。
5. Gemini API で意味的なインフラ仕様を生成し、静的サマリーと結合して `infrastructure_spec.md` を出力する。

## 5. 出力仕様（infrastructure_spec.md）

Gemini への出力指示として、次の章立てを推奨する。

1. システム構成概要
2. 論理構成（リソース一覧と役割）
3. ネットワーク構成
4. セキュリティ設計（SG/Firewall・IAM・暗号化・シークレット）
5. 依存関係・接続関係
6. 判断不能・推測事項

成果物の冒頭には、根拠ファイルパス付きの静的構造解析結果（リソース表・セキュリティ着目点表）を併記し、
Gemini の生成内容が静的事実と突き合わせて検証できるようにする。

## 6. MVPではやらないこと

| 対象外 | 理由・対応方針 |
| --- | --- |
| CloudFormation / Pulumi 等の深い解析 | MVPでは Terraform / docker-compose / Kubernetes を対象とする |
| `terraform plan` 等の実行を伴う動的解析 | Cloud Functions 上で外部 CLI に依存しない静的解析に留める |
| IaC のセキュリティ脆弱性スキャン（tfsec 等） | セキュリティ「設計」の抽出に留め、脆弱性診断は将来拡張 |
| 静的構造ダンプ成果物（`iac-structure.md` 等） | Issue #30 の責務。本エージェントは意味的仕様生成に専念する |

## 7. テスト

`apps/analysis-worker/test/infra.test.js` で、IaC ファイル判定・Terraform/compose/k8s の静的抽出・
セキュリティ分類・prompt 組み立て・エージェント結合（Gemini クライアントはスタブ）を検証する。
