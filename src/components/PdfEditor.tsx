import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Download, Eraser, FilePenLine,
  FileText, Highlighter, ImagePlus, LoaderCircle, MousePointer2, PenLine,
  RotateCcw, ShieldCheck, Trash2, UploadCloud, X,
} from 'lucide-react';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { downloadOutput, validateFiles } from '../lib/pdf';
import { prettyBytes } from '../lib/pages';
import { saveEditedPdf } from '../lib/editor';
import { normalizedRect } from '../lib/editorGeometry';
import type { Annotation, EditorKind, Point, PageMapping } from '../lib/editor';

type Mode = 'select' | EditorKind;
type Drag = { kind: 'move' | 'draw' | 'highlight'; id: string; start: Point; original?: Annotation };
const COLORS = ['#202637', '#745df5', '#ea546e', '#f5c343', '#17a88d', '#ffffff'];

function id() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
const baseAnnotation = (page: number, kind: EditorKind, point: Point, color: string, size: number): Annotation => ({
  id: id(), page, kind, x: point.x, y: point.y, width: 0, height: 0, color, size,
  content: '', points: [],
});

export default function PdfEditor({ onBack, onExport }: { onBack: () => void; onExport: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(0);
  const [viewport, setViewport] = useState({ width: 595, height: 842 });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [mode, setMode] = useState<Mode>('text');
  const [color, setColor] = useState('#745df5');
  const [size, setSize] = useState(16);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{ data: string; ratio: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const revision = useRef(0);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const current = annotations.find(a => a.id === selected);
  const count = document?.numPages ?? 0;
  const pageItems = annotations.filter(a => a.page === page);

  useEffect(() => () => { void documentRef.current?.destroy(); }, []);
  useEffect(() => {
    if (!document) return;
    let stopped = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;
    setRendering(true);
    const run = async () => {
      try {
        const pdfPage = await document.getPage(page + 1);
        if (stopped) return;
        const logical = pdfPage.getViewport({ scale: 1 });
        setViewport({ width: logical.width, height: logical.height });
        const element = canvas.current;
        if (!element) return;
        const maxPixels = 1250;
        const scale = Math.min(2, maxPixels / logical.width);
        const output = pdfPage.getViewport({ scale });
        element.width = Math.round(output.width);
        element.height = Math.round(output.height);
        const context = element.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');
        renderTask = pdfPage.render({ canvas: element, canvasContext: context, viewport: output });
        await renderTask.promise;
      } catch (cause) {
        if (!stopped && (cause as Error)?.name !== 'RenderingCancelledException') {
          setError('This PDF page could not be rendered. Try another document.');
        }
      } finally { if (!stopped) setRendering(false); }
    };
    void run();
    return () => { stopped = true; renderTask?.cancel(); };
  }, [document, page]);

  async function loadFile(value?: File) {
    if (!value) return;
    const token = ++revision.current;
    setLoading(true); setError(''); setSelected(null);
    try {
      await validateFiles([value], 'rotate');
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = pdfjs.getDocument({ data: new Uint8Array(await value.arrayBuffer()) });
      const next = await task.promise;
      if (token !== revision.current) { await next.destroy(); return; }
      const previous = documentRef.current;
      documentRef.current = next;
      setFile(value); setDocument(next); setPage(0); setAnnotations([]); setMode('text'); setPendingImage(null);
      if (previous) void previous.destroy().catch(() => undefined);
    } catch (cause) {
      if (token === revision.current) setError(cause instanceof Error ? cause.message : 'Unable to open PDF.');
    } finally { if (token === revision.current) setLoading(false); }
  }

  async function addImage(event: ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0];
    event.target.value = '';
    if (!image) return;
    if (!/^image\/(png|jpeg)$/.test(image.type) || image.size > 5 * 1024 * 1024) {
      setError('Please select a PNG or JPEG image up to 5 MB.'); return;
    }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Cannot read this image.'));
        reader.readAsDataURL(image);
      });
      const ratio = await new Promise<number>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth / img.naturalHeight);
        img.onerror = () => reject(new Error('Image could not be decoded.'));
        img.src = data;
      });
      setPendingImage({ data, ratio }); setMode('image'); setSelected(null); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Image error.'); }
  }

  function getPosition(event: ReactPointerEvent<SVGSVGElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) * viewport.width / rect.width;
    const y = (event.clientY - rect.top) * viewport.height / rect.height;
    return { x: Math.max(0, Math.min(viewport.width, x)), y: Math.max(0, Math.min(viewport.height, y)) };
  }
  function update(idToUpdate: string, mapper: (ann: Annotation) => Annotation) {
    setAnnotations(existing => existing.map(a => a.id === idToUpdate ? mapper(a) : a));
  }
  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !document || rendering) return;
    const point = getPosition(event);
    const target = (event.target as Element).closest('[data-annotation-id]');
    const clicked = target?.getAttribute('data-annotation-id');
    if (mode === 'select') {
      setSelected(clicked || null);
      const original = annotations.find(a => a.id === clicked);
      if (original) drag.current = { kind: 'move', id: original.id, start: point, original };
      else drag.current = null;
      if (original) event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (mode === 'image') {
      if (!pendingImage) { imageInput.current?.click(); return; }
      const width = Math.min(160, viewport.width * .45);
      const height = width / pendingImage.ratio;
      const item = { ...baseAnnotation(page, 'image', point, color, size),
        x: Math.min(point.x, viewport.width - width),
        y: Math.min(point.y, viewport.height - height), width, height, imageData: pendingImage.data };
      setAnnotations(prev => [...prev, item]); setSelected(item.id); setMode('select');
      return;
    }
    const ann = baseAnnotation(page, mode, point, color, mode === 'draw' ? Math.max(1, size / 5) : size);
    if (mode === 'text') {
      ann.content = 'Your text here';
      setAnnotations(prev => [...prev, ann]); setSelected(ann.id); setMode('select');
      return;
    }
    if (mode === 'draw') ann.points = [point];
    setAnnotations(prev => [...prev, ann]);
    drag.current = { kind: mode, id: ann.id, start: point };
    setSelected(ann.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const currentDrag = drag.current;
    if (!currentDrag) return;
    const point = getPosition(event);
    if (currentDrag.kind === 'move' && currentDrag.original) {
      const dx = point.x - currentDrag.start.x;
      const dy = point.y - currentDrag.start.y;
      update(currentDrag.id, () => {
        const original = currentDrag.original!;
        return { ...original, x: original.x + dx, y: original.y + dy,
          points: original.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
      });
    } else if (currentDrag.kind === 'highlight') {
      update(currentDrag.id, ann => ({ ...ann, ...normalizedRect(currentDrag.start, point) }));
    } else if (currentDrag.kind === 'draw') {
      update(currentDrag.id, ann => ({ ...ann, points: [...ann.points, point] }));
    }
  }
  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (drag.current?.kind === 'highlight') {
      const idToCheck = drag.current.id;
      // A click-sized rectangle would not be a useful highlight.
      setAnnotations(prev => prev.filter(a => a.id !== idToCheck || (a.width >= 2 && a.height >= 2)));
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  async function exportPdf() {
    if (!file || !document || !annotations.length) return;
    setSaving(true); setError('');
    try {
      const output = await saveEditedPdf(file, annotations, async (index): Promise<PageMapping> => {
        const p = await document.getPage(index + 1);
        const v = p.getViewport({ scale: 1 });
        return { width: v.width, height: v.height, transform: [...v.transform] as PageMapping['transform'] };
      });
      downloadOutput(output);
      onExport();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the edited PDF.'); }
    finally { setSaving(false); }
  }
  function removeSelected() {
    if (!selected) return;
    setAnnotations(prev => prev.filter(a => a.id !== selected)); setSelected(null);
  }

  return <section className="editor-workspace">
    <button type="button" className="back-link" onClick={onBack}><ArrowLeft size={17}/> All tools <span>/</span> Edit PDF</button>
    <div className="editor-header"><div className="editor-heading"><span className="editor-header-icon"><FilePenLine size={25}/></span><div><span className="section-eyebrow">DOCORBIT STUDIO · V0.3</span><h1>Edit your PDF visually</h1><p>Add text, highlights, freehand signatures, and images. Everything stays on this device.</p></div></div>{file && <button className="editor-export" disabled={saving || !annotations.length} onClick={() => void exportPdf()}>{saving ? <LoaderCircle size={18} className="spin"/> : <Download size={18}/>} {saving ? 'Exporting…' : 'Download edited PDF'}</button>}</div>
    {!file ? <div className="editor-empty"><div className="editor-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void loadFile(e.dataTransfer.files[0]); }}><div className="editor-upload-mark"><UploadCloud size={34}/></div><h2>Start with a PDF document</h2><p>Choose a PDF to open the page editor. Your document is never uploaded.</p><button className="editor-action" disabled={loading} onClick={() => pdfInput.current?.click()}>{loading ? 'Opening…' : 'Choose PDF'}</button><small>PDF files up to 50 MB · Password-protected files are not supported</small></div></div> : <div className="editor-layout">
      <aside className="editor-controls">
        <div className="editor-panel-head"><span>EDITOR TOOLS</span><button onClick={() => pdfInput.current?.click()} title="Open another PDF"><UploadCloud size={15}/> Replace</button></div>
        <div className="editor-mode-list">
          {([
            ['select', MousePointer2, 'Select & move', 'Drag an existing item'],
            ['text', FileText, 'Add text', 'Click a page to place text'],
            ['highlight', Highlighter, 'Highlight', 'Drag to mark an area'],
            ['draw', PenLine, 'Draw / sign', 'Draw with a finger or mouse'],
            ['image', ImagePlus, 'Add image', 'Stamp a PNG or JPG image'],
          ] as const).map(([id, Icon, title, help]) => <button key={id} className={`editor-mode ${mode === id ? 'active' : ''}`} onClick={() => {setMode(id);setSelected(null);if(id === 'image' && !pendingImage) imageInput.current?.click(); }}><Icon size={18}/><span><strong>{title}</strong><small>{help}</small></span>{mode === id && <Check size={14}/>}</button>)}
        </div>
        <div className="editor-divider" />
        <label className="editor-field"><span>Color</span><div className="editor-colors">{COLORS.map(hex => <button type="button" key={hex} aria-label={`Color ${hex}`} title={hex} onClick={() => { setColor(hex); if (selected) update(selected, ann => ({ ...ann, color: hex })); }} className={color === hex ? 'active' : ''} style={{ backgroundColor: hex }} />)}</div></label>
        <label className="editor-field"><span>{mode === 'draw' ? 'Stroke size' : 'Font size / stroke'}</span><div className="editor-slider"><input aria-label="Size" type="range" min="8" max="36" value={size} onChange={e => { const n = Number(e.target.value); setSize(n); if (current && current.kind === 'text') update(current.id, a => ({ ...a, size: n })); }}/><b>{size}</b></div></label>
        {current && <div className="editor-selected"><div className="editor-selected-title"><strong>Selected {current.kind}</strong><button type="button" aria-label="Delete selected item" onClick={removeSelected}><Trash2 size={17}/></button></div>{current.kind === 'text' && <label>Text<textarea value={current.content} rows={3} maxLength={500} onChange={e => update(current.id, a => ({ ...a, content: e.target.value }))}/></label>}{current.kind === 'image' && <small>Drag the image to reposition it.</small>}{current.kind === 'draw' && <small>Signature/ink is embedded when you export.</small>}</div>}
        <div className="editor-utility"><button onClick={() => {setAnnotations(prev => prev.slice(0, -1));setSelected(null);}} disabled={!annotations.length}><RotateCcw size={16}/> Undo last</button><button onClick={() => {setAnnotations([]);setSelected(null);}} disabled={!annotations.length}><Eraser size={16}/> Clear all</button></div>
        <div className="editor-privacy"><ShieldCheck size={18}/><span>Local editing. No signup, API key, or cloud upload required.</span></div>
      </aside>
      <div className="editor-canvas-section">
        <div className="editor-document-bar"><div className="editor-doc-title"><FileText size={16}/><strong title={file.name}>{file.name}</strong><small>{prettyBytes(file.size)}</small></div><div className="editor-pagination"><button disabled={page <= 0} aria-label="Previous page" onClick={() => {setSelected(null);setPage(p => p-1);}}><ChevronLeft size={19}/></button><span>Page <b>{page + 1}</b> of {count}</span><button disabled={page >= count - 1} aria-label="Next page" onClick={() => {setSelected(null);setPage(p => p+1);}}><ChevronRight size={19}/></button></div></div>
        <div className="editor-canvas-container"><div className="editor-page" style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}><canvas ref={canvas} aria-label={`PDF page ${page + 1}`} />
          <svg className={`editor-overlay editor-cursor-${mode}`} viewBox={`0 0 ${viewport.width} ${viewport.height}`} preserveAspectRatio="none" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
            {pageItems.map(item => <g key={item.id} data-annotation-id={item.id}>
              {item.kind === 'text' && <text data-annotation-id={item.id} x={item.x} y={item.y + item.size} fontSize={item.size} fill={item.color} fontFamily="Helvetica, Arial, sans-serif" style={{ whiteSpace:'pre' }}>{item.content.split('\n').map((line,i) => <tspan key={i} x={item.x} dy={i === 0 ? 0 : item.size * 1.22}>{line || ' '}</tspan>)}</text>}
              {item.kind === 'highlight' && <rect data-annotation-id={item.id} x={item.x} y={item.y} width={item.width} height={item.height} fill={item.color} fillOpacity={.28} />}
              {item.kind === 'draw' && <polyline data-annotation-id={item.id} points={item.points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={item.color} strokeWidth={item.size} strokeLinecap="round" strokeLinejoin="round" />}
              {item.kind === 'image' && item.imageData && <image data-annotation-id={item.id} href={item.imageData} x={item.x} y={item.y} width={item.width} height={item.height} />}
              {selected === item.id && <rect x={item.kind==='draw' ? Math.min(...item.points.map(p=>p.x)) - 4 : item.x - 3} y={item.kind==='draw' ? Math.min(...item.points.map(p=>p.y)) - 4 : item.y - 3} width={item.kind==='draw' ? Math.max(8,Math.max(...item.points.map(p=>p.x))-Math.min(...item.points.map(p=>p.x))+8) : Math.max(20,item.kind==='text' ? item.content.length * item.size*.5 : item.width)+6} height={item.kind==='draw' ? Math.max(8, Math.max(...item.points.map(p=>p.y)) - Math.min(...item.points.map(p=>p.y)) + 8) : Math.max(18, item.kind==='text' ? item.size * Math.max(1,item.content.split('\n').length)*1.3 : item.height)+6} fill="none" stroke="#7564f7" strokeDasharray="5 3" strokeWidth="1.5" pointerEvents="none"/>}
            </g>)}
          </svg>
          {rendering && <div className="editor-rendering"><LoaderCircle className="spin"/> Rendering page…</div>}
        </div></div>
        <div className="editor-bottom-bar"><span><Check size={15}/> {annotations.length} edit{annotations.length === 1 ? '' : 's'} across {new Set(annotations.map(a=>a.page)).size} page(s)</span><span>{mode === 'select' ? 'Click an item to select; drag to reposition.' : mode === 'image' ? (pendingImage ? 'Tap PDF to place your image.' : 'Choose an image first.') : mode === 'text' ? 'Tap PDF to add text.' : mode === 'highlight' ? 'Drag over the area to highlight.' : 'Drag on the PDF to draw or sign.'}</span></div>
      </div>
    </div>}
    {file && <div className="editor-mobile-export"><button className="editor-export" disabled={saving || !annotations.length} onClick={() => void exportPdf()}><Download size={18}/> Download edited PDF</button></div>}
    <div className="editor-note"><FilePenLine size={18}/><span><b>Editing scope:</b> This tool adds new objects and markings over existing PDF content. It does not directly rewrite text already embedded in the original PDF, or securely redact it.</span></div>
    {error && <div className="error-banner" role="alert"><X size={15}/>{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
    <input ref={pdfInput} className="hidden" type="file" accept=".pdf,application/pdf" onChange={e=>{void loadFile(e.target.files?.[0]); e.target.value='';}} />
    <input ref={imageInput} className="hidden" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={e=>void addImage(e)} />
  </section>;
}
