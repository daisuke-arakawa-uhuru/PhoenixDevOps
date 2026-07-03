import { useEffect, useId, useRef, useState } from 'react';

interface MermaidDiagramProps {
  chart: string;
}

type MermaidModule = typeof import('mermaid').default;

let isMermaidInitialized = false;
let mermaidModulePromise: Promise<MermaidModule> | null = null;

function normalizeSubgraphLabel(line: string): string {
  const bracketMatch = line.match(/^(\s*subgraph\s+)([A-Za-z0-9_-]+)\s*\[(.+)\]\s*$/);

  if (bracketMatch) {
    const [, prefix, id, rawLabel] = bracketMatch;
    const label = rawLabel.trim();

    if (
      (label.startsWith('"') && label.endsWith('"')) ||
      (label.startsWith("'") && label.endsWith("'")) ||
      (label.startsWith('`') && label.endsWith('`'))
    ) {
      return line;
    }

    return `${prefix}${id}["${label.replaceAll('"', '\\"')}"]`;
  }

  const parenMatch = line.match(/^(\s*subgraph\s+)([A-Za-z0-9_-]+)\s*\((.+)\)\s*$/);

  if (parenMatch) {
    const [, prefix, id, rawLabel] = parenMatch;
    const label = rawLabel.trim();
    return `${prefix}${id}["${label.replaceAll('"', '\\"')}"]`;
  }

  return line;
}

function normalizeMermaidChart(chart: string): string {
  return chart
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map(normalizeSubgraphLabel)
    .join('\n');
}

function isMermaidErrorSvg(svg: string): boolean {
  return svg.includes('Syntax error in text') || svg.includes('class="error-icon"');
}

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
      const normalizedChart = normalizeMermaidChart(chart);
      const chartVariants = normalizedChart === chart ? [chart] : [normalizedChart, chart];

      try {
        const mermaid = await loadMermaid();
        let lastError: unknown = null;

        for (const chartVariant of chartVariants) {
          try {
            const parseResult = await mermaid.parse(chartVariant, { suppressErrors: true });

            if (!parseResult) {
              lastError = new Error('Mermaid syntax validation failed.');
              continue;
            }

            renderSequenceRef.current += 1;

            const { svg: renderedSvg, bindFunctions } = await mermaid.render(
              `mermaid-${diagramId}-${renderSequenceRef.current}`,
              chartVariant,
            );

            if (isMermaidErrorSvg(renderedSvg)) {
              lastError = new Error('Mermaid returned an error diagram.');
              continue;
            }

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

            return;
          } catch (error) {
            lastError = error;
          }
        }

        throw lastError;
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
