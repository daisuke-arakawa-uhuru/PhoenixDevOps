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

# === Cloud Functions: Cloud Tasks から起動される解析ワーカー ===
module "analysis_worker" {
  source = "../../modules/analysis_worker"

  project_id             = var.project_id
  location               = var.region
  function_name          = coalesce(var.analysis_worker_function_name, "${local.name_prefix}-analysis-worker")
  source_dir             = abspath("${path.root}/../../../../apps/analysis-worker")
  source_bucket_name     = coalesce(var.analysis_worker_source_bucket_name, "${local.name_prefix}-function-source")
  source_bucket_location = var.storage_location
  assets_bucket_name     = module.storage.bucket_name

  runtime                          = var.analysis_worker_runtime
  worker_service_account_id        = coalesce(var.analysis_worker_service_account_id, "pdx-${var.environment}-worker")
  task_invoker_service_account_id  = coalesce(var.analysis_task_invoker_service_account_id, "pdx-${var.environment}-task-invoker")
  available_memory                 = var.analysis_worker_available_memory
  timeout_seconds                  = var.analysis_worker_timeout_seconds
  min_instance_count               = var.analysis_worker_min_instance_count
  max_instance_count               = var.analysis_worker_max_instance_count
  max_instance_request_concurrency = var.analysis_worker_max_instance_request_concurrency
  ingress_settings                 = var.analysis_worker_ingress_settings

  firestore_jobs_collection     = var.firestore_jobs_collection
  results_prefix_template       = var.analysis_worker_results_prefix_template
  gemini_model                  = var.analysis_worker_gemini_model
  gemini_dry_run                = var.analysis_worker_gemini_dry_run
  gemini_api_key_secret_id      = var.gemini_api_key_secret_id
  gemini_api_key_secret_version = var.gemini_api_key_secret_version
}
