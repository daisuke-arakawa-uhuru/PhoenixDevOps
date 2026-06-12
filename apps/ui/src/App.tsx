import { useState } from 'react';
import UploadForm from './components/UploadForm';
import JobProgress from './components/JobProgress';
import ResultViewer from './components/ResultViewer';
import { uploadFiles, createJob, isMockMode } from './utils/api';
import { Flame } from 'lucide-react';

type AppMode = 'upload' | 'processing' | 'results';

function App() {
  const [mode, setMode] = useState<AppMode>('upload');
  const [jobId, setJobId] = useState<string>('');
  const [projectName, setProjectName] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);

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

      setJobId(jobRes.jobId);
      setMode('processing');
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
  };

  const handleReset = () => {
    setJobId('');
    setProjectName('');
    setMode('upload');
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

      {/* Main Content Area */}
      <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }} id="app-main-content">
        {mode === 'upload' && (
          <UploadForm
            onStartAnalysis={handleStartAnalysis}
            isSubmitting={isUploading}
            isMock={isMockMode()}
          />
        )}

        {mode === 'processing' && (
          <JobProgress
            jobId={jobId}
            projectName={projectName}
            onComplete={handleJobComplete}
            onBack={handleReset}
          />
        )}

        {mode === 'results' && (
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

export default App;
