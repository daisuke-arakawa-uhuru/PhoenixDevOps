import { useState, useEffect } from 'react';
import { getJobStatus } from '../utils/api';
import { AlertCircle, ArrowLeft, RefreshCw, Clock } from 'lucide-react';

interface JobProgressProps {
  jobId: string;
  projectName: string;
  onComplete: (jobId: string) => void;
  onBack: () => void;
}

export default function JobProgress({ jobId, projectName, onComplete, onBack }: JobProgressProps) {
  const [status, setStatus] = useState<'queued' | 'running' | 'succeeded' | 'failed'>('queued');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Poll status
  useEffect(() => {
    let timerId: number;
    
    const checkStatus = async () => {
      try {
        const job = await getJobStatus(jobId);
        setStatus(job.status);
        
        if (job.status === 'succeeded') {
          onComplete(jobId);
        } else if (job.status === 'failed') {
          setErrorMsg(job.errorMessage || '不明な解析エラーが発生しました。');
        } else {
          // Poll again in 3 seconds
          timerId = window.setTimeout(checkStatus, 3000);
        }
      } catch (err) {
        console.error('Error fetching job status:', err);
        setErrorMsg(err instanceof Error ? err.message : 'ステータスの取得に失敗しました。');
        setStatus('failed');
      }
    };

    // First check
    timerId = window.setTimeout(checkStatus, 2000);

    return () => {
      clearTimeout(timerId);
    };
  }, [jobId, onComplete]);

  // Stopwatch counter
  useEffect(() => {
    if (status === 'succeeded' || status === 'failed') return;

    const intervalId = window.setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [status]);

  // Helper to format stopwatch time
  const formatTime = (seconds: number) => {
    const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
    const ss = (seconds % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };

  // Human friendly descriptions
  const getStatusDescription = () => {
    switch (status) {
      case 'queued':
        return '解析キューで待機しています... (ワーカーを起動中)';
      case 'running':
        if (elapsedTime < 8) {
          return '1/3: ソースコードの静的構造解析を実行しています...';
        } else {
          return '2/3: 既存仕様ドキュメントの抽出および差分照合を実行しています...';
        }
      case 'succeeded':
        return '解析が成功しました！設計書をレンダリングしています...';
      case 'failed':
        return '解析中にエラーが発生しました。詳細は下記を確認してください。';
      default:
        return '状態を読み取っています...';
    }
  };

  return (
    <div className="glass-card" id="job-progress-section" style={{ textAlign: 'center' }}>
      <div className="progress-container">
        {status !== 'failed' ? (
          <div className="spinner-wrapper" id="progress-spinner">
            <div className="orbit-spinner"></div>
            <div className="status-badge" id="progress-status-badge">
              {status}
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--error-color)', marginBottom: '24px' }} id="error-alert-icon">
            <AlertCircle size={80} />
          </div>
        )}

        <h2 className="job-title" id="job-title-header">
          {projectName || '無題のプロジェクト'} の解析
        </h2>
        
        <p className="status-text" id="job-status-description">
          {getStatusDescription()}
        </p>

        {/* Stopwatch timer */}
        <div className="timer-text" id="elapsed-time-counter">
          <Clock size={14} style={{ display: 'inline-block', marginRight: '6px', verticalAlign: 'text-top' }} />
          <span>経過時間: {formatTime(elapsedTime)}</span>
        </div>
      </div>

      {/* Error handling details */}
      {status === 'failed' && (
        <div className="error-card" id="error-details-card">
          <div className="error-header">
            <AlertCircle size={18} />
            <span>解析エラー詳細</span>
          </div>
          <div className="error-message" id="error-log-box">
            {errorMsg}
          </div>
          
          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button
              onClick={onBack}
              className="btn-secondary"
              style={{ flex: 1 }}
              id="back-to-form-err-btn"
            >
              <ArrowLeft size={16} />
              <span>フォームに戻る</span>
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn-fire"
              style={{ flex: 1 }}
              id="retry-analysis-btn"
            >
              <RefreshCw size={16} />
              <span>再試行する</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
