import { useEffect, useRef, useState } from 'react';
import { FileWarning, LoaderCircle } from 'lucide-react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type Props = { file: File; compact?: boolean };

export default function PdfPreview({ file, compact = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | undefined;
    setState('loading');
    const render = async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const data = new Uint8Array(await file.arrayBuffer());
        if (cancelled) return;
        const task = pdfjs.getDocument({ data });
        loadingTask = task;
        const doc = await task.promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        const firstViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1.6, (compact ? 250 : 370) / firstViewport.width);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        await page.render({ canvas, canvasContext: context, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] }).promise;
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };
    void render();
    return () => {
      cancelled = true;
      if (loadingTask) void loadingTask.destroy().catch(() => undefined);
    };
  }, [file, compact]);

  return <div className={`pdf-preview ${compact ? 'compact' : ''}`}>
    {state === 'loading' && <div className="preview-status"><LoaderCircle className="spin" size={22} />Rendering preview…</div>}
    {state === 'error' && <div className="preview-status error"><FileWarning size={22} /> Preview unavailable</div>}
    <canvas ref={canvasRef} className={state !== 'ready' ? 'hidden' : ''} aria-label={`First-page preview of ${file.name}`} />
    {state === 'ready' && <span className="preview-corner">PAGE 01</span>}
  </div>;
}
