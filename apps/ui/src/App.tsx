import { useEffect, useRef, useState } from 'react';
import UploadForm from './components/UploadForm';
import JobProgress from './components/JobProgress';
import ResultViewer from './components/ResultViewer';
import { uploadFiles, createJob, getJobStatus, isMockMode } from './utils/api';
import { Flame, Info, Loader2 } from 'lucide-react';

type AppMode = 'upload' | 'processing' | 'results';

type AnalysisSession = {
  jobId: string;
  projectName: string;
  startedAt: number;
};

type RestoredJobState = {
  status: 'queued' | 'running' | 'failed';
  errorMessage: string | null;
  elapsedTime: number;
};

const ANALYSIS_SESSION_KEY = 'phoenixdevops.analysis-session';

function App() {
  const [mode, setMode] = useState<AppMode>('upload');
  const [jobId, setJobId] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(() => readStoredSession() != null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [restoredJobState, setRestoredJobState] = useState<RestoredJobState | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  function showSessionNotice(message: string): void {
    setSessionNotice(message);
    if (noticeTimerRef.current != null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setSessionNotice(null);
      noticeTimerRef.current = null;
    }, 5000);
  }

  useEffect(() => {
    const storedSession = readStoredSession();
    if (!storedSession) {
      return;
    }

    let active = true;

    const restoreSession = async () => {
      const elapsedTime = elapsedSecondsSince(storedSession.startedAt);

      try {
        const job = await getJobStatus(storedSession.jobId);
        if (!active) {
          return;
        }

        setJobId(job.jobId);
        setProjectName(job.projectName || storedSession.projectName);

        if (job.status === 'succeeded') {
          setMode('results');
          setRestoredJobState(null);
          showSessionNotice(`前回の解析ジョブ ${job.jobId} を復元しました。`);
        } else {
          setMode('processing');
          setRestoredJobState({
            status: job.status === 'failed' ? 'failed' : job.status,
            errorMessage:
              job.status === 'failed'
                ? job.errorMessage || '不明な解析エラーが発生しました。'
                : null,
            elapsedTime,
          });
          showSessionNotice(`前回の解析ジョブ ${job.jobId} を復元しました。`);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setJobId(storedSession.jobId);
        setProjectName(storedSession.projectName);
        setMode('processing');
        setRestoredJobState({
          status: 'queued',
          errorMessage: null,
          elapsedTime,
        });
        showSessionNotice(
          `保存済みの解析ジョブ ${storedSession.jobId} を復元しました。状態の確認を再試行します。`,
        );
        console.error('Failed to restore analysis session:', error);
      } finally {
        if (active) {
          setIsHydrating(false);
        }
      }
    };

    restoreSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current != null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const handleStartAnalysis = async (
    sourceFile: File,
    documentFiles: File[],
    selectedProjectName: string
  ) => {
    try {
      setIsUploading(true);
      setProjectName(selectedProjectName || sourceFile.name.replace(/\.[^/.]+$/, ''));

      // 1. Upload files to Cloud Storage
      const uploadRes = await uploadFiles(sourceFile, documentFiles, selectedProjectName);
      
      // 2. Create the job referencing the uploadId
      const jobRes = await createJob(uploadRes.uploadId, uploadRes.projectName);

      const sessionProjectName = jobRes.projectName || selectedProjectName || sourceFile.name.replace(/\.[^/.]+$/, '');
      persistAnalysisSession({
        jobId: jobRes.jobId,
        projectName: sessionProjectName,
        startedAt: Date.now(),
      });
      setJobId(jobRes.jobId);
      setProjectName(sessionProjectName);
      setMode('processing');
      setRestoredJobState(null);
      showSessionNotice(`解析ジョブ ${jobRes.jobId} を保存しました。ページを更新しても復元できます。`);
    } catch (err) {
      console.error('Failed to initiate analysis:', err);
      alert(err instanceof Error ? err.message : '解析の開始に失敗しました。');
    } finally {
      setIsUploading(false);
    }
  };

  const handleJobComplete = (completedJobId: string) => {
    setJobId(completedJobId);
    setMode('results');
    setRestoredJobState(null);
  };

  const handleReset = () => {
    setJobId('');
    setProjectName('');
    setMode('upload');
    setRestoredJobState(null);
    setSessionNotice(null);
    clearAnalysisSession();
    if (noticeTimerRef.current != null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  };

  return (
    <div className="container" id="app-root-container">
      {/* Premium Header */}
      <header className="app-header" id="app-main-header">
        <h1 className="logo-text" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <Flame size={44} style={{ color: 'var(--accent-color)', fill: 'currentColor' }} />
          <span>PhoenixDevOps</span>
        </h1>
        <p className="subtitle" id="app-main-subtitle">
          レガシーシステムの「ドキュメントとコードの実態乖離」を再生するAIエージェント
        </p>
      </header>

      {sessionNotice && (
        <div className="session-banner" role="status" aria-live="polite">
          <Info size={16} />
          <span>{sessionNotice}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }} id="app-main-content">
        {isHydrating ? (
          <div className="glass-card app-bootstrap-card" id="app-restore-loading">
            <Loader2 className="upload-icon" size={40} style={{ animation: 'rotateSpinner 1.5s linear infinite' }} />
            <p style={{ marginTop: '16px', color: 'var(--text-secondary)', textAlign: 'center' }}>
              前回の解析ジョブを読み込んでいます...
            </p>
          </div>
        ) : mode === 'upload' ? (
          <UploadForm
            onStartAnalysis={handleStartAnalysis}
            isSubmitting={isUploading}
            isMock={isMockMode()}
          />
        ) : mode === 'processing' ? (
          <JobProgress
            jobId={jobId}
            projectName={projectName}
            onComplete={handleJobComplete}
            onBack={handleReset}
            initialStatus={restoredJobState?.status}
            initialErrorMessage={restoredJobState?.errorMessage}
            initialElapsedTime={restoredJobState?.elapsedTime}
          />
        ) : (
          <ResultViewer
            jobId={jobId}
            projectName={projectName}
            onReset={handleReset}
          />
        )}
      </main>

      {/* Premium Footer */}
      <footer className="app-footer" id="app-main-footer">
        <p>© 2026 PhoenixDevOps. DevOps x AI Agent Hackathon Project.</p>
      </footer>
    </div>
  );
}

function readStoredSession(): AnalysisSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ANALYSIS_SESSION_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<AnalysisSession>;
    if (
      typeof parsed.jobId !== 'string' ||
      typeof parsed.projectName !== 'string' ||
      typeof parsed.startedAt !== 'number'
    ) {
      return null;
    }

    return {
      jobId: parsed.jobId,
      projectName: parsed.projectName,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function persistAnalysisSession(session: AnalysisSession): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(session));
}

function clearAnalysisSession(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ANALYSIS_SESSION_KEY);
}

function elapsedSecondsSince(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

export default App;
