export interface UploadResponse {
  uploadId: string;
  sourceArchiveUri: string;
  documentUris: string[];
  projectName?: string;
}

export interface JobResponse {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  sourceArchiveUri?: string;
  documentUris?: string[];
  resultsPrefix?: string;
  uploadId?: string;
  projectName?: string;
  errorMessage?: string;
  artifactPaths?: Record<string, string>;
}

export interface Artifact {
  name: string;
  uri: string;
  url: string;
}

export interface ResultsResponse {
  jobId: string;
  status: string;
  expiresIn: number;
  artifacts: Artifact[];
}

type RuntimeConfig = {
  API_URL?: string;
  USE_MOCK?: boolean | string;
};

declare global {
  interface Window {
    __PHOENIX_CONFIG__?: RuntimeConfig;
  }
}

// Configuration
export const API_BASE_URL = readConfigText('API_URL', import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '');
export const isMockMode = () => {
  const mockParam = new URLSearchParams(window.location.search).get('mock');
  if (mockParam != null) {
    return ['1', 'true', 'yes'].includes(mockParam.toLowerCase());
  }
  const runtimeMock = readRuntimeConfig().USE_MOCK;
  if (typeof runtimeMock === 'boolean') {
    return runtimeMock;
  }
  if (typeof runtimeMock === 'string') {
    return ['1', 'true', 'yes'].includes(runtimeMock.toLowerCase());
  }
  return import.meta.env.VITE_USE_MOCK === 'true';
};

function readRuntimeConfig(): RuntimeConfig {
  if (typeof window === 'undefined') {
    return {};
  }
  return window.__PHOENIX_CONFIG__ || {};
}

function readConfigText(key: keyof RuntimeConfig, fallback: string): string {
  const value = readRuntimeConfig()[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

// Stateful memory for mockup jobs
interface MockJobState {
  jobId: string;
  projectName: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: number;
}

const getMockJobs = (): Record<string, MockJobState> => {
  try {
    const data = localStorage.getItem('phoenix_mock_jobs');
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

const saveMockJob = (job: MockJobState) => {
  try {
    const jobs = getMockJobs();
    jobs[job.jobId] = job;
    localStorage.setItem('phoenix_mock_jobs', JSON.stringify(jobs));
  } catch (e) {
    console.error('Failed to save mock job state:', e);
  }
};

/**
 * Upload source code archive and document files.
 */
export async function uploadFiles(
  sourceFile: File,
  documentFiles: File[],
  projectName?: string
): Promise<UploadResponse> {
  if (isMockMode()) {
    console.log('[Mock API] Uploading files...', { sourceFile, documentFiles, projectName });
    await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulate network latency
    return {
      uploadId: `upload-${Math.random().toString(36).substring(2, 9)}`,
      sourceArchiveUri: `gs://phoenix-uploads/uploads/mock-source.zip`,
      documentUris: documentFiles.map((f, i) => `gs://phoenix-uploads/uploads/doc-${i}-${f.name}`),
      projectName: projectName || 'Legacy PHP Application',
    };
  }

  const formData = new FormData();
  formData.append('sourceArchive', sourceFile);
  documentFiles.forEach((file) => {
    formData.append('documents', file);
  });
  if (projectName) {
    formData.append('projectName', projectName);
  }

  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Upload failed with status ${response.status}`));
  }

  return response.json();
}

/**
 * Initiate an analysis job.
 */
export async function createJob(uploadId: string, projectName?: string): Promise<JobResponse> {
  if (isMockMode()) {
    console.log('[Mock API] Creating job...', { uploadId, projectName });
    await new Promise((resolve) => setTimeout(resolve, 800));
    
    const jobId = `job-${Math.random().toString(36).substring(2, 9)}`;
    const mockJob: MockJobState = {
      jobId,
      projectName: projectName || 'Legacy PHP Application',
      status: 'queued',
      createdAt: Date.now(),
    };
    saveMockJob(mockJob);

    return {
      jobId,
      status: 'queued',
      uploadId,
      projectName: mockJob.projectName,
    };
  }

  const response = await fetch(`${API_BASE_URL}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Failed to create job: ${response.status}`));
  }

  return response.json();
}

/**
 * Retrieve current job status.
 */
export async function getJobStatus(jobId: string): Promise<JobResponse> {
  if (isMockMode()) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const jobs = getMockJobs();
    const job = jobs[jobId];
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const elapsed = Date.now() - job.createdAt;
    let newStatus = job.status;

    // Simulate progress: queued (0-4s) -> running (4-12s) -> succeeded (>12s)
    // If the project name contains "fail", simulate a failure
    const shouldFail = job.projectName.toLowerCase().includes('fail');

    if (job.status === 'queued' && elapsed > 4000) {
      newStatus = 'running';
    } else if (job.status === 'running' && elapsed > 12000) {
      newStatus = shouldFail ? 'failed' : 'succeeded';
    }

    if (newStatus !== job.status) {
      job.status = newStatus;
      saveMockJob(job);
    }

    const res: JobResponse = {
      jobId,
      status: job.status,
      projectName: job.projectName,
    };

    if (job.status === 'succeeded') {
      res.artifactPaths = {
        'true-design.md': `gs://phoenix-uploads/results/${jobId}/true-design.md`,
        'document-drift-report.md': `gs://phoenix-uploads/results/${jobId}/document-drift-report.md`,
      };
    } else if (job.status === 'failed') {
      res.errorMessage = 'Analysis failed in parsing syntax tree: Parse error on line 42 of index.php. Unexpected token T_VARIABLE.';
    }

    return res;
  }

  const response = await fetch(`${API_BASE_URL}/jobs/${jobId}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Failed to get job status: ${response.status}`));
  }

  return response.json();
}

/**
 * Fetch signed URLs for generated artifacts.
 */
export async function getJobResults(jobId: string): Promise<ResultsResponse> {
  if (isMockMode()) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      jobId,
      status: 'succeeded',
      expiresIn: 3600,
      artifacts: [
        {
          name: 'true-design.md',
          uri: `gs://phoenix-uploads/results/${jobId}/true-design.md`,
          url: `mock://results/${jobId}/true-design.md`,
        },
        {
          name: 'document-drift-report.md',
          uri: `gs://phoenix-uploads/results/${jobId}/document-drift-report.md`,
          url: `mock://results/${jobId}/document-drift-report.md`,
        },
      ],
    };
  }

  const response = await fetch(`${API_BASE_URL}/jobs/${jobId}/results`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, `Failed to fetch results: ${response.status}`));
  }

  return response.json();
}

/**
 * Read text content of markdown artifact from GCS URL / Mock URL.
 */
export async function fetchFileContent(url: string): Promise<string> {
  if (url.startsWith('mock://')) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (url.endsWith('true-design.md')) {
      return MOCK_TRUE_DESIGN;
    } else if (url.endsWith('document-drift-report.md')) {
      return MOCK_DRIFT_REPORT;
    }
    return '# Unknown mock artifact';
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file content: ${response.statusText}`);
  }
  return response.text();
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  const errorBody = await response.json().catch(() => null);
  if (errorBody && typeof errorBody === 'object') {
    const message = (errorBody as { message?: unknown; error?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
    const code = (errorBody as { error?: unknown }).error;
    if (typeof code === 'string' && code.trim()) {
      return `${fallback} (${code})`;
    }
  }
  return fallback;
}

// --- Mock Data Constants ---

const MOCK_TRUE_DESIGN = `# PhoenixDevOps - 真の設計書 (True Design Specification)

> [!NOTE]
> 本設計書は、ソースコード (正) よりAIエージェントが自動生成した真実の設計ドキュメントです。

## 1. システム概要
アップロードされたソースコードの静的解析に基づき、本システムはPHP/Laravelフレームワークで構築された「レガシー顧客管理SaaS」であると判定されました。

* **プロジェクト名**: Legacy CRM Service
* **主要言語**: PHP 8.1 / TypeScript (一部フロントエンド)
* **主要フレームワーク**: Laravel 9.x / Vue.js 3
* **データベース**: MySQL 8.0 (ORM: Eloquent)

## 2. 主要機能 & APIエンドポイント
ソースコードのルーティングファイル (\`routes/api.php\`) から抽出されたAPI定義は以下の通りです。

| メソッド | パス | コントローラー / アクション | 処理概要 | 認証 |
| :--- | :--- | :--- | :--- | :--- |
| \`POST\` | \`/api/v1/login\` | \`AuthController@login\` | ユーザー認証とトークン発行 | なし |
| \`GET\` | \`/api/v1/customers\` | \`CustomerController@index\` | 顧客一覧の取得 (フィルター対応) | Bearer Token |
| \`POST\` | \`/api/v1/customers\` | \`CustomerController@store\` | 新規顧客の登録とバリデーション | Bearer Token |
| \`PUT\` | \`/api/v1/customers/{id}\` | \`CustomerController@update\` | 顧客情報の更新 | Bearer Token |
| \`DELETE\`| \`/api/v1/customers/{id}\` | \`CustomerController@destroy\` | 顧客データの論理削除 | Bearer Token |

## 3. データモデル (データベース定義)
Eloquentモデルおよびマイグレーションファイルを解析した主要テーブル構造です。

### 3.1. customers テーブル
* **PrimaryKey**: \`id\` (BigInteger, AutoIncrement)
* **インデックス**: \`email\` (Unique), \`status\` (Normal)

| カラム名 | 物理型 | NULL許容 | デフォルト | 備考 |
| :--- | :--- | :---: | :--- | :--- |
| \`id\` | bigint(20) unsigned | NO | | 主キー |
| \`company_name\` | varchar(255) | NO | | 企業名 |
| \`contact_name\` | varchar(255) | NO | | 担当者氏名 |
| \`email\` | varchar(255) | NO | | メールアドレス |
| \`status\` | varchar(50) | NO | 'active' | ステータス (\`active\`, \`suspended\`, \`churned\`) |
| \`sales_representative_id\` | bigint(20) | YES | NULL | 担当営業ID (外部キー) |
| \`created_at\` | timestamp | YES | NULL | 作成日時 |
| \`updated_at\` | timestamp | YES | NULL | 更新日時 |

## 4. 業務ルール & バリデーション
ソースコード内のフォームリクエスト (\`StoreCustomerRequest.php\`) から抽出されたバリデーション規則です。

1. **重複メールアドレスの禁止**: \`email\` は \`customers\` テーブルにおいて一意である必要があります。
2. **ステータス管理**: 顧客ステータスは \`active\`, \`suspended\`, \`churned\` のいずれかのみ許容されます。
3. **新規登録時の必須項目**: \`company_name\`, \`contact_name\`, \`email\` は空欄での送信が禁止されています。

---

## 5. 判断不能・推測事項
ソースコードの静的解析のみでは断定が難しく、確認が必要な項目です。

* **外部決済サービス (Stripe)**: ソースコード中に \`StripeWebHookController\` が存在しますが、テスト環境および本番環境のWebhookシークレットやAPIキーの管理方法について確証が得られません。
* **物理削除処理**: \`CustomerController@destroy\` では Eloquentの \`SoftDeletes\` トレイトが使われており論理削除されますが、一部のバッチ処理において \`forceDelete()\` (物理削除) を呼んでいる形跡があり、その実行条件が曖昧です。
`;

const MOCK_DRIFT_REPORT = `# PhoenixDevOps - ドキュメント差分レポート (Drift Analysis Report)

> [!WARNING]
> 既存の設計ドキュメントと現行ソースコードの実装状況に複数の乖離 (ドリフト) が検出されました。

## 1. 差分サマリー

既存ドキュメントから抽出した仕様と、ソースコードを解析して得られた実態との比較結果です。

| 分類 | 件数 | 影響度 | 内容説明 |
| :--- | :---: | :---: | :--- |
| 🔴 実装あり・文書なし | 2 | 高 | ドキュメントに一切記述がないが、コード上機能しているAPI/仕様。 |
| 🟡 文書あり・実装なし | 1 | 中 | ドキュメントに記述があるが、コード上で削除または未実装の機能。 |
| 🟠 内容不一致 | 2 | 高 | 文書とコードでパラメータ、型、仕様定義が異なっている項目。 |
| ⚪ 判断不能 | 1 | 低 | 記述はあるが、コードの構造上整合性が担保できない項目。 |

---

## 2. 検出された乖離 (ドリフト) 一覧

### DRIFT-001: 🔴 実装あり・文書なし [影響度: 高]
* **対象**: 顧客の論理削除機能
* **ソースコード根拠**: \`CustomerController@destroy\` および \`Customer.php\` (\`SoftDeletes\` の使用)
* **ドキュメント記載**: なし（「顧客削除」の項目自体が存在しない）
* **差分詳細**: 既存ドキュメント上では顧客は即時物理削除される仕様となっていますが、実装コード上では \`deleted_at\` カラムを利用した「論理削除」が導入されています。
* **推奨対応**: 設計書の「顧客管理仕様」に論理削除フローを追記し、復元機能の有無について仕様定義を補完してください。

### DRIFT-002: 🟠 内容不一致 [影響度: 高]
* **対象**: \`/api/v1/customers\` 新規登録APIのバリデーション規則
* **ソースコード根拠**: \`StoreCustomerRequest.php\` (\`rules()\` メソッド)
* **ドキュメント記載**: 顧客仕様書 3.2項 「メールアドレスは任意入力」
* **差分詳細**: ドキュメントには「メールアドレスは空欄を許容する」とありますが、実際のソースコード上のバリデーションでは \`'email' => 'required|email|unique:customers'\` となっており、**必須入力**となっています。
* **推奨対応**: コードの実装が現在の業務仕様として正しいと判断されるため、既存ドキュメント側の記述を「メールアドレスは必須入力」に修正してください。

### DRIFT-003: 🟡 文書あり・実装なし [影響度: 中]
* **対象**: 顧客情報CSVエクスポート機能
* **ソースコード根拠**: なし
* **ドキュメント記載**: 管理画面仕様書 4.1項 「CSVエクスポートボタンによる全件ダウンロード」
* **差分詳細**: 既存ドキュメントにはCSVダウンロード機能の記載がありますが、ルーティング定義およびコントローラーのソースコード内に該当する機能が実装されていません。過去に削除されたか、開発途中で見送られた可能性があります。
* **推奨対応**: 開発チームおよびプロダクトオーナーと協議し、本機能の要否を確認。不要であれば設計書から削除、必要であれば今後の開発バックログに登録してください。

### DRIFT-004: 🟠 内容不一致 [影響度: 中]
* **対象**: 顧客ステータスの許容値
* **ソースコード根拠**: \`Customer.php\` (\`STATUS_ACTIVE\`, \`STATUS_SUSPENDED\`, \`STATUS_CHURNED\`)
* **ドキュメント記載**: システム共通定義書 「ステータス一覧: 新規, 有効, 一時停止」
* **差分詳細**: コード上の定義値は英語表記 (\`active\`, \`suspended\`, \`churned\`) ですが、ドキュメントの日本語表記とマッピングが一致していません。また、ドキュメントには退会状態を表す \`churned\` に関する言及がありません。
* **推奨対応**: 設計書の共通定義データを更新し、コード側の英語文字列（DB登録値）と、画面上の日本語表示の対照表を設計書に明記してください。
`;
