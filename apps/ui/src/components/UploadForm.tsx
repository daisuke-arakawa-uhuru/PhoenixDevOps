import React, { useState, useRef } from 'react';
import { FolderArchive, FileText, Trash2, Play, Info } from 'lucide-react';

interface UploadFormProps {
  onStartAnalysis: (sourceFile: File, documentFiles: File[], projectName: string) => void;
  isSubmitting: boolean;
  isMock?: boolean;
}

export default function UploadForm({ onStartAnalysis, isSubmitting, isMock }: UploadFormProps) {
  const [projectName, setProjectName] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  
  const [isSourceDragActive, setIsSourceDragActive] = useState(false);
  const [isDocsDragActive, setIsDocsDragActive] = useState(false);

  const sourceInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);

  const handleLoadDemoData = () => {
    setProjectName('Legacy CRM System');
    setSourceFile(new File(['dummy code content'], 'mock-source.zip', { type: 'application/zip' }));
    setDocumentFiles([
      new File(['dummy doc content'], 'legacy-spec.pdf', { type: 'application/pdf' }),
    ]);
  };

  // Helper to format bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Drag and Drop handlers
  const handleDrag = (e: React.DragEvent, type: 'source' | 'docs', active: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    if (type === 'source') {
      setIsSourceDragActive(active);
    } else {
      setIsDocsDragActive(active);
    }
  };

  const handleDrop = (e: React.DragEvent, type: 'source' | 'docs') => {
    e.preventDefault();
    e.stopPropagation();
    
    if (type === 'source') {
      setIsSourceDragActive(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.name.endsWith('.zip')) {
          setSourceFile(file);
        } else {
          alert('ソースコードは.zip形式でアップロードしてください。');
        }
      }
    } else {
      setIsDocsDragActive(false);
      const files = Array.from(e.dataTransfer.files);
      if (files && files.length > 0) {
        // filter out non-supported binary files if needed, but allow all text/docs for MVP
        setDocumentFiles((prev) => [...prev, ...files]);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'source' | 'docs') => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);

    if (type === 'source') {
      const file = files[0];
      if (file && file.name.endsWith('.zip')) {
        setSourceFile(file);
      } else if (file) {
        alert('ソースコードは.zip形式でアップロードしてください。');
      }
    } else {
      setDocumentFiles((prev) => [...prev, ...files]);
    }
  };

  const removeDocument = (index: number) => {
    setDocumentFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceFile) return;
    if (documentFiles.length === 0) return;
    onStartAnalysis(sourceFile, documentFiles, projectName.trim());
  };

  const isFormValid = sourceFile !== null && documentFiles.length > 0 && !isSubmitting;

  return (
    <form onSubmit={handleSubmit} className="glass-card" id="upload-form-section">
      <h2 style={{ marginBottom: '24px', textAlign: 'left', fontFamily: 'var(--font-heading)', fontWeight: 700 }}>
        新規解析ジョブの登録
      </h2>

      {/* Project Name Input */}
      <div className="form-group">
        <div className="label-container">
          <label htmlFor="project-name-input">プロジェクト名</label>
          <span className="badge optional">任意</span>
        </div>
        <input
          id="project-name-input"
          type="text"
          className="custom-input"
          placeholder="例: レガシー顧客管理SaaS"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      {/* Demo data filler in mock mode */}
      {isMock && (
        <div className="form-group" style={{ marginBottom: '20px' }}>
          <button
            type="button"
            onClick={handleLoadDemoData}
            className="btn-secondary"
            style={{ width: '100%', borderColor: 'var(--accent-color)', color: 'var(--accent-color)', fontWeight: 600 }}
            id="load-demo-data-btn"
          >
            デモ用データ（テスト用ファイル）を自動セットする
          </button>
        </div>
      )}

      {/* Source Code ZIP Dropzone */}
      <div className="form-group">
        <div className="label-container">
          <label>ソースコード一式 (.zip)</label>
          <span className="badge required">必須</span>
        </div>
        
        <div
          id="source-zip-dropzone"
          className={`dropzone ${isSourceDragActive ? 'active' : ''}`}
          onDragEnter={(e) => handleDrag(e, 'source', true)}
          onDragOver={(e) => handleDrag(e, 'source', true)}
          onDragLeave={(e) => handleDrag(e, 'source', false)}
          onDrop={(e) => handleDrop(e, 'source')}
          onClick={() => sourceInputRef.current?.click()}
        >
          <input
            ref={sourceInputRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={(e) => handleFileChange(e, 'source')}
            disabled={isSubmitting}
            id="source-file-input"
          />
          <FolderArchive className="upload-icon" size={40} />
          <p className="upload-text">
            {sourceFile ? (
              <>選択済み: <strong>{sourceFile.name}</strong> ({formatBytes(sourceFile.size)})</>
            ) : (
              <>ファイルをドラッグ＆ドロップ、または <span>ブラウザから選択</span></>
            )}
          </p>
          <p className="upload-hint">解析対象システム全体のコードをまとめたZIPファイル（.zipのみ）</p>
        </div>
      </div>

      {/* Legacy Documents Dropzone */}
      <div className="form-group">
        <div className="label-container">
          <label>既存ドキュメント群</label>
          <span className="badge required">必須</span>
        </div>

        <div
          id="documents-dropzone"
          className={`dropzone ${isDocsDragActive ? 'active' : ''}`}
          onDragEnter={(e) => handleDrag(e, 'docs', true)}
          onDragOver={(e) => handleDrag(e, 'docs', true)}
          onDragLeave={(e) => handleDrag(e, 'docs', false)}
          onDrop={(e) => handleDrop(e, 'docs')}
          onClick={() => docsInputRef.current?.click()}
        >
          <input
            ref={docsInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFileChange(e, 'docs')}
            disabled={isSubmitting}
            id="documents-file-input"
          />
          <FileText className="upload-icon" size={40} />
          <p className="upload-text">
            既存ドキュメントをドラッグ＆ドロップ、または <span>ブラウザから選択</span>
          </p>
          <p className="upload-hint">古い仕様書、設計書、定義書など（複数ファイルの一括登録可）</p>
        </div>

        {/* Selected Documents List */}
        {documentFiles.length > 0 && (
          <div className="file-list" id="selected-documents-list">
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '12px' }}>
              選択されたドキュメント ({documentFiles.length} 件):
            </p>
            {documentFiles.map((file, index) => (
              <div key={`${file.name}-${index}`} className="file-item" id={`doc-item-${index}`}>
                <div className="file-info">
                  <FileText size={16} />
                  <span>{file.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>({formatBytes(file.size)})</span>
                </div>
                <button
                  type="button"
                  className="remove-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeDocument(index);
                  }}
                  title="ファイルを削除"
                  id={`remove-doc-btn-${index}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '20px 0', textAlign: 'left', background: 'rgba(244, 63, 94, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(244, 63, 94, 0.1)' }}>
        <Info size={16} className="text-muted" style={{ flexShrink: 0, marginTop: '2px', color: 'var(--accent-color)' }} />
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          ※ URLパラメータに <code>?mock=true</code> を付与すると、ローカル環境でも即時進捗表示や成果物のプレビューを体験できる「モックモード」で実行できます。
        </p>
      </div>

      {/* Start Button */}
      <button
        type="submit"
        className="btn-fire"
        disabled={!isFormValid}
        id="start-analysis-btn"
      >
        <Play size={18} fill="currentColor" />
        <span>{isSubmitting ? 'アップロード中...' : '解析ジョブを開始する'}</span>
      </button>
    </form>
  );
}
