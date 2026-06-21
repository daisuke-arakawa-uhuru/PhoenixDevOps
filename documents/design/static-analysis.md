# 静的構造解析（Codebase Map）設計書

本設計書は、`apps/analysis-worker` において実行されるコードベースの静的構造解析処理（Issue #30）の設計を示す。
静的構造解析は、ソースコード群から言語・フレームワーク非依存かつ外部 CLI に依存しない軽量なパースによって、システムの基本構造を抽出する前処理フェーズである。

---

## 1. インプット（入力仕様）

解析対象としてアップロードされたソースコードアーカイブ（`src.zip` など）を展開したテキストファイル群である。

* **データ構造**: `SourceFile[]`
  ```typescript
  export interface SourceFile {
    path: string;       // ファイルパス（例: "src/app.js"）
    content: string;    // ファイルテキスト内容
  }
  ```
* **フィルタリング**:
  `node_modules`, `.git`, `.venv`, `dist`, `.next` などの不要フォルダや、画像・動画などのバイナリファイルは前処理段階で除外され、解析対象のテキストファイルのみが抽出された状態で解析エンジンに渡される。

---

## 2. 処理内容（静的構造パース）

[code-map.ts](file:///c:/Users/P843-2254/Documents/workspace/MyWork/DevOps%C3%97AIAgentHackathon2026/PhoenixDevOps/apps/analysis-worker/src/code-map.ts) の `buildCodebaseMap` および `codebaseMapArtifacts` を通じて、以下の構造抽出および分類を行う。

### ① ディレクトリ木構造の生成
* ファイルパス一覧から ASCII ツリー表示（`fileTree`）を生成。
* 各ファイルに対して行数、文字数をカウントし、ファイル役割分類（`classifyFile`: config, test, iac, source, readme 等）を行う。

### ② プロジェクト依存関係の抽出 (`collectDependencies`)
各種プロジェクト管理用マニフェストファイルをパースし、依存パッケージ名とバージョン情報を抽出する。
* **対象ファイル**: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Gemfile`, `composer.json`

### ③ モジュール依存関係の抽出 (`collectModuleDependencies`)
JavaScript/TypeScript、Python、Go のコード内にある相対パスによるインポート関係（`import`, `require`）をパースし、ファイル間の接続関係を収集する。

### ④ APIルーティングの抽出 (`collectApiRoutes`)
以下のWebフレームワークで宣言されているAPIエンドポイント（HTTPメソッドとパス）およびコード上の該当箇所（行番号）を正規表現ベースで抽出する。
* **対象フレームワーク**: Express, Flask, Django, FastAPI, Spring Boot (GetMapping等), Next.js API Routes (pages/api, app/api)

### ⑤ データベース・モデル定義の抽出 (`collectDatabaseDefinitions`)
データストア設計の根拠となるテーブル定義やデータモデルを抽出する。
* **対象**: SQL (`CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`), Django models, Prisma models

### ⑥ IaC（Infrastructure as Code）構造の抽出 (`collectIacStructure`)
Terraform ファイル (`.tf`) をパースし、インフラリソースブロック構造を抽出する。
* **対象ブロック**: `provider`, `module`, `resource`, `data`, `variable`, `output`, `locals`

### ⑦ サービス境界とエクスポートシンボルの分類 (`detectServiceBoundaries` / `buildExportedSymbolsByService`)
* ファイルパスの構造（`services/*` や `infra/*`）からマイクロサービス等のサービス境界を自動検出する。
* 各サービス境界内のエントリポイント（`main.ts`, `server.js` 等）を命名と階層深度からスコアリングして特定する。
* サービス境界ごとに、TypeScript/JavaScript コード内で `export` されている公開シンボル（関数、クラス、インターフェース等）を分類し、サービスごとの責務を整理する。

### ⑧ API定義ファイルの抽出 (`extractApiSpecFiles`)
コードベース内に含まれる生のスワガー・OpenAPI定義ファイルを検索する。
* **対象ファイル名**: `api-spec.yaml`, `api-spec.yml`, `api-spec.json`, `openapi.yaml`, `openapi.yml`, `openapi.json`, `swagger.yaml`, `swagger.yml`, `swagger.json`

---

## 3. アウトプット（出力成果物）

静的解析結果は、JSON構造データ `CodebaseMap` としてモデル内部で処理され、以下のデバッグ・補助成果物（Artifacts）として保存される。

| 成果物ファイル名 | 種別 | 内容・用途 |
| --- | --- | --- |
| **`codebase-map.json`** | 構造化JSON | 静的構造解析結果の全データが格納されたJSON。後続の専門エージェント（IaC個別解析エージェント等）が解析結果を再利用するために使用される。 |
| **`codebase-map.md`** | Markdown | ディレクトリツリー、ファイルメタデータ、依存関係、検出されたAPI/DB定義一覧などを整理したサマリー仕様書。 |
| **`module-dependencies.mmd`** | Mermaid | JS/TS、Python、Goの相対インポート接続を可視化した Mermaid フローチャート（`flowchart LR`）。 |
| **`iac-structure.md`** | Markdown | Terraform ファイルから抽出されたプロバイダ、リソース、モジュール等のリスト。 |
| **`exported-symbols-${serviceName}.md`** | Markdown | 自動検出されたサービス境界単位で分割された、JavaScript/TypeScript のエクスポートシンボル一覧。 |
| **`api-spec.yaml`**（等） | YAML/JSON | コードベース内に存在していた元の OpenAPI 定義ファイル（抽出された場合のみ保存される）。 |
