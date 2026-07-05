variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "region" {
  description = "デフォルトリージョン（Cloud Tasks / Firestore 等に使用）"
  type        = string
  default     = "asia-northeast1"
}

variable "environment" {
  description = "環境識別子（リソース名のプレフィックスに使用）"
  type        = string
  default     = "dev"
}

variable "storage_location" {
  description = "Cloud Storage バケットのロケーション"
  type        = string
  default     = "ASIA-NORTHEAST1"
}

variable "force_destroy" {
  description = "true の場合、中身があってもバケットを削除可能にする。本番相当では false 固定。"
  type        = bool
  default     = false
}

variable "uploads_retention_days" {
  description = "uploads/ プレフィックス配下の保持日数（経過後に自動削除）"
  type        = number
  default     = 30
}

variable "results_retention_days" {
  description = "results/ プレフィックス配下の保持日数（経過後に自動削除）"
  type        = number
  default     = 90
}

variable "firestore_delete_protection" {
  description = "Firestore データベースの誤削除防止"
  type        = bool
  default     = true
}

variable "analysis_worker_function_name" {
  description = "解析ワーカー Cloud Functions 名。未指定時は環境名から生成する。"
  type        = string
  default     = null
}

variable "analysis_worker_source_bucket_name" {
  description = "Cloud Functions source archive 用 GCS バケット名。未指定時は環境名から生成する。"
  type        = string
  default     = null
}

variable "analysis_worker_runtime" {
  description = "解析ワーカー Cloud Functions runtime"
  type        = string
  default     = "nodejs24"
}

variable "analysis_worker_service_account_id" {
  description = "解析ワーカー実行用サービスアカウント ID（30 文字以内）。未指定時は環境名から生成する。"
  type        = string
  default     = null
}

variable "analysis_task_invoker_service_account_id" {
  description = "Cloud Tasks が解析ワーカーを OIDC で呼び出すためのサービスアカウント ID（30 文字以内）。未指定時は環境名から生成する。"
  type        = string
  default     = null
}

variable "analysis_worker_available_memory" {
  description = "解析ワーカー Cloud Functions に割り当てるメモリ"
  type        = string
  default     = "1Gi"
}

variable "analysis_worker_timeout_seconds" {
  description = "解析ワーカー Cloud Functions のタイムアウト秒数"
  type        = number
  default     = 540
}

variable "analysis_worker_min_instance_count" {
  description = "解析ワーカー Cloud Functions の最小インスタンス数"
  type        = number
  default     = 0
}

variable "analysis_worker_max_instance_count" {
  description = "解析ワーカー Cloud Functions の最大インスタンス数"
  type        = number
  default     = 3
}

variable "analysis_worker_max_instance_request_concurrency" {
  description = "解析ワーカー 1 インスタンスあたりの最大同時リクエスト数"
  type        = number
  default     = 1
}

variable "analysis_worker_ingress_settings" {
  description = "解析ワーカー Cloud Functions の ingress 設定"
  type        = string
  default     = "ALLOW_ALL"
}

variable "api_function_name" {
  description = "HTTP API Cloud Functions 名。未指定時は環境名から生成する。"
  type        = string
  default     = null
}

variable "api_source_bucket_name" {
  description = "HTTP API Cloud Functions source archive 用 GCS バケット名。未指定時は環境名から生成する。"
  type        = string
  default     = null
}

variable "api_runtime" {
  description = "HTTP API Cloud Functions runtime"
  type        = string
  default     = "nodejs24"
}

variable "api_service_account_id" {
  description = "HTTP API 実行用サービスアカウント ID（30 文字以内）。未指定時は環境名から生成する。"
  type        = string
  default     = null
}

variable "api_available_memory" {
  description = "HTTP API Cloud Functions に割り当てるメモリ"
  type        = string
  default     = "1Gi"
}

variable "api_timeout_seconds" {
  description = "HTTP API Cloud Functions のタイムアウト秒数"
  type        = number
  default     = 300
}

variable "api_min_instance_count" {
  description = "HTTP API Cloud Functions の最小インスタンス数"
  type        = number
  default     = 0
}

variable "api_max_instance_count" {
  description = "HTTP API Cloud Functions の最大インスタンス数"
  type        = number
  default     = 3
}

variable "api_max_instance_request_concurrency" {
  description = "HTTP API 1 インスタンスあたりの最大同時リクエスト数"
  type        = number
  default     = 1
}

variable "api_ingress_settings" {
  description = "HTTP API Cloud Functions の ingress 設定"
  type        = string
  default     = "ALLOW_ALL"
}

variable "api_allow_unauthenticated" {
  description = "true の場合、HTTP API を unauthenticated で呼び出せるようにする"
  type        = bool
  default     = true
}

variable "firestore_uploads_collection" {
  description = "アップロード状態を保存する Firestore コレクション名"
  type        = string
  default     = "uploads"
}

variable "firestore_jobs_collection" {
  description = "解析ジョブ状態を保存する Firestore コレクション名"
  type        = string
  default     = "jobs"
}

variable "api_signed_url_expiration_seconds" {
  description = "HTTP API が返す成果物署名付き URL の有効秒数"
  type        = number
  default     = 3600
}

variable "api_uploads_prefix_template" {
  description = "HTTP API のアップロード保存 prefix template"
  type        = string
  default     = "uploads/{upload_id}"
}

variable "api_results_prefix_template" {
  description = "HTTP API の成果物保存 prefix template"
  type        = string
  default     = "results/{job_id}"
}

variable "api_max_document_files" {
  description = "HTTP API が 1 upload で受け付けるドキュメントファイル数上限"
  type        = number
  default     = 600
}

variable "analysis_worker_results_prefix_template" {
  description = "解析ワーカーの成果物保存 prefix template"
  type        = string
  default     = "results/{job_id}"
}

variable "analysis_worker_gemini_model" {
  description = "解析ワーカーが使用する Gemini model"
  type        = string
  default     = "gemini-3.1-flash-lite"
}

variable "analysis_worker_gemini_dry_run" {
  description = "true の場合、解析ワーカーは Gemini API を呼び出さず dry-run client を使用する"
  type        = bool
  default     = false
}

variable "analysis_worker_gemini_use_vertex_ai" {
  description = "true の場合、解析ワーカーは Gemini API の呼び出しに Vertex AI (ADC) を使用する"
  type        = bool
  default     = true
}

variable "analysis_worker_gemini_location" {
  description = "解析ワーカーが使用する Vertex AI Gemini endpoint location"
  type        = string
  default     = "global"
}

variable "gemini_api_key_secret_id" {
  description = "GEMINI_API_KEY として参照する Secret Manager secret ID。secret 実値は Terraform に渡さない。"
  type        = string
  default     = null
}

variable "gemini_api_key_secret_version" {
  description = "GEMINI_API_KEY secret の version"
  type        = string
  default     = "latest"
}

variable "ui_bucket_name" {
  description = "Web UI Cloud Functions source archive 用 GCS バケット名。未指定時は環境名から生成する。"
  type        = string
  default     = null
}

variable "ui_function_name" {
  description = "Web UI Cloud Functions 名。未指定時は環境名から生成する。"
  type        = string
  default     = null
}

variable "ui_force_destroy" {
  description = "true の場合、中身があっても UI source archive bucket を削除可能にする。本番相当では false 固定。"
  type        = bool
  default     = false
}

variable "ui_allow_unauthenticated" {
  description = "true の場合、Web UI を unauthenticated で呼び出せるようにする"
  type        = bool
  default     = true
}

variable "ui_use_mock" {
  description = "配信環境の Web UI をモックモードで動作させるか"
  type        = bool
  default     = false
}

variable "ui_runtime" {
  description = "Web UI Cloud Functions runtime"
  type        = string
  default     = "nodejs24"
}

variable "ui_available_memory" {
  description = "Web UI Cloud Functions に割り当てるメモリ"
  type        = string
  default     = "256Mi"
}

variable "ui_available_cpu" {
  description = "Web UI Cloud Functions に割り当てる CPU。concurrency > 1 の場合は 1 以上が必要。"
  type        = string
  default     = "1"
}

variable "ui_timeout_seconds" {
  description = "Web UI Cloud Functions のタイムアウト秒数"
  type        = number
  default     = 60
}

variable "ui_min_instance_count" {
  description = "Web UI Cloud Functions の最小インスタンス数"
  type        = number
  default     = 0
}

variable "ui_max_instance_count" {
  description = "Web UI Cloud Functions の最大インスタンス数"
  type        = number
  default     = 3
}

variable "ui_max_instance_request_concurrency" {
  description = "Web UI 1 インスタンスあたりの最大同時リクエスト数"
  type        = number
  default     = 80
}

# === 監視 (Cloud Monitoring) ===

variable "monitoring_alert_email_addresses" {
  description = "アラート通知先メールアドレス一覧。空リストの場合は通知チャネルを作成せずアラートポリシーは無効状態になる。"
  type        = list(string)
  default     = []
}

variable "monitoring_worker_error_threshold" {
  description = "解析ワーカーのエラーログ件数アラート閾値（5分間）"
  type        = number
  default     = 1
}

variable "monitoring_api_error_threshold" {
  description = "HTTP API のエラーログ件数アラート閾値（5分間）"
  type        = number
  default     = 3
}
