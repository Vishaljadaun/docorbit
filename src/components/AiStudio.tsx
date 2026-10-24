import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  ArrowLeft, ArrowRight, Bot, Check, CircleHelp, ClipboardCopy, CloudOff,
  Download, FileText, Lightbulb, LoaderCircle, MessageCircleQuestion,
  RefreshCcw, ShieldCheck, Sparkles, Upload, X,
} from 'lucide-react';
import PdfPreview from './PdfPreview';
import { extractPdfText } from '../lib/ai/pdfText';
import { makePassages, relevantPassages, samplePassages } from '../lib/ai/document';
import type { DocumentPage } from '../lib/ai/document';

const MODES = [
  { id: 'summary', label: 'Summarize', desc: 'A concise document overview', icon: Sparkles },
  { id: 'points', label: 'Key points', desc: 'The main ideas at a glance', icon: Lightbulb },
  { id: 'ask', label: 'Ask PDF', desc: 'Ask a question about its content', icon: MessageCircleQuestion },
] as const;
type Mode = typeof MODES[number]['id'];
type JobMessage = { type: 'status' | 'result' | 'error'; id?: number; message?: string; output?: string; error?: string };

type Props = { onBack: () => void; onResult: (mode: Mode) => void };

export default function AiStudio({ onBack, onResult }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [mode, setMode] = useState<Mode>('summary');
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [sourcePages, setSourcePages] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);
  const version = useRef(0);
  const jobId = useRef(0);
  const passages = useMemo(() => makePassages(pages), [pages]);
  const sample = useMemo(() => samplePassages(passages, 5), [passages]);
  const wordCount = useMemo(() => pages.reduce((total, page) => total + (page.text.match(/\S+/g)?.length ?? 0), 0), [pages]);

  function mountWorker() {
    const instance = new Worker(new URL('../lib/ai/model.worker.ts', import.meta.url), { type: 'module' });
    instance.onmessage = (event: MessageEvent<JobMessage>) => {
      const message = event.data;
      if (message.type === 'status') { setStatus(message.message || 'Working…'); return; }
      if (message.id !== jobId.current) return;
      setRunning(false);
      setStatus('');
      if (message.type === 'error') setError(message.error || 'Model failed. Please try again.');
      if (message.type === 'result') {
        setOutput(message.output || '');
        // Track only which kind of AI tool ran. Never store document names or content.
        onResult(modeRef.current);
      }
    };
    instance.onerror = () => {
      setRunning(false);
      setStatus('');
      setError('The on-device AI worker failed. Refresh the page or try another browser.');
    };
    worker.current = instance;
  }
  const modeRef = useRef<Mode>('summary');
  useEffect(() => {
    mountWorker();
    return () => { worker.current?.terminate(); worker.current = null; ++version.current; };
    // Worker lifecycle must be scoped to a single studio mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function attach(selected: File | undefined) {
    if (!selected) return;
    const current = ++version.current;
    // Cancel any model run from the previous PDF before replacing the document.
    if (running) cancel();
    setFile(null); setPages([]); setPageCount(0); setTruncated(false);
    setOutput(''); setError(''); setSourcePages([]); setCopied(false);
    if (!/\.pdf$/i.test(selected.name)) { setError('Only PDF files are supported.'); return; }
    setReading(true);
    setStatus('Opening your PDF locally…');
    try {
      const extracted = await extractPdfText(selected, message => { if (current === version.current) setStatus(message); });
      if (current !== version.current) return;
      if (!extracted.pages.some(page => page.text.trim().length > 0)) {
        throw new Error('No selectable text was found. This is likely a scanned PDF; OCR support is planned.');
      }
      if (extracted.pages.reduce((n, page) => n + page.text.trim().length, 0) < 80) {
        throw new Error('Too little readable text was found. Try a text-based PDF.');
      }
      setFile(selected); setPages(extracted.pages); setPageCount(extracted.pageCount); setTruncated(extracted.truncated);
    } catch (cause) {
      if (current === version.current) setError(cause instanceof Error ? cause.message : 'Cannot extract PDF text.');
    } finally {
      if (current === version.current) { setReading(false); setStatus(''); }
    }
  }

  function cancel() {
    ++jobId.current;
    worker.current?.terminate();
    worker.current = null;
    mountWorker();
    setRunning(false); setStatus('');
  }

  function run() {
    if (!file || !pages.length || running || reading) return;
    setOutput(''); setError(''); setSourcePages([]); setCopied(false);
    let contexts: string[];
    if (mode === 'ask') {
      if (question.trim().length < 4) { setError('Enter a specific question with at least 4 characters.'); return; }
      const matched = relevantPassages(passages, question, 2);
      if (!matched.length) { setError('No relevant passages were found for that question. Try more specific keywords.'); return; }
      contexts = matched.map(p => p.text);
      setSourcePages([...new Set(matched.map(p => p.page))]);
    } else {
      contexts = sample.passages.map(p => p.text);
      setSourcePages([...new Set(sample.passages.map(p => p.page))]);
    }
    modeRef.current = mode;
    setRunning(true);
    setStatus('Preparing the local AI model…');
    const id = ++jobId.current;
    worker.current?.postMessage({ id, kind: mode, contexts, question: mode === 'ask' ? question.trim() : undefined });
  }

  function clear() {
    if (running) cancel();
    ++version.current;
    setFile(null); setPages([]); setPageCount(0); setOutput(''); setSourcePages([]);
    setError(''); setStatus(''); setTruncated(false); setReading(false);
  }

  function download() {
    if (!output) return;
    const text = `DocOrbit AI Studio — ${MODES.find(m => m.id === mode)?.label}\nSource: ${file?.name || 'PDF'}\nPages consulted: ${sourcePages.join(', ')}\n\n${output}\n\nAI-generated; verify against the original document.`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'docorbit-ai-notes.txt'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }

  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void attach(event.dataTransfer.files[0]); }
  return <section className="ai-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17}/> Workspace <span>/</span> AI Studio</button>
    <div className="ai-hero"><div className="ai-hero-title"><span className="ai-hero-glyph"><Bot size={25}/></span><span className="ai-feature-pill"><Sparkles size={12}/> NEW · ON-DEVICE AI</span></div><h1>Meet your document <span>copilot.</span></h1><p>Summarize dense PDFs, find important ideas, and ask questions. Small-model AI, processed directly on your device.</p><div className="ai-hero-chips"><span><ShieldCheck size={14}/> No API key</span><span><CloudOff size={14}/> No PDF upload</span><span><Check size={14}/> Free model</span></div></div>

    <div className="ai-layout"><div className="ai-left">
      <div className="workspace-panel ai-panel"><div className="panel-heading"><div><h3>01 <span>Choose a document</span></h3><p>Text-based English PDFs work best.</p></div><span className="tag tag-mint"><ShieldCheck size={11}/> LOCAL</span></div>
        <input className="visually-hidden" type="file" accept=".pdf,application/pdf" ref={input} onChange={(event: ChangeEvent<HTMLInputElement>) => { void attach(event.target.files?.[0]); event.target.value = ''; }} />
        {!file ? <div className={`upload-zone ai-upload ${dragging ? 'dragging' : ''}`} role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') input.current?.click(); }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><span className="upload-icon">{reading ? <LoaderCircle size={25} className="spin"/> : <Upload size={25}/>}</span><strong>{reading ? 'Extracting text…' : 'Drop a PDF to understand it'}</strong><p>or <span>choose a file from your device</span></p><small>PDF · 25 MB maximum · first 100 pages</small></div>
          : <div className="ai-file"><div className="ai-file-icon"><FileText size={25}/></div><div className="ai-file-meta"><strong title={file.name}>{file.name}</strong><span>{pageCount} pages · {wordCount.toLocaleString()} extracted words</span></div><button onClick={clear} aria-label="Remove PDF"><X size={18}/></button></div>}
        {(truncated || sample.sampled) && <div className="ai-warning"><CircleHelp size={15}/><span>{truncated ? 'Only the first 100 pages were read. ' : ''}{sample.sampled ? 'Summary and key points use sampled excerpts from across the document, not every passage.' : ''}</span></div>}
      </div>
      <div className="workspace-panel ai-panel"><div className="panel-heading"><div><h3>02 <span>Choose what to do</span></h3><p>One small language model powers all three actions.</p></div></div>
        <div className="ai-mode-grid">{MODES.map(action => { const Icon = action.icon; return <button key={action.id} disabled={running} className={`ai-mode ${mode === action.id ? 'selected' : ''}`} onClick={() => { setMode(action.id); setOutput(''); setError(''); setSourcePages([]); }}><Icon size={20}/><strong>{action.label}</strong><small>{action.desc}</small></button>; })}</div>
        {mode === 'ask' && <label className="ai-question">YOUR QUESTION<textarea rows={3} maxLength={280} placeholder="Example: What are the main conclusions of this report?" value={question} onChange={event => setQuestion(event.target.value)} disabled={running} /></label>}
        {error && <div className="error-message"><CircleHelp size={17}/><span>{error}</span></div>}
        {status && <div className="ai-progress" role="status"><LoaderCircle size={16} className="spin"/><span>{status}</span></div>}
        <div className="ai-action-row"><button className="primary-action" disabled={!file || running || reading} onClick={run}>{running ? 'AI is working…' : <><Sparkles size={18}/> {mode === 'summary' ? 'Summarize PDF' : mode === 'points' ? 'Generate key points' : 'Ask this PDF'} <ArrowRight size={17}/></>}</button>{running && <button className="outline-action" onClick={cancel}>Stop</button>}</div>
        <p className="process-footnote"><CloudOff size={14}/> Model files download from Hugging Face on first use; PDF text is processed locally and is not sent to an AI API.</p>
      </div>
      {output && <div className="workspace-panel ai-response"><div className="ai-response-heading"><span><Check size={17}/> AI result</span><div><button onClick={() => { void navigator.clipboard.writeText(output).then(() => setCopied(true)).catch(() => setError('Unable to copy. You can download the notes instead.')); }}>{copied ? <Check size={16}/> : <ClipboardCopy size={16}/>} {copied ? 'Copied' : 'Copy'}</button><button onClick={download}><Download size={16}/> Save .txt</button></div></div><p className="ai-output">{output}</p><div className="ai-source"><FileText size={14}/> Excerpts from page{sourcePages.length === 1 ? '' : 's'} {sourcePages.join(', ') || '—'}. AI results may be inaccurate; verify important details in the PDF.</div></div>}
    </div>
    <div className="ai-right"><div className="workspace-panel ai-panel ai-preview"><div className="panel-heading"><div><h3>Document preview</h3><p>Your PDF stays on your device.</p></div></div>{file ? <PdfPreview file={file} compact/> : <div className="ai-preview-empty"><FileText size={46}/><strong>No document selected</strong><p>Choose a PDF to see the first page.</p></div>}</div>
      <div className="ai-model-note"><span><RefreshCcw size={18}/></span><div><strong>Small AI, real limits</strong><p>FLAN-T5 Small runs on your CPU. Its first download is substantial; inference may be slow on phones. It works best for short, English, selectable-text documents. It cannot read scanned images without OCR.</p></div></div>
    </div></div>
  </section>;
}
