variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "bucket_name" {
  description = "Web UI 静的ホスティング用バケット名（グローバル一意）"
  type        = string
}

variable "location" {
  description = "バケットのロケーション"
  type        = string
  default     = "ASIA-NORTHEAST1"
}

variable "force_destroy" {
  description = "true で中身があっても削除可能"
  type        = bool
  default     = false
}

variable "allow_public_access" {
  description = "true の場合、静的 UI を allUsers に公開する"
  type        = bool
  default     = true
}

variable "dist_dir" {
  description = "アップロードする UI build 成果物ディレクトリ"
  type        = string
}

variable "deploy_dist" {
  description = "true の場合、dist_dir 配下のファイルを hosting bucket にアップロードする"
  type        = bool
  default     = true
}

variable "api_url" {
  description = "ブラウザ実行時に UI が呼び出す HTTP API URL"
  type        = string
}

variable "use_mock" {
  description = "配信環境で UI のモックモードを有効化するか"
  type        = bool
  default     = false
}

variable "runtime_config_object_name" {
  description = "runtime config JavaScript のオブジェクト名"
  type        = string
  default     = "config.js"
}
