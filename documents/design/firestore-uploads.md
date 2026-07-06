# Firestore データモデル設計: `uploads` コレクション

アップロードされたファイルのメタデータを管理する Firestore コレクションの設計です。
対応する実装は [apps/api/src/repositories.ts](../../apps/api/src/repositories.ts) の `FirestoreUploadRepository`、
対応する機能仕様は [05-drift-agent-ui.md](../features/05-drift-agent-ui.md) の UI-01 アップロードフォーム。

> Firestore はスキーマレスのため、コレクションやフィールドは最初の書き込み時に作られます。
> 本ドキュメントが `uploads` の「正」の構造定義です。データベース本体は
> Terraform（[infra/terraform/modules/firestore](../../infra/terraform/modules/firestore)）で管理します。

## 1. コレクション概要

| 項目 | 内容 |
| --- | --- |
| コレクション ID | `uploads`（環境変数 `FIRESTORE_UPLOADS_COLLECTION` で変更可。既定: `uploads`） |
| ドキュメント ID | アップロード ID（`upload-` プレフィックス + UUID v4。`upload_id` フィールドにも同値を保持） |
| 用途 | 1 アップロード操作 = 1 ドキュメント。アップロードされたファイルの GCS URI とメタデータを保持 |

## 2. フィールド定義

| フィールド | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| `upload_id` | string | ✓ | アップロード ID。ドキュメント ID と同値 |
| `source_archive_uri` | string | ✓ | ソースコードアーカイブの GCS URI（例: `gs://bucket/uploads/upload-id/source/src.zip`） |
| `document_uris` | array\<string\> | ✓ | 既存ドキュメント群の GCS URI 配列 |
| `project_name` | string |   | ユーザー入力のプロジェクト名（任意） |
| `source_file_name` | string |   | アップロードされたソースファイルのオリジナルファイル名 |
| `document_file_names` | array\<string\> |   | アップロードされた各ドキュメントのオリジナルファイル名 |
| `created_at` | timestamp | ✓ | アップロード日時（サーバータイムスタンプ） |

## 3. ライフサイクル

`uploads` コレクションのドキュメントは作成後に更新されない（イミュータブル）。
ジョブ作成時に `jobs` コレクションの `upload_id` フィールドから参照される。

```
POST /upload → uploads ドキュメント作成
     │
     ▼
POST /jobs { uploadId } → uploads から source_archive_uri / document_uris を取得
                        → jobs ドキュメント作成
```

## 4. `jobs` コレクションとの関係

| 関係 | 説明 |
| --- | --- |
| `jobs.upload_id` → `uploads.upload_id` | ジョブがどのアップロードに紐づくかを示す。任意フィールド（GCS URI を直接指定するフローでは null） |
| ソース/ドキュメント URI の引き継ぎ | `POST /jobs` で `uploadId` のみ指定した場合、`uploads` の `source_archive_uri` / `document_uris` / `project_name` が `jobs` に引き継がれる |

## 5. ドキュメント例

```json
{
  "upload_id": "upload-1a2b3c4d-5e6f-7890-abcd-ef0123456789",
  "source_archive_uri": "gs://phoenix-assets/uploads/upload-1a2b3c4d/source/src.zip",
  "document_uris": [
    "gs://phoenix-assets/uploads/upload-1a2b3c4d/documents/0001-spec.pdf",
    "gs://phoenix-assets/uploads/upload-1a2b3c4d/documents/0002-design.xlsx"
  ],
  "project_name": "レガシーSaaS引き継ぎ案件A",
  "source_file_name": "src.zip",
  "document_file_names": ["spec.pdf", "design.xlsx"],
  "created_at": "2026-06-08T09:00:00Z"
}
```

## 6. 運用上の注意

- `upload_id` は API が自動生成する。手動でドキュメントを作成しない。
- `created_at` はクライアント時刻ではなくサーバータイムスタンプを使う。
- `uploads` に対する複合インデックスは現時点で不要（ドキュメント ID 直接取得のみ）。
- スキーマ（フィールド追加・型変更）を変えるときは、本ドキュメントと
  機能仕様を同じ PR で更新する（ドリフト防止）。
- TTL ポリシーは未設定。古い uploads ドキュメントの削除は月次の手動メンテナンスで対応する
  （[監視・運用ガイド](../engineering/monitoring.md) §7 参照）。
