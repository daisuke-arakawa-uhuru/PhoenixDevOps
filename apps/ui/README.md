# PhoenixDevOps - ドキュメント・ドリフト検知エージェント Web UI

このプロジェクトは、「ドキュメント・ドリフト検知＆真実の設計書生成エージェント」のWebユーザーインターフェースです。
ソースコードと古いドキュメント群をアップロードし、解析の進捗を監視し、結果のマークダウンをプレビュー・ダウンロードできます。

---

## 🚀 起動方法

### 1. 依存関係のインストール
`apps/ui` ディレクトリでパッケージのインストールを行います。

```bash
cd apps/ui
npm install
```

### 2. 開発サーバーの起動
ローカル開発サーバーを起動します。

```bash
npm run dev
```
起動に成功すると、ブラウザで **`http://localhost:5173/`** が開くか、またはコンソールに出力されたURLからアクセス可能になります。

---

## 🔌 実 API 連携

通常起動では、UI は Issue #3 の HTTP API を呼び出します。API は Cloud Tasks 経由で Issue #4 の解析ワーカーを起動するため、UI からは次の流れで実処理を呼び出します。

```text
UI -> POST /upload -> POST /jobs -> GET /jobs/{jobId} -> GET /jobs/{jobId}/results
       Issue #3 HTTP API -------------------------------------------> Issue #4 worker results
```

ローカル API はデフォルトで `http://localhost:8080` を参照します。デプロイ済み API を使うローカル確認では、Terraform output の `api_function_uri` を `VITE_API_URL` に設定してください。

```bash
VITE_API_URL="https://<api-function-url>" npm run dev
```

Terraform でホスティングする環境では、`VITE_API_URL` ではなく Terraform が配信する `/config.js` の
`window.__PHOENIX_CONFIG__.API_URL` を使用します。`config.js` は `infra/terraform/modules/ui_hosting` の
Cloud Functions から動的に配信され、
値には dev 環境の `module.api.function_uri` が入ります。
Cloud Functions のトリガー URL（`...cloudfunctions.net/<function-name>`）から開いた場合は、
UI 関数が静的 asset と `config.js` の参照先を関数配下へ補正します。

## 🧪 モック検証モード（API不要での確認）

実際のバックエンドAPIサーバー（Cloud Functions）が起動していない状態でUIの挙動やデザインを確認する場合は、**モックモード**を明示的に有効化します。

### 使用方法
ブラウザで起動したURLの末尾に、クエリパラメータ **`?mock=true`** を追加してアクセスします。
👉 **例: `http://localhost:5173/?mock=true`**

### 特徴
* 画面上部に **「デモ用データ（テスト用ファイル）を自動セットする」** ボタンが表示されます。これをクリックするだけで入力ファイルがダミー設定され、すぐに「解析開始」を試すことができます。
* `LocalStorage` を利用して `queued` ➜ `running` ➜ `succeeded` の進捗遷移を自動シミュレートし、完了後にダミーの「真の設計書」および「差分レポート」のマークダウンをレンダリングします。
* プロジェクト名に `fail` という文字列を含めて実行すると、解析の失敗（`failed`）状態をテストすることができます。

---

## ⚙️ 環境変数設定

プロジェクトルートまたは `apps/ui/.env.local` などの環境変数ファイルで以下のパラメータを調整できます。

| 変数名 | デフォルト値 | 説明 |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8080` | バックエンドCloud Functions (HTTP API) のエンドポイント。 |
| `VITE_USE_MOCK` | `false` | `true` に設定すると、クエリパラメータ `?mock=true` が無くても常にモックモードで動作します。 |

通常のローカル起動では `VITE_USE_MOCK` を設定しなければ実 API を呼び出します。APIなしでUIだけを確認したい場合は、`?mock=true` または `VITE_USE_MOCK=true` を使ってください。

デプロイ環境の実 API URL は `.env` ではなく、Terraform が Web UI Cloud Functions の環境変数として渡し、
`/config.js` でブラウザへ公開します。

---

## 🛠️ その他のコマンド

### プロダクションビルド
静的ファイルのビルドを行います（`dist/` ディレクトリに生成されます）。

```bash
npm run build
```

### プレビュー表示
ビルドされた静的成果物をローカルでプレビュー起動します。

```bash
npm run preview
```
