# 解析ワーカー

Issue #4 用の Cloud Functions バックグラウンドワーカーです。Cloud Tasks から HTTP で起動され、Cloud Storage から入力を読み込み、Firestore のジョブ状態を更新し、Gemini API で成果物を生成します。

## 構成

- `src/index.js`: Cloud Functions HTTP エントリポイント `runAnalysisWorker`
- `src/payload.js`: Cloud Tasks payload の検証と正規化
- `src/repositories.js`: Firestore のジョブ状態管理境界
- `src/storage.js`: Cloud Storage/ローカル入力読み込みと成果物保存の境界
- `src/orchestrator.js`: ジョブ状態遷移と解析フェーズ実行制御
- `src/engines.js`: F-02/F-03/F-04/F-05 の解析・生成フェーズ境界
- `src/code-map.js`: ソースコードの静的構造マップ、依存グラフ、IaC構造ダンプ生成
- `src/prompts.js`: Gemini に渡す prompt 生成
- `src/local-runner.js`: ローカル実行用 CLI

## システム構成

```mermaid
flowchart LR
    Api["HTTP API<br/>Issue #3"] -->|"ジョブ登録"| Tasks["Cloud Tasks"]
    Tasks -->|"解析ジョブ起動"| WorkerEntry["解析ワーカー<br/>Cloud Functions / Node.js"]

    subgraph Worker["解析ワーカー内部"]
        WorkerEntry --> Orchestrator["解析オーケストレーター"]
        Orchestrator --> Input["入力取得"]
        Orchestrator --> Engines["解析・生成エンジン"]
        Orchestrator --> Output["成果物保存"]
    end

    Input -->|"読み込み"| Uploads["Cloud Storage<br/>uploads/"]
    Engines -->|"prompt 実行"| Gemini["Gemini API"]
    Output -->|"保存"| Results["Cloud Storage<br/>results/"]
    Orchestrator -->|"状態管理"| Firestore["Firestore<br/>jobs"]
```

## タスク Payload

HTTP API 側との接続を容易にするため、`snake_case` と `camelCase` の両方を受け付けます。

```json
{
  "jobId": "job-123",
  "projectName": "Legacy SaaS",
  "sourceArchiveUri": "gs://phoenix-uploads/uploads/job-123/source.zip",
  "documentUris": [
    "gs://phoenix-uploads/uploads/job-123/docs/spec.pdf"
  ],
  "resultsPrefix": "results/job-123"
}
```

`documents` にはオブジェクト形式も指定できます。

```json
{
  "bucket": "phoenix-uploads",
  "object": "uploads/job-123/docs/spec.pdf"
}
```

## ローカル確認

Node.js はリポジトリ root の `.node-version` に合わせて 24 系を使用します。

```bash
cd apps/analysis-worker
npm test
```

## ローカル実行

依存関係をインストールすると、Functions Framework や Gemini / Google Cloud SDK を含めたローカル実行ができます。

### 1. 依存関係のインストール

```bash
cd apps/analysis-worker
npm install
```

### 2. APIキー（Google AI Studio）を使用するローカル実行

`dry-run` を明示した場合のみ `GEMINI_API_KEY` は不要です。

```bash
npm run local -- \
  --source "../../sample/CustomerServiceManagement/src.zip" \
  --document "../../sample/CustomerServiceManagement/doc.pdf" \
  --project-name "MyProject" \
  --job-id "local-test-01" \
  --dry-run
```

### 3. ADC（Vertex AI）を使用するローカル実行

APIキーの代わりに Google Cloud の Application Default Credentials (ADC) を使って Vertex AI 経由で Gemini を動かす手順です。

#### 3.1. Google Cloud CLI (gcloud) のパス設定
Windows の場合、gcloud は通常以下の場所にインストールされます。パスが通っていない場合は環境変数 PATH に追加してください。
- `%USERPROFILE%\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin`

#### 3.2. ADC認証のセットアップ
以下のコマンドを実行し、ブラウザで Google アカウントにサインインして認証情報を取得します。
```bash
gcloud auth application-default login
```

#### 3.3. Vertex AI API の有効化
対象の Google Cloud プロジェクトで Vertex AI API を有効にします。
```bash
gcloud services enable aiplatform.googleapis.com --project=<GCP_PROJECT_ID>
```

#### 3.4. 環境変数の設定
`apps/analysis-worker/.env.example` を `apps/analysis-worker/.env` にコピーし、以下のように書き換えてください。
`npm run local` は起動時に `apps/analysis-worker/.env` を自動で読み込みます。シェルで明示した環境変数がある場合は、そちらが優先されます。
```env
GEMINI_USE_VERTEX_AI=true
GOOGLE_CLOUD_PROJECT=<GCP_PROJECT_ID>
GOOGLE_CLOUD_LOCATION=global
```

※ 競合を避けるため、`GEMINI_API_KEY` がシステム環境変数にある場合は設定を外すか、`.env` で指定しないようにしてください。

#### 3.5. 実行
`--dry-run` を指定せずに実行します。
```bash
npm run local -- \
  --source "../../sample/CustomerServiceManagement/src.zip" \
  --document "../../sample/CustomerServiceManagement/doc.pdf" \
  --project-name "CustomerServiceManagement"
```

### 4. 出力成果物

出力先はデフォルトで `output/{job_id}/` です。変更する場合は `--output` を指定してください。

生成される成果物は次の通りです。

| ファイル | 内容 |
| --- | --- |
| `true-design.md` | ソースコード由来の情報を正とした真の設計書 |
| `document-drift-report.md` | 既存ドキュメントとの差分レポート |
| `database_schema_spec.md` | DB・データモデル仕様書（ER図、データディクショナリ、リレーション・制約一覧） |
| `business_logic_spec.md` | ビジネスロジック仕様書（機能一覧、ユースケース、状態遷移、シーケンス図） |
| `codebase-map.md` | ディレクトリツリー、ファイルメタデータ、依存リスト、API/DB候補の静的解析ダンプ |
| `module-dependencies.mmd` | JS/TS、Python、Go の import/require を軽量抽出した Mermaid 依存グラフ |
| `iac-structure.md` | Terraform の provider/module/resource/data/variable/output 構造リスト |
| `codebase-map.json` | 後続エージェントが再利用しやすい構造化 JSON |

## 環境変数

| 変数名 | 必須 | 説明 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 条件付き | Gemini API のキー。Vertex AI (ADC) を使用しない場合かつ `GEMINI_DRY_RUN` が未指定または `false` の場合は必須です。 |
| `GEMINI_MODEL` | 任意 | 使用するモデル。デフォルト: `gemini-3.1-flash-lite` |
| `GEMINI_DRY_RUN` | 任意 | `true` / `1` / `yes` で明示的に dry-run client を使用し、Gemini API を呼び出しません。 |
| `GEMINI_USE_VERTEX_AI` <br/> `GOOGLE_GENAI_USE_VERTEXAI` | 任意 | `true` / `1` / `yes` で Vertex AI (ADC) 経由での呼び出しを有効にします。また、`GEMINI_API_KEY` が未指定の場合は自動的に Vertex AI (ADC) モードになります。 |
| `GOOGLE_CLOUD_PROJECT` <br/> `GCP_PROJECT` <br/> `GEMINI_PROJECT` | 条件付き | Vertex AI 使用時の Google Cloud プロジェクト ID。 |
| `GOOGLE_CLOUD_LOCATION` <br/> `GCP_LOCATION` <br/> `GEMINI_LOCATION` | 条件付き | Vertex AI 使用時の endpoint location。デフォルト例: `global`。 |
| `FIRESTORE_JOBS_COLLECTION` | 任意 | ジョブ状態を保存する Firestore コレクション。デフォルト: `jobs` |
| `RESULTS_BUCKET` | 任意 | 成果物保存先 bucket。未指定時は source archive と同じ bucket を使います。 |
| `RESULTS_PREFIX_TEMPLATE` | 任意 | 成果物 prefix。デフォルト: `results/{job_id}` |

## Gemini API quota エラー

`429 RESOURCE_EXHAUSTED` が返り、本文に `free_tier` や `limit: 0` が含まれる場合、ワーカーは
Gemini API へ到達していますが、API key が紐づく Google Cloud project / billing account に利用可能な
Gemini API quota がありません。Google AI Studio の Billing / Rate limits で、対象 project が paid tier
または利用可能な prepaid credit を持つ状態か確認してください。

一時的な RPM / TPM 超過の場合のみ、ワーカーは `RetryInfo` の秒数または指数バックオフで最大 2 回 retry します。
`limit: 0` の quota エラーは設定・課金側の問題として retry せず失敗させます。

## Cloud Functions デプロイ例

Terraform では [infra/terraform/modules/analysis_worker](../../infra/terraform/modules/analysis_worker) が
この構成を管理します。

### 1. API キーを使用する場合のデプロイ例
```bash
gcloud functions deploy analysis-worker \
  --gen2 \
  --runtime nodejs24 \
  --region asia-northeast1 \
  --source apps/analysis-worker \
  --entry-point runAnalysisWorker \
  --trigger-http \
  --set-env-vars FIRESTORE_JOBS_COLLECTION=jobs,RESULTS_PREFIX_TEMPLATE=results/{job_id},GEMINI_MODEL=gemini-3.1-flash-lite,GEMINI_DRY_RUN=false \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

### 2. ADC (Vertex AI) を使用する場合のデプロイ例
サービスアカウントに **Vertex AI ユーザー**（`roles/aiplatform.user`）ロールを付与した上で、以下のようにシークレットキーを設定せずにデプロイします。
```bash
gcloud functions deploy analysis-worker \
  --gen2 \
  --runtime nodejs24 \
  --region asia-northeast1 \
  --source apps/analysis-worker \
  --entry-point runAnalysisWorker \
  --trigger-http \
  --set-env-vars FIRESTORE_JOBS_COLLECTION=jobs,RESULTS_PREFIX_TEMPLATE=results/{job_id},GEMINI_MODEL=gemini-3.1-flash-lite,GEMINI_DRY_RUN=false,GEMINI_USE_VERTEX_AI=true,GEMINI_LOCATION=global
```

現時点では Gemini prompt と呼び出し口、入力本文取得、軽量な事前構造解析までの実装です。静的解析は Cloud Functions 上で外部 CLI に依存しない実装とし、依存マップは Mermaid、IaC は Markdown/JSON の構造ダンプとして保存します。PDF は `pdf-parse`、Excel は xlsx 内 XML の軽量抽出、ZIP は標準ライブラリベースの読み取りで扱います。

## DB・データモデル解析（STEP 2-②）

STEP 1 の静的解析成果物（`codebase-map.json` の `databaseDefinitions`）と、SQL / Prisma / TypeORM / SQLAlchemy / Sequelize / Rails migration などのDB関連ファイルを入力として、DB・データモデルの個別解析を行います。

### 解析内容

- DB定義候補ファイルを自動特定
- Gemini API でテーブル構造、リレーション、インデックス、制約を解析・言語化
- Mermaid形式のER図、テーブル一覧、データディクショナリ、リレーション・制約一覧を含む仕様書を生成

### 成果物

| ファイル | 内容 |
| --- | --- |
| `database_schema_spec.md` | DB・データモデル仕様書（ER図、テーブル一覧、データディクショナリ、リレーション、インデックス・制約一覧、判断不能・推測事項） |

## ビジネスロジック解析（STEP 2-④）

STEP 1 の静的解析成果物（`codebase-map.json`、`exported-symbols-*.md`）を入力として、ビジネスロジック・ユースケースの個別解析を行います。

### 解析内容

- サービス層、ドメインモデル、ユースケースのコードからビジネスロジックファイルを自動特定
- Gemini API でビジネスフロー、条件分岐、状態遷移を解析・言語化
- 機能一覧、ユースケースシナリオ、Mermaid形式のシーケンス図・状態遷移図を含む仕様書を生成

### 成果物

| ファイル | 内容 |
| --- | --- |
| `business_logic_spec.md` | ビジネスロジック仕様書（機能一覧、ユースケースシナリオ、状態遷移、シーケンス図、例外処理・ロールバック仕様、ビジネスルール） |
