import { useEffect, useId, useRef, useState } from 'react';

interface MermaidDiagramProps {
  chart: string;
}

type MermaidModule = typeof import('mermaid').default;

let isMermaidInitialized = false;
let mermaidModulePromise: Promise<MermaidModule> | null = null;

async function loadMermaid() {
  mermaidModulePromise ??= import('mermaid').then(({ default: mermaid }) => {
    if (!isMermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'dark',
        fontFamily: 'Outfit, Inter, sans-serif',
        themeVariables: {
          background: '#090e16',
          primaryColor: '#1e293b',
          primaryBorderColor: '#f472b6',
          primaryTextColor: '#f8fafc',
          secondaryColor: '#312e81',
          secondaryBorderColor: '#c084fc',
          secondaryTextColor: '#f8fafc',
          tertiaryColor: '#0f172a',
          tertiaryBorderColor: '#38bdf8',
          tertiaryTextColor: '#e2e8f0',
          lineColor: '#cbd5e1',
          textColor: '#e2e8f0',
        },
      });

      isMermaidInitialized = true;
    }

    return mermaid;
  });

  return mermaidModulePromise;
}

export default function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderSequenceRef = useRef(0);
  const diagramId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    let frameId: number | null = null;

    const renderDiagram = async () => {
      try {
        const mermaid = await loadMermaid();
        renderSequenceRef.current += 1;

        const { svg: renderedSvg, bindFunctions } = await mermaid.render(
          `mermaid-${diagramId}-${renderSequenceRef.current}`,
          chart,
        );

        if (isCancelled) {
          return;
        }

        setHasError(false);
        setSvg(renderedSvg);

        frameId = window.requestAnimationFrame(() => {
          if (!isCancelled && containerRef.current && bindFunctions) {
            bindFunctions(containerRef.current);
          }
        });
      } catch (error) {
        console.error('Failed to render Mermaid diagram:', error);

        if (!isCancelled) {
          setHasError(true);
          setSvg(null);
        }
      }
    };

    void renderDiagram();

    return () => {
      isCancelled = true;

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [chart, diagramId]);

  if (hasError) {
    return (
      <pre>
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <div className="mermaid-block">
      {svg ? (
        <div
          ref={containerRef}
          className="mermaid-diagram"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="mermaid-placeholder">Mermaid 図を描画しています...</div>
      )}
    </div>
  );
}
