# 解析対象（ソースコード群・既存ドキュメント群）と生成成果物を保管するバケット。
# uploads/ と results/ を 1 バケット内のプレフィックスで分離し、プレフィックスごとに
# ライフサイクル（保持日数）を変える。
resource "google_storage_bucket" "assets" {
  project       = var.project_id
  name          = var.bucket_name
  location      = var.location
  force_destroy = var.force_destroy

  # セキュリティのベストプラクティス
  uniform_bucket_level_access = true       # ACL を無効化し IAM に一本化
  public_access_prevention    = "enforced" # 公開アクセスを構成上禁止

  # 誤上書き・誤削除からの復旧用にバージョニングを有効化
  versioning {
    enabled = true
  }

  # UI は API から取得した署名付き URL を fetch して Markdown をプレビューする。
  # オブジェクト自体は public_access_prevention と IAM で非公開のまま、署名付き URL の GET だけを許可する。
  dynamic "cors" {
    for_each = length(var.cors_origins) > 0 ? [1] : []

    content {
      origin          = var.cors_origins
      method          = ["GET", "HEAD"]
      response_header = ["Content-Type", "Content-Disposition"]
      max_age_seconds = var.cors_max_age_seconds
    }
  }

  # uploads/（入力ファイル）: 一時的な性質のため短めに自動削除
  lifecycle_rule {
    condition {
      age            = var.uploads_retention_days
      matches_prefix = ["uploads/"]
    }
    action {
      type = "Delete"
    }
  }

  # results/（生成成果物）: 入力より長く保持
  lifecycle_rule {
    condition {
      age            = var.results_retention_days
      matches_prefix = ["results/"]
    }
    action {
      type = "Delete"
    }
  }

  # 旧バージョンの肥大化を防止
  lifecycle_rule {
    condition {
      num_newer_versions = var.archived_versions_to_keep
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }
}

# 補足: GCS にディレクトリの実体はなく、プレフィックス（uploads/ results/）は
# オブジェクトを書き込んだ時点で自然に現れる。プレースホルダ（.keep）は
# 上の age ベース lifecycle ルールに合致して周期的に削除→再作成され drift を生むため、
# あえて作成しない。プレフィックスの「定義」は上記 lifecycle ルールと outputs が担う。
