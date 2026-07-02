# PhoenixDevOps 監視・運用ガイド

このドキュメントは PhoenixDevOps の GCP 環境における **監視方針**、**アラート定義**、および **運用ランブック** をまとめています。  
インフラの実体は Terraform で管理されており、このドキュメントはその "なぜ・何を・どうする" を補完するものです。

---

## 1. 監視の全体像

```
Cloud Functions ─── Cloud Logging ──▶ ログベースメトリクス ──▶ Cloud Monitoring アラート ──▶ メール通知
     │                                                          │
     └───────────────── ネイティブメトリクス ──────────────────┘
                  (execution_count / execution_times)
```

| 観測対象 | 主なシグナル | 収集手段 |
|---|---|---|
| 解析ワーカー (Cloud Functions) | 実行回数・エラー率・実行時間 | CF ネイティブメトリクス + ログ |
| HTTP API (Cloud Functions) | リクエスト数・エラー率 | CF ネイティブメトリクス + ログ |
| Cloud Tasks キュー | タスク深度・リトライ数・失敗タスク | Cloud Tasks ログ (Stackdriver) |
| Firestore | ジョブステータス分布 | Cloud Logging (構造化ログ) |
| Cloud Storage | バケット使用量・オブジェクト数 | Cloud Monitoring |

---

## 2. アラートポリシー（Terraform 管理）

Terraform モジュール `infra/terraform/modules/monitoring` で以下の 3 つのアラートポリシーを定義しています。

| ポリシー名 | 検知条件 | 通知頻度上限 |
|---|---|---|
| `[PhoenixDevOps] 解析ワーカー エラー発生` | ERROR ログが 5分間で閾値（デフォルト 1件）超過 | 1時間に 1通 |
| `[PhoenixDevOps] HTTP API エラー発生` | ERROR ログが 5分間で閾値（デフォルト 3件）超過 | 30分に 1通 |
| `[PhoenixDevOps] 解析ワーカー 実行失敗（タイムアウト/クラッシュ）` | CF 実行ステータスが `error` / `timeout` / `crash` / `connection_error` | 1時間に 1通 |

### 通知先の設定方法

アラートメールアドレスは `infra/terraform/envs/dev/variables.tf` の `monitoring_alert_email_addresses` で管理します。  
**GitHub Variables** に `MONITORING_ALERT_EMAILS` を設定してワークフロー側で渡す運用を推奨します。

```yaml
# .github/workflows/terraform-plan.yml (抜粋)
-var='monitoring_alert_email_addresses=["team@example.com"]'
```

または tfvars ファイルで指定（ファイルはコミットしない・Secret Manager 経由で渡す）。

> メールアドレスが設定されていない場合、アラートポリシーは `enabled = false` の状態で作成されます（リソースは存在するが通知は発火しません）。

---

## 3. 主要メトリクスとダッシュボード

### Cloud Functions - 解析ワーカー

| メトリクス | 説明 | 正常範囲の目安 |
|---|---|---|
| `cloudfunctions.googleapis.com/function/execution_count{status="ok"}` | 成功実行数 | ジョブ投入数に一致 |
| `cloudfunctions.googleapis.com/function/execution_count{status="error"}` | エラー終了数 | 0 が理想 |
| `cloudfunctions.googleapis.com/function/execution_count{status="timeout"}` | タイムアウト数 | 0 が理想（上限: 540秒） |
| `cloudfunctions.googleapis.com/function/execution_times` | 実行時間（分布） | P99 < 480秒（タイムアウトの 89%） |
| `cloudfunctions.googleapis.com/function/active_instances` | 稼働インスタンス数 | max_instance_count (3) 以下 |

### Cloud Functions - HTTP API

| メトリクス | 説明 |
|---|---|
| `cloudfunctions.googleapis.com/function/execution_count{status="ok"}` | 成功リクエスト数 |
| `cloudfunctions.googleapis.com/function/execution_count{status!="ok"}` | エラーリクエスト数 |
| `cloudfunctions.googleapis.com/function/execution_times` | API レイテンシ分布 |

### Cloud Tasks

| メトリクス | 説明 | 注意 |
|---|---|---|
| `cloudtasks.googleapis.com/queue/depth` | キュー内タスク数 | 長時間高止まりはワーカー輻輳の兆候 |
| `cloudtasks.googleapis.com/queue/task_attempt_count` | タスク試行数 | リトライが続く場合は max_attempts (5) に注意 |

### Cloud Monitoring ダッシュボード作成手順（手動）

1. GCP Console → Monitoring → Dashboards → Create Dashboard
2. 以下のウィジェットを追加：
   - **Line chart**: 解析ワーカー実行回数（status 別）
   - **Line chart**: API リクエスト数（status 別）
   - **Stacked bar**: Cloud Tasks キュー深度
   - **Scorecard**: 過去 24h の解析成功/失敗件数
3. ダッシュボードを `PhoenixDevOps - Overview` として保存

> **将来対応**: ダッシュボードは `google_monitoring_dashboard` Terraform リソースで IaC 管理可能。今後の改善タスクとして Issue を起票する。

---

## 4. Cloud Logging クエリ集

以下のクエリは [Cloud Logging コンソール](https://console.cloud.google.com/logs) のクエリボックスに貼り付けて使用します。

### 解析ワーカーのエラーログを確認する

```
resource.labels.function_name="phoenixdevops-dev-analysis-worker"
severity>=ERROR
```

### 特定ジョブの実行ログをすべて確認する

```
resource.labels.function_name="phoenixdevops-dev-analysis-worker"
(jsonPayload.jobId="<JOB_ID>" OR textPayload=~"<JOB_ID>")
```

### Gemini API 呼び出しエラーを特定する

```
resource.labels.function_name="phoenixdevops-dev-analysis-worker"
severity>=ERROR
(textPayload=~"Gemini|GoogleGenerativeAI|GenerateContent" OR jsonPayload.message=~"Gemini|quota|rate.limit")
```

### Cloud Tasks タスク失敗ログ

```
resource.type="cloud_tasks_queue"
resource.labels.queue_id="analysis-job-queue"
severity>=WARNING
```

### HTTP API のリクエスト/レスポンス状況

```
resource.labels.function_name="phoenixdevops-dev-api"
httpRequest.status>=400
```

---

## 5. 運用ランブック

### 5-1. 通常監視（日次確認）

毎日業務開始前に以下を確認します：

1. **Cloud Monitoring ダッシュボード**でエラーレートが 0 に近いことを確認
2. **Cloud Logging** で前日の ERROR ログがないか確認（クエリ: 上記 §4 参照）
3. **Firestore** でジョブのステータスが `running` のまま放置されていないか確認
   - `running` 状態のジョブが 1時間以上続く場合は異常

### 5-2. 解析ジョブ失敗時の対応手順

```
アラート受信
  │
  ├─ Cloud Logging でエラーメッセージを確認
  │    ↓
  ├─ Gemini API エラー?
  │    ├─ 429 (Resource Exhausted) → Gemini API クォータ状況を確認。バックオフ後にリトライ
  │    ├─ 401 (Unauthorized)        → Secret Manager の gemini-api-key が有効か確認
  │    └─ 500 (Internal Server)     → Gemini API の障害情報を GCP Status Dashboard で確認
  │
  ├─ タイムアウト (timeout)?
  │    └─ 対象ソースコードのファイル数・サイズを確認
  │         → MAX_FILES / MAX_CHARS_PER_FILE 環境変数で制限をかける
  │
  └─ その他のクラッシュ?
       └─ Cloud Logging の stack trace を確認して根本原因を特定
            → Bug fix → PR → CI → merge → 自動デプロイ
```

### 5-3. ジョブを手動でリトライする

Firestore でジョブの状態を `queued` に戻すことでリトライできます（実装依存）。  
**現状**: API 経由でのリトライエンドポイントは未実装のため、以下の手順で対応します：

1. 元のジョブ ID を使用してジョブを再投入（同じソース/ドキュメントで新規ジョブを作成）
2. 既存の failed ジョブは Firestore から確認のみ（自動削除されない）

> **将来対応**: ジョブのリトライ API エンドポイントを追加する（Issue 起票推奨）。

### 5-4. Cloud Tasks キューが詰まっている場合

```
gcloud tasks list \
  --queue=analysis-job-queue \
  --location=asia-northeast1 \
  --project=phoenixdevops
```

タスクが大量に溜まっている場合は以下を確認：
- Cloud Functions の最大インスタンス数 (`max_instance_count`) が 3 に制限されているため、並列処理数に上限がある
- Gemini API のレート制限により全タスクが失敗している場合は、キューを一時停止して原因解消後に再開する

```bash
# キューの一時停止
gcloud tasks queues pause analysis-job-queue \
  --location=asia-northeast1 \
  --project=phoenixdevops

# キューの再開
gcloud tasks queues resume analysis-job-queue \
  --location=asia-northeast1 \
  --project=phoenixdevops
```

### 5-5. Cloud Functions のコールドスタート問題

`min_instance_count = 0` の設定では最初のリクエストでコールドスタートが発生します。  
解析ジョブは非同期実行のため、数秒のコールドスタートは許容範囲内です。  
ただし連続した高負荷時は `min_instance_count = 1` に変更することで緩和できます（コスト増に注意）。

---

## 6. インシデント対応 SLO（目標値）

| 指標 | 目標値 | 根拠 |
|---|---|---|
| 解析ジョブ成功率 | ≥ 95% | 1日 20ジョブのうち最大 1件の失敗を許容 |
| API 応答時間 (P95) | ≤ 2秒 | ジョブ投入・状態取得は軽量処理 |
| アラート検知から初動まで | ≤ 30分 | 営業時間内 |
| 障害解消まで | ≤ 2時間 | Gemini API 側の障害を除く |

---

## 7. 定期メンテナンス

| 作業 | 頻度 | 自動化状況 |
|---|---|---|
| Cloud Storage 古いファイル削除 | 自動 | ライフサイクルルールで自動削除（uploads: 30日、results: 90日） |
| Firestore 古いジョブドキュメント削除 | 手動 (月次) | TTL ポリシー未設定。手動 or スクリプトで削除 |
| Gemini API キーのローテーション | 年1回以上推奨 | Secret Manager の新バージョンを追加後、TF apply で反映 |
| Terraform state のバックアップ確認 | 月次 | GCS バケットのバージョニングで保護済み |

### API キーローテーション手順

1. GCP Secret Manager に新バージョンを追加
   ```bash
   echo -n "NEW_API_KEY" | gcloud secrets versions add gemini-api-key --data-file=- --project=phoenixdevops
   ```
2. Terraform 変数 `gemini_api_key_secret_version` を `"latest"` のまま維持（自動で最新バージョンを参照）
3. CI/CD による `terraform apply` 完了後、Cloud Functions が新しいキーを参照することを確認
4. 旧バージョンを無効化
   ```bash
   gcloud secrets versions disable <OLD_VERSION> --secret=gemini-api-key --project=phoenixdevops
   ```

---

## 8. リソース参照

| リソース | URL / コマンド |
|---|---|
| Cloud Logging (dev) | `https://console.cloud.google.com/logs?project=phoenixdevops` |
| Cloud Monitoring アラート | `https://console.cloud.google.com/monitoring/alerting?project=phoenixdevops` |
| Cloud Functions (dev) | `https://console.cloud.google.com/functions/list?project=phoenixdevops` |
| Firestore (dev) | `https://console.cloud.google.com/firestore/databases/-default-/data?project=phoenixdevops` |
| Cloud Tasks (dev) | `gcloud tasks queues describe analysis-job-queue --location=asia-northeast1 --project=phoenixdevops` |
| GCP Status Dashboard | `https://status.cloud.google.com/` |
| Terraform modules | `infra/terraform/modules/monitoring/` |
