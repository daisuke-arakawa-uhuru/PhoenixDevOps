# Firestore データモデル設計: `jobs` コレクション

解析ジョブの状態を管理する Firestore コレクションの設計です（Issue #2 / 新川担当）。
対応する機能仕様は [F-06 解析ジョブ管理](../features/01-document-drift-agent.md#8-解析ジョブ管理)。

> Firestore はスキーマレスのため、コレクションやフィールドは最初の書き込み時に作られます。
> 本ドキュメントが `jobs` の「正」の構造定義です。データベース本体と複合インデックスのみ
> Terraform（[infra/terraform/modules/firestore](../../infra/terraform/modules/firestore)）で管理します。

## 1. コレクション概要

| 項目 | 内容 |
| --- | --- |
| コレクション ID | `jobs` |
| ドキュメント ID | ジョブ ID（UUID v4 を推奨。`id` フィールドにも同値を保持） |
| 用途 | 1 解析ジョブ = 1 ドキュメント。状態遷移と結果メタdata を保持 |

## 2. フィールド定義

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `id` | string | ✓ | ジョブ ID。ドキュメント ID と同値 |
| `job_id` | string | ✓ | ジョブ ID（`id` と同値。API 側の書き込み互換用） |
| `status` | string | ✓ | ジョブ状態。`queued` / `running` / `succeeded` / `failed` のいずれか |
| `project_name` | string |   | ユーザー入力のプロジェクト名（任意。成果物タイトルに使用） |
| `source_archive_uri` | string | ✓ | ソースコードアーカイブの GCS URI（例: `gs://bucket/uploads/upload-id/source/src.zip`） |
| `document_uris` | array\<string\> | ✓ | 既存ドキュメント群の GCS URI 配列 |
| `upload_id` | string |   | 対応するアップロードの ID（`uploads` コレクションへの参照） |
| `results_prefix` | string |   | 生成成果物の GCS プレフィックス（例: `results/<job_id>/`） |
| `artifact_paths` | map\<string, string\> |   | 成果物ファイル名と GCS URI のマップ。解析ワーカーが `succeeded` 時に書き込む |
| `created_at` | timestamp | ✓ | ジョブ作成日時（サーバータイムスタンプ） |
| `updated_at` | timestamp | ✓ | 最終更新日時（状態遷移のたびに更新） |
| `error_message` | string |   | `failed` 時の失敗理由。ユーザーに表示する |

> `source_archive_uri` / `document_uris` は Cloud Storage（[storage モジュール](../../infra/terraform/modules/storage)）の
> `uploads/` 配下にアップロード単位のサブプレフィックスを切る運用に対応した参照フィールド。
> `upload_id` は `uploads` コレクション（[firestore-uploads.md](./firestore-uploads.md)）へのリレーション。
> `artifact_paths` は解析ワーカーが `succeeded` 時に保存し、API の `GET /jobs/{jobId}/results` で署名付き URL の生成元として使用する。

## 3. 状態遷移

```
        作成
         │
         ▼
      queued ──────────► running ──────────► succeeded
                            │
                            └──────────────► failed ──(ユーザーが再実行)──► queued
```

| 状態 | 意味 |
| --- | --- |
| `queued` | ジョブ作成済み・実行待ち |
| `running` | ソースコード解析 / ドキュメント抽出 / 成果物生成のいずれかを実行中 |
| `succeeded` | 成果物生成が完了 |
| `failed` | 解析または生成に失敗（`error_message` に理由）。再実行で `queued` に戻せる |

## 4. クエリとインデックス

| クエリ | インデックス | 定義場所 |
| --- | --- | --- |
| ドキュメント ID 直接取得（状態取得 API） | 不要（キー取得） | — |
| `status` 単一での絞り込み | 自動単一フィールドインデックス | 自動 |
| `status` で絞り `created_at` 降順で一覧 | 複合インデックス `status ASC, created_at DESC` | [firestore/main.tf](../../infra/terraform/modules/firestore/main.tf) `jobs_status_created_at` |

新しいクエリパターンを追加する場合は、必要な複合インデックスを firestore モジュールに追記し、
本表も更新すること（インデックス未定義のクエリは実行時エラーになる）。

## 5. ドキュメント例

```json
{
  "id": "1f2e3d4c-5b6a-7980-abcd-ef0123456789",
  "job_id": "1f2e3d4c-5b6a-7980-abcd-ef0123456789",
  "status": "running",
  "project_name": "レガシーSaaS引き継ぎ案件A",
  "source_archive_uri": "gs://phoenix-assets/uploads/upload-abc/source/src.zip",
  "document_uris": [
    "gs://phoenix-assets/uploads/upload-abc/documents/0001-spec.pdf"
  ],
  "upload_id": "upload-abc",
  "results_prefix": "results/1f2e3d4c-5b6a-7980-abcd-ef0123456789",
  "artifact_paths": {},
  "created_at": "2026-06-08T09:00:00Z",
  "updated_at": "2026-06-08T09:01:12Z",
  "error_message": null
}
```

## 6. 運用上の注意

- `status` は上記 4 値のみ。アプリ側で enum として扱い、未定義値を書き込まない。
- `created_at` / `updated_at` はクライアント時刻ではなくサーバータイムスタンプを使う。
- スキーマ（フィールド追加・型変更・状態追加）を変えるときは、本ドキュメントと
  機能仕様・必要なインデックスを同じ PR で更新する（ドリフト防止）。