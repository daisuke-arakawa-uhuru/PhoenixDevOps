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
| `status` | string | ✓ | ジョブ状態。`queued` / `running` / `succeeded` / `failed` のいずれか |
| `project_name` | string |   | ユーザー入力のプロジェクト名（任意。成果物タイトルに使用） |
| `created_at` | timestamp | ✓ | ジョブ作成日時（サーバータイムスタンプ） |
| `updated_at` | timestamp | ✓ | 最終更新日時（状態遷移のたびに更新） |
| `error_message` | string |   | `failed` 時の失敗理由。ユーザーに表示する |
| `uploads_prefix` | string |   | 入力ファイルの GCS プレフィックス（例: `uploads/<job_id>/`） |
| `results_prefix` | string |   | 生成成果物の GCS プレフィックス（例: `results/<job_id>/`） |

> `uploads_prefix` / `results_prefix` は Cloud Storage（[storage モジュール](../../infra/terraform/modules/storage)）の
> `uploads/` `results/` 配下にジョブ単位のサブプレフィックスを切る運用を想定した補助フィールド。
> 必須ではないが、ジョブと保存先の対応を Firestore 側で引けるようにするため定義する。

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
  "status": "running",
  "project_name": "レガシーSaaS引き継ぎ案件A",
  "created_at": "2026-06-08T09:00:00Z",
  "updated_at": "2026-06-08T09:01:12Z",
  "error_message": null,
  "uploads_prefix": "uploads/1f2e3d4c-5b6a-7980-abcd-ef0123456789/",
  "results_prefix": "results/1f2e3d4c-5b6a-7980-abcd-ef0123456789/"
}
```

## 6. 運用上の注意

- `status` は上記 4 値のみ。アプリ側で enum として扱い、未定義値を書き込まない。
- `created_at` / `updated_at` はクライアント時刻ではなくサーバータイムスタンプを使う。
- スキーマ（フィールド追加・型変更・状態追加）を変えるときは、本ドキュメントと
  機能仕様・必要なインデックスを同じ PR で更新する（ドリフト防止）。