# Drift Agent HTTP API

Issue #3 用の Cloud Functions HTTP API です。Node.js 24、TypeScript、Hono で実装し、アップロード受付、解析ジョブ作成、ジョブ状態取得、成果物 URL 取得を担当します。

## 構成

- `src/index.ts`: Cloud Functions HTTP エントリポイント `driftApi`
- `src/app.ts`: Hono のルーティング、CORS、エラーハンドリング
- `src/service.ts`: アップロード、ジョブ作成、状態取得、成果物 URL 取得の業務ロジック
- `src/storage.ts`: Cloud Storage へのアップロードと署名付き URL 生成
- `src/repositories.ts`: Firestore の uploads/jobs repository
- `src/tasks.ts`: Cloud Tasks への解析ワーカー起動タスク登録
- `src/config.ts`: 環境変数の読み込みと検証
- `test/*.test.ts`: Node.js test runner のテスト
- `dist/`: `npm run build` で生成される Cloud Functions 実行用 JavaScript

## エンドポイント

### `POST /upload`

`multipart/form-data` で解析入力ファイルを受け取り、Cloud Storage に保存します。

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `sourceArchive` | はい | ソースコード ZIP |
| `documents` | はい | 既存ドキュメント。複数指定可 |
| `projectName` | いいえ | プロジェクト名 |

レスポンス例:

```json
{
  "uploadId": "upload-123",
  "projectName": "Legacy SaaS",
  "sourceArchiveUri": "gs://phoenix-uploads/uploads/upload-123/source/source.zip",
  "documentUris": [
    "gs://phoenix-uploads/uploads/upload-123/documents/0001-spec.pdf"
  ]
}
```

### `POST /jobs`

Firestore に `queued` の解析ジョブを作成し、Cloud Tasks に解析ワーカー起動タスクを追加します。

`uploadId` を使う通常フロー:

```json
{
  "uploadId": "upload-123"
}
```

GCS URI を直接指定するフロー:

```json
{
  "projectName": "Legacy SaaS",
  "sourceArchiveUri": "gs://phoenix-uploads/uploads/upload-123/source/source.zip",
  "documentUris": [
    "gs://phoenix-uploads/uploads/upload-123/documents/0001-spec.pdf"
  ]
}
```

Cloud Tasks payload は解析ワーカーの契約に合わせ、次の形式で送信します。

```json
{
  "jobId": "job-123",
  "projectName": "Legacy SaaS",
  "sourceArchiveUri": "gs://phoenix-uploads/uploads/upload-123/source/source.zip",
  "documentUris": [
    "gs://phoenix-uploads/uploads/upload-123/documents/0001-spec.pdf"
  ],
  "resultsPrefix": "results/job-123"
}
```

### `GET /jobs/{jobId}`

Firestore の `jobs/{jobId}` を読み、現在の状態を返します。

### `GET /jobs/{jobId}/results`

`succeeded` のジョブだけ成果物の署名付き URL を返します。ワーカーが保存する成果物は `true-design.md` と `document-drift-report.md` を想定しています。

## Firestore schema

### `uploads/{uploadId}`

```json
{
  "upload_id": "upload-123",
  "source_archive_uri": "gs://...",
  "document_uris": ["gs://..."],
  "project_name": "Legacy SaaS",
  "source_file_name": "source.zip",
  "document_file_names": ["spec.pdf"],
  "created_at": "SERVER_TIMESTAMP"
}
```

### `jobs/{jobId}`

```json
{
  "job_id": "job-123",
  "upload_id": "upload-123",
  "project_name": "Legacy SaaS",
  "source_archive_uri": "gs://...",
  "document_uris": ["gs://..."],
  "results_prefix": "results/job-123",
  "status": "queued",
  "artifact_paths": {},
  "error_message": null,
  "created_at": "SERVER_TIMESTAMP",
  "updated_at": "SERVER_TIMESTAMP"
}
```

解析ワーカーは同じ `jobs` collection の `status`, `artifact_paths`, `error_message` を更新します。

## 環境変数

| 変数名 | 必須 | 説明 |
| --- | --- | --- |
| `UPLOADS_BUCKET` | はい | アップロードと成果物を保存する Cloud Storage bucket |
| `FIRESTORE_UPLOADS_COLLECTION` | いいえ | デフォルト: `uploads` |
| `FIRESTORE_JOBS_COLLECTION` | いいえ | デフォルト: `jobs` |
| `TASKS_PROJECT_ID` | 条件付き | Cloud Tasks project。未指定時は `GOOGLE_CLOUD_PROJECT` / `GCP_PROJECT` を使用 |
| `TASKS_LOCATION` | はい | Cloud Tasks queue location |
| `TASKS_QUEUE` | はい | Cloud Tasks queue name |
| `WORKER_URL` | はい | 解析ワーカー Cloud Functions URL |
| `TASKS_SERVICE_ACCOUNT_EMAIL` | いいえ | ワーカー呼び出し用 OIDC service account |
| `SIGNED_URL_EXPIRATION_SECONDS` | いいえ | 成果物 URL 有効秒数。デフォルト: `3600` |
| `UPLOADS_PREFIX_TEMPLATE` | いいえ | デフォルト: `uploads/{upload_id}` |
| `RESULTS_PREFIX_TEMPLATE` | いいえ | デフォルト: `results/{job_id}` |
| `MAX_DOCUMENT_FILES` | いいえ | デフォルト: `600` |

## ローカル確認

Node.js はリポジトリ root の `.node-version` に合わせて 24 系を使用します。

```bash
cd apps/api
npm install
npm run build
npm test
```

## デプロイ例

```bash
gcloud functions deploy drift-api \
  --gen2 \
  --runtime nodejs24 \
  --region asia-northeast1 \
  --source apps/api \
  --entry-point driftApi \
  --trigger-http \
  --set-env-vars UPLOADS_BUCKET=phoenix-uploads,FIRESTORE_UPLOADS_COLLECTION=uploads,FIRESTORE_JOBS_COLLECTION=jobs,TASKS_LOCATION=asia-northeast1,TASKS_QUEUE=analysis-jobs,WORKER_URL=https://example-worker-url
```
