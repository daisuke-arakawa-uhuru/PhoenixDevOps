# 解析ジョブ状態（queued / running / succeeded / failed）を保持する Firestore データベース。
#
# 注意: Firestore はスキーマレスであり、コレクション（jobs）やドキュメントのフィールドは
# 「最初の書き込み時」に作成される。したがって IaC で管理できるのは
#   - データベース本体（ロケーション・モード）
#   - クエリに必要な複合インデックス
# であり、コレクションのスキーマ自体はドキュメントで管理する。
#   → ../../../../documents/design/firestore-jobs.md（jobs コレクション設計）
resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = var.database_name
  location_id = var.location
  type        = "FIRESTORE_NATIVE"

  # 誤削除防止（Firestore 側の保護）
  delete_protection_state = var.delete_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"

  # Terraform destroy 時の挙動。ABANDON で state から外すだけにし実体は残す（誤消し防止）。
  deletion_policy = "ABANDON"
}

# jobs コレクションの一覧取得用 複合インデックス。
# 例: 特定 status のジョブを作成日時の新しい順に一覧する
#   collection("jobs").where("status", "==", "running").orderBy("created_at", "desc")
# 単一フィールドのクエリは自動インデックスで足りるため、複合のみ定義する。
resource "google_firestore_index" "jobs_status_created_at" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "jobs"

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }
  fields {
    field_path = "created_at"
    order      = "DESCENDING"
  }
}