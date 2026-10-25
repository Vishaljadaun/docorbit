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
import { quickInsight } from '../lib/ai/quickInsight';

const MODES = [
  { id: 'summary', label: 'Summarize', desc: 'A concise document overview', icon: Sparkles },
  { id: 'points', label: 'Key points', desc: 'The main ideas at a glance', icon: Lightbulb },
  { id: 'ask', label: 'Ask PDF', desc: 'Ask a question about its content', icon: MessageCircleQuestion },
] as const;
type Mode = typeof MODES[number]['id'];

type Props = { onBack: () => void; onResult: (mode: Mode) => void };

export default function AiStudio({ onBack, onResult }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [mode, setMode] = useState<Mode>('summary');
  const [engine, setEngine] = useState<'instant' | 'cloud'>('instant');
  const gateway = 'https://' + ['docorbit','vksthakur445','workers','dev'].join('.') + '/';
  const [style, setStyle] = useState<'brief' | 'detailed' | 'bullets'>('brief');
  const [chatHistory, setChatHistory] = useState<{role:'user'|'assistant';content:string}[]>([]);
  const cloudController = useRef<AbortController | null>(null);
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
  const version = useRef(0);
  const passages = useMemo(() => makePassages(pages), [pages]);
  const sample = useMemo(() => samplePassages(passages, 5), [passages]);
  const wordCount = useMemo(() => pages.reduce((total, page) => total + (page.text.match(/\S+/g)?.length ?? 0), 0), [pages]);

  useEffect(() => () => { cloudController.current?.abort(); ++version.current; }, []);

  async function attach(selected: File | undefined) {
    if (!selected) return;
    const current = ++version.current;
    // Cancel any model run from the previous PDF before replacing the document.
    if (running) cancel();
    setChatHistory([]);
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
    cloudController.current?.abort();
    cloudController.current = null;
    setRunning(false); setStatus('');
  }

  function run() {
    if (!file || !pages.length || running || reading) return;
    setOutput(''); setError(''); setSourcePages([]); setCopied(false);
    if (mode === 'ask') {
      if (question.trim().length < 4) { setError('Enter a specific question with at least 4 characters.'); return; }
      const matched = relevantPassages(passages, question, 2);
      if (!matched.length) { setError('No relevant passages were found for that question. Try more specific keywords.'); return; }
      setSourcePages([...new Set(matched.map(p => p.page))]);
    } else {
      setSourcePages([...new Set(sample.passages.map(p => p.page))]);
    }
    if (engine === 'instant') {
      const insight = quickInsight(passages, mode, question.trim());
      setOutput(insight.output);
      setSourcePages(insight.sourcePages);
      onResult(mode);
      return;
    }
    if (engine === 'cloud') {
      let gatewayUrl: URL;
      try {
        gatewayUrl = new URL(gateway.trim());
        if (gatewayUrl.protocol !== 'https:' || gatewayUrl.username || gatewayUrl.password || gatewayUrl.search || gatewayUrl.hash || gatewayUrl.pathname !== '/') throw Error();
      } catch { setError('Enter a valid HTTPS Cloudflare Worker base URL ending in / (no path, query or credentials).'); return; }
      const references = (mode === 'ask' ? relevantPassages(passages, question, 3) : samplePassages(passages, 5).passages).slice(0, 7);
      if (!references.length) { setError('No matching document passages found. Try another question.'); return; }
      const body = {kind:mode, style, question:mode==='ask'?question.trim():undefined,
        contexts:references.map(p => ({page:p.page,text:p.text.slice(0,1200)})),
        history: mode === 'ask' ? chatHistory.slice(-4) : []};
      const controller = new AbortController(); cloudController.current=controller;
      setRunning(true); setStatus('Consulting the free cloud model…');
      void fetch(new URL('chat', gatewayUrl), {method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
        .then(async response => {
          const data: {answer?:string;error?:string;consultedPages?:number[]} = await response.json();
          if (!response.ok || !data.answer) throw new Error(data.error || 'Cloud AI request failed.');
          setOutput(data.answer); setSourcePages(data.consultedPages || references.map(p=>p.page));
          if (mode === 'ask') setChatHistory(old => [...old, {role:'user' as const,content:question.trim()}, {role:'assistant' as const,content:data.answer!}].slice(-6));
          onResult(mode);
        })
        .catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Cloud AI request failed.');})
        .finally(() => { if (cloudController.current===controller){cloudController.current=null;setRunning(false);setStatus('');} });
      return;
    }

  }

  function clear() {
    if (running) cancel();
    setChatHistory([]);
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
    <div className="ai-hero"><div className="ai-hero-title"><span className="ai-hero-glyph"><Bot size={25}/></span><span className="ai-feature-pill"><Sparkles size={12}/> PDF DOCUMENT ASSISTANT</span></div><h1>Make sense of your <span>PDF.</span></h1><p>Get a quick overview, find key points, or ask questions about a document.</p><div className="ai-hero-chips"><span><ShieldCheck size={14}/> No API key</span><span><CloudOff size={14}/> Your PDF stays on your device</span><span><Check size={14}/> Free model</span></div></div>

    <div className="ai-layout"><div className="ai-left">
      <div className="workspace-panel ai-panel"><div className="panel-heading"><div><h3>01 <span>Choose a document</span></h3><p>Text-based English PDFs work best.</p></div><span className="tag tag-mint"><ShieldCheck size={11}/> LOCAL</span></div>
        <input className="visually-hidden" type="file" accept=".pdf,application/pdf" ref={input} onChange={(event: ChangeEvent<HTMLInputElement>) => { void attach(event.target.files?.[0]); event.target.value = ''; }} />
        {!file ? <div className={`upload-zone ai-upload ${dragging ? 'dragging' : ''}`} role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') input.current?.click(); }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><span className="upload-icon">{reading ? <LoaderCircle size={25} className="spin"/> : <Upload size={25}/>}</span><strong>{reading ? 'Extracting text…' : 'Drop a PDF to understand it'}</strong><p>or <span>choose a file from your device</span></p><small>PDF · 25 MB maximum · first 100 pages</small></div>
          : <div className="ai-file"><div className="ai-file-icon"><FileText size={25}/></div><div className="ai-file-meta"><strong title={file.name}>{file.name}</strong><span>{pageCount} pages · {wordCount.toLocaleString()} extracted words</span></div><button onClick={clear} aria-label="Remove PDF"><X size={18}/></button></div>}
        {(truncated || sample.sampled) && <div className="ai-warning"><CircleHelp size={15}/><span>{truncated ? 'Only the first 100 pages were read. ' : ''}{sample.sampled ? 'Summary and key points use sampled excerpts from across the document, not every passage.' : ''}</span></div>}
      </div>
      <div className="workspace-panel ai-panel"><div className="panel-heading"><div><h3>02 <span>Choose what to do</span></h3><p>Choose how you want to work with your document.</p></div></div>
        <div className="ai-mode-grid">{MODES.map(action => { const Icon = action.icon; return <button key={action.id} disabled={running} className={`ai-mode ${mode === action.id ? 'selected' : ''}`} onClick={() => { setMode(action.id); setOutput(''); setError(''); setSourcePages([]); }}><Icon size={20}/><strong>{action.label}</strong><small>{action.desc}</small></button>; })}</div>
        <div className="ai-warning" style={{ display: 'block', marginBottom: 14 }}>
          <strong>Processing mode</strong>
          <div className="segmented ai-engine-switch" style={{ marginTop: 10 }} role="group" aria-label="Processing mode">
            <button className={engine === 'instant' ? 'chosen' : ''} disabled={running} onClick={() => { setEngine('instant'); setOutput(''); setError(''); }}>Instant · no download</button>
            <button className={engine === 'cloud' ? 'chosen' : ''} disabled={running} onClick={() => { setEngine('cloud'); setOutput(''); setError(''); }}>Cloud AI</button>
          </div>
          <p style={{ marginTop: 8 }}>{engine === 'instant' ? 'Fast, extractive results using actual sentences from your PDF. This is NOT generative AI.' : 'Cloud AI sends selected PDF text excerpts and your question to an AI provider when you click the action below. Your original PDF stays in your browser.'}</p>
        </div>
        {engine === 'cloud' && <div className="ai-question" style={{marginBottom:16}}>
          {mode === 'summary' && <div className="segmented" style={{marginTop:12}}>{(['brief','detailed','bullets'] as const).map(option=><button key={option} className={style===option?'chosen':''} onClick={()=>setStyle(option)}>{option}</button>)}</div>}
        </div>}
        {mode === 'ask' && <label className="ai-question">YOUR QUESTION<textarea rows={3} maxLength={280} placeholder="Example: What are the main conclusions of this report?" value={question} onChange={event => setQuestion(event.target.value)} disabled={running} /></label>}
        {error && <div className="error-message"><CircleHelp size={17}/><span>{error}</span></div>}
        {status && <div className="ai-progress" role="status"><LoaderCircle size={16} className="spin"/><span>{status}</span></div>}
        <div className="ai-action-row"><button className="primary-action" disabled={!file || running || reading} onClick={run}>{running ? 'AI is working…' : <><Sparkles size={18}/> {mode === 'summary' ? (engine === 'cloud' ? 'Summarize with Cloud AI' : 'Summarize PDF') : mode === 'points' ? 'Generate key points' : 'Ask this PDF'} <ArrowRight size={17}/></>}</button>{running && <button className="outline-action" onClick={cancel}>Stop</button>}</div>
        <p className="process-footnote"><CloudOff size={14}/> Instant mode stays on your device. Cloud AI sends selected text excerpts to the provider when you request an answer. Avoid sensitive PDFs.</p>
      </div>
      {output && <div className="workspace-panel ai-response"><div className="ai-response-heading"><span><Check size={17}/> AI result</span><div><button onClick={() => { void navigator.clipboard.writeText(output).then(() => setCopied(true)).catch(() => setError('Unable to copy. You can download the notes instead.')); }}>{copied ? <Check size={16}/> : <ClipboardCopy size={16}/>} {copied ? 'Copied' : 'Copy'}</button><button onClick={download}><Download size={16}/> Save .txt</button></div></div><p className="ai-output">{output}</p><div className="ai-source"><FileText size={14}/> Excerpts from page{sourcePages.length === 1 ? '' : 's'} {sourcePages.join(', ') || '—'}. AI responses may contain errors; verify important details in the PDF.</div></div>}
    </div>
    <div className="ai-right"><div className="workspace-panel ai-panel ai-preview"><div className="panel-heading"><div><h3>Document preview</h3><p>Your PDF stays on your device.</p></div></div>{file ? <PdfPreview file={file} compact/> : <div className="ai-preview-empty"><FileText size={46}/><strong>No document selected</strong><p>Choose a PDF to see the first page.</p></div>}</div>
      <div className="ai-model-note"><span><RefreshCcw size={18}/></span><div><strong>Private where possible</strong><p>PDF tools and Instant insights work locally. Cloud AI sends selected document excerpts when you request an AI result. Scanned PDFs require OCR, which is not supported yet.</p></div></div>
    </div></div>
  </section>;
}
