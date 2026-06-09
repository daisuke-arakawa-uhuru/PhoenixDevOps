terraform {
  # state は GCS バックエンドで共有する。
  # bucket はシークレット/環境依存のため、ここには書かず init 時に部分設定で渡す:
  #   terraform init -backend-config="bucket=<TFSTATE_BUCKET>"
  # state バケットの作成はブートストラップ作業（infra/README.md 参照）で行う。
  backend "gcs" {
    prefix = "phoenixdevops/envs/dev"
  }
}