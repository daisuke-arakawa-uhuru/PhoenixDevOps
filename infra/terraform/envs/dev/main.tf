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

# === Cloud Functions: Web UI から呼び出される HTTP API ===
module "api" {
  source = "../../modules/api"

  project_id             = var.project_id
  location               = var.region
  function_name          = coalesce(var.api_function_name, "${local.name_prefix}-api")
  source_dir             = abspath("${path.root}/../../../../apps/api")
  source_bucket_name     = coalesce(var.api_source_bucket_name, "${local.name_prefix}-api-source")
  source_bucket_location = var.storage_location
  assets_bucket_name     = module.storage.bucket_name

  tasks_queue_name                   = module.tasks.queue_name
  worker_url                         = module.analysis_worker.function_uri
  task_invoker_service_account_email = module.analysis_worker.task_invoker_service_account_email

  runtime                          = var.api_runtime
  api_service_account_id           = coalesce(var.api_service_account_id, "pdx-${var.environment}-api")
  available_memory                 = var.api_available_memory
  timeout_seconds                  = var.api_timeout_seconds
  min_instance_count               = var.api_min_instance_count
  max_instance_count               = var.api_max_instance_count
  max_instance_request_concurrency = var.api_max_instance_request_concurrency
  ingress_settings                 = var.api_ingress_settings
  allow_unauthenticated            = var.api_allow_unauthenticated

  firestore_uploads_collection  = var.firestore_uploads_collection
  firestore_jobs_collection     = var.firestore_jobs_collection
  signed_url_expiration_seconds = var.api_signed_url_expiration_seconds
  uploads_prefix_template       = var.api_uploads_prefix_template
  results_prefix_template       = var.api_results_prefix_template
  max_document_files            = var.api_max_document_files

  depends_on = [
    module.analysis_worker,
  ]
}

# === Cloud Functions: Web UI ===
# Vite の .env は build-time 固定のため、デプロイ後に API URL を差し替えられるよう
# Cloud Functions が config.js を動的生成し、ブラウザ実行時に読み込ませる。
module "ui_hosting" {
  source = "../../modules/ui_hosting"

  project_id             = var.project_id
  bucket_name            = coalesce(var.ui_bucket_name, "${local.name_prefix}-ui")
  location               = var.region
  source_bucket_location = var.storage_location
  force_destroy          = var.ui_force_destroy

  function_name                    = coalesce(var.ui_function_name, "${local.name_prefix}-ui")
  runtime                          = var.ui_runtime
  source_dir                       = abspath("${path.root}/../../../../apps/ui")
  available_memory                 = var.ui_available_memory
  available_cpu                    = var.ui_available_cpu
  timeout_seconds                  = var.ui_timeout_seconds
  min_instance_count               = var.ui_min_instance_count
  max_instance_count               = var.ui_max_instance_count
  max_instance_request_concurrency = var.ui_max_instance_request_concurrency
  allow_unauthenticated            = var.ui_allow_unauthenticated

  api_url  = module.api.function_uri
  use_mock = var.ui_use_mock

  depends_on = [
    module.analysis_worker,
  ]
}
