import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getJobResults, fetchFileContent, type Artifact } from '../utils/api';
import { FileText, AlertTriangle, Download, RefreshCw, Loader2, Network } from 'lucide-react';

interface ResultViewerProps {
  jobId: string;
  projectName: string;
  onReset: () => void;
}

type ResultTabId = 'ssot' | 'spec' | 'report';

const RESULT_TABS = [
  {
    id: 'ssot',
    fileName: 'single-source-of-truth.md',
    label: 'SSOT仕様書',
    icon: Network,
  },
  {
    id: 'spec',
    fileName: 'true-design.md',
    label: '真の設計書',
    icon: FileText,
  },
  {
    id: 'report',
    fileName: 'document-drift-report.md',
    label: 'ドキュメント差分レポート',
    icon: AlertTriangle,
  },
] as const;

export default function ResultViewer({ jobId, projectName, onReset }: ResultViewerProps) {
  const [activeTab, setActiveTab] = useState<ResultTabId>('ssot');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const [fileContent, setFileContent] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const availableTabs = RESULT_TABS.filter((tab) => artifacts.some((artifact) => artifact.name === tab.fileName));

  // Load artifact links
  useEffect(() => {
    const fetchResults = async () => {
      try {
        setIsLoading(true);
        const res = await getJobResults(jobId);
        setArtifacts(res.artifacts);
      } catch (err) {
        console.error('Error fetching results:', err);
        setErrorMsg(err instanceof Error ? err.message : '成果物リストの取得に失敗しました。');
      } finally {
        setIsLoading(false);
      }
    };
    fetchResults();
  }, [jobId]);

  // Load content of active file
  useEffect(() => {
    if (artifacts.length === 0) return;

    const loadContent = async () => {
      try {
        setIsFetchingContent(true);
        setErrorMsg(null);

        const tab = RESULT_TABS.find((item) => item.id === activeTab) ?? RESULT_TABS[0];
        const fileName = tab.fileName;
        const artifact = artifacts.find(a => a.name === fileName);
        
        if (!artifact) {
          const fallbackTab = RESULT_TABS.find((item) => artifacts.some((a) => a.name === item.fileName));
          if (fallbackTab && fallbackTab.id !== activeTab) {
            setActiveTab(fallbackTab.id);
            return;
          }
          throw new Error(`成果物ファイルが見つかりません: ${fileName}`);
        }

        const text = await fetchFileContent(artifact.url);
        setFileContent(text);
      } catch (err) {
        console.error('Error loading content:', err);
        setErrorMsg(err instanceof Error ? err.message : 'ファイルの読み込みに失敗しました。');
      } finally {
        setIsFetchingContent(false);
      }
    };

    loadContent();
  }, [artifacts, activeTab]);

  // Handle blob download
  const handleDownload = () => {
    if (!fileContent) return;
    
    const blob = new Blob([fileContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    const defaultFilename = (RESULT_TABS.find((tab) => tab.id === activeTab) ?? RESULT_TABS[0]).fileName;
    link.href = url;
    link.setAttribute('download', `${projectName ? projectName.replace(/\s+/g, '_') + '_' : ''}${defaultFilename}`);
    
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px' }} id="results-loading-screen">
        <Loader2 className="upload-icon" size={48} style={{ animation: 'rotateSpinner 1.5s linear infinite' }} />
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>解析成果物のリンクを読み込んでいます...</p>
      </div>
    );
  }

  return (
    <div className="results-wrapper" id="results-viewer-section">
      <div className="results-action-bar">
        {/* Navigation Tabs */}
        <div className="tabs-container" id="results-tabs">
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                id={`tab-btn-${tab.id}`}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Action Button Group */}
        <div className="action-buttons">
          <button
            onClick={handleDownload}
            disabled={isFetchingContent || !!errorMsg || !fileContent}
            className="btn-secondary"
            id="download-artifact-btn"
          >
            <Download size={16} />
            <span>ダウンロード</span>
          </button>
          <button
            onClick={onReset}
            className="btn-fire"
            style={{ padding: '8px 16px', fontSize: '0.95rem' }}
            id="new-analysis-btn"
          >
            <RefreshCw size={16} />
            <span>新規解析</span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="glass-card" style={{ padding: '0px' }}>
        {isFetchingContent ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px' }} id="content-loading-screen">
            <Loader2 className="upload-icon" size={36} style={{ animation: 'rotateSpinner 1.5s linear infinite', color: 'var(--accent-color)' }} />
            <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>レポートの内容を読み込んでいます...</p>
          </div>
        ) : errorMsg ? (
          <div style={{ padding: '40px', textAlign: 'center' }} id="results-error-box">
            <AlertTriangle size={40} style={{ color: 'var(--error-color)', marginBottom: '12px' }} />
            <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>データの読み込みに失敗しました</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>{errorMsg}</p>
          </div>
        ) : (
          <div className="preview-container" id="markdown-preview-container">
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {fileContent}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
