locals {
  # リソース名の共通プレフィックス（例: phoenixdevops-dev）
  name_prefix = "phoenixdevops-${var.environment}"
}

# === Cloud Storage: ソースコード群 / 既存ドキュメント群 / 生成成果物 ===
# uploads/（入力）と results/（成果物）を 1 バケット内のプレフィックスで分離する。
module "storage" {
  source = "../../modules/storage"

  project_id  = var.project_id
  bucket_name = "${local.name_prefix}-assets"
  location    = var.storage_location

  force_destroy          = var.force_destroy
  uploads_retention_days = var.uploads_retention_days
  results_retention_days = var.results_retention_days
}

# === Cloud Tasks: 解析ジョブキュー ===
module "tasks" {
  source = "../../modules/tasks"

  project_id = var.project_id
  location   = var.region
  queue_name = "analysis-job-queue"
}

# === Firestore: 解析ジョブ状態（jobs コレクション） ===
module "firestore" {
  source = "../../modules/firestore"

  project_id        = var.project_id
  location          = var.region
  delete_protection = var.firestore_delete_protection
}