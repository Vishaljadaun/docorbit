import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ClipboardCopy, Cloud, Download, FileText,
  Lightbulb, LoaderCircle, MessageCircleQuestion, ShieldCheck, Sparkles,
  Upload, X, AlertCircle, ScanText,
} from 'lucide-react';
import PdfPreview from './PdfPreview';
import { extractPdfText } from '../lib/ai/pdfText';
import { makePassages, relevantPassages, samplePassages } from '../lib/ai/document';
import type { DocumentPage } from '../lib/ai/document';
import { quickInsight } from '../lib/ai/quickInsight';
import { requestCloudInsight } from '../lib/ai/cloud';

const MODES = [
  { id: 'summary', label: 'Summarize', desc: 'A clear overview of the document', icon: ScanText },
  { id: 'points', label: 'Key points', desc: 'Find the important details', icon: Lightbulb },
  { id: 'ask', label: 'Ask PDF', desc: 'Find answers in your document', icon: MessageCircleQuestion },
] as const;
type Mode = typeof MODES[number]['id'];
type Engine = 'instant' | 'cloud';
type ChatTurn = { role: 'user' | 'assistant'; content: string };
type Props = { onBack: () => void; onResult: (mode: Mode) => void };

export default function AiStudio({ onBack, onResult }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [mode, setMode] = useState<Mode>('summary');
  const [engine, setEngine] = useState<Engine>('instant');
  const [style, setStyle] = useState<'brief'|'detailed'|'bullets'>('brief');
  const [consent, setConsent] = useState(false);
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [sourcePages, setSourcePages] = useState<number[]>([]);
  const [copied, setCopied] = useState(false);
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  const passages = useMemo(() => makePassages(pages), [pages]);
  const sampled = useMemo(() => samplePassages(passages, 5), [passages]);
  const wordCount = useMemo(() => pages.reduce((n,p) => n + (p.text.match(/\S+/g)?.length || 0), 0), [pages]);

  useEffect(() => () => { controller.current?.abort(); version.current += 1; }, []);

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setStatus('');
  }

  async function attach(selected?: File) {
    if (!selected) return;
    cancel();
    const current = ++version.current;
    setFile(null); setPages([]); setPageCount(0); setHistory([]);
    setOutput(''); setError(''); setSourcePages([]); setCopied(false); setTruncated(false);
    if (!/\.pdf$/i.test(selected.name)) { setError('Please choose a PDF document.'); return; }
    setReading(true);
    setStatus('Reading your PDF...');
    try {
      const result = await extractPdfText(selected, message => { if(current === version.current) setStatus(message); });
      if(current !== version.current) return;
      if (result.pages.reduce((sum,p) => sum + p.text.trim().length, 0) < 80) {
        throw new Error('Not enough selectable text was found. Scanned PDFs will require OCR, which is not available yet.');
      }
      setFile(selected); setPages(result.pages); setPageCount(result.pageCount); setTruncated(result.truncated);
    } catch(cause) {
      if(current === version.current) setError(cause instanceof Error ? cause.message : 'Unable to read this PDF.');
    } finally {
      if(current === version.current) { setReading(false); setStatus(''); }
    }
  }

  async function run() {
    if(!file || !passages.length || reading || running) return;
    setOutput(''); setError(''); setCopied(false); setSourcePages([]);
    if(mode === 'ask' && question.trim().length < 4) {
      setError('Enter a question of at least four characters.'); return;
    }
    const chosen = mode === 'ask' ? relevantPassages(passages, question, 3) : sampled.passages;
    if(!chosen.length) { setError('No matching passage found. Try other keywords.'); return; }

    if(engine === 'instant') {
      const answer = quickInsight(passages, mode, question.trim());
      setOutput(answer.output); setSourcePages(answer.sourcePages);
      onResult(mode);
      return;
    }
    if(!consent) {
      setError('Please agree to send selected text excerpts to our AI provider.'); return;
    }
    const pending = new AbortController();
    controller.current = pending;
    setRunning(true); setStatus('Preparing your answer...');
    const current = version.current;
    try {
      const result = await requestCloudInsight({
        kind: mode,
        style,
        question: mode === 'ask' ? question.trim() : undefined,
        contexts: chosen.slice(0,7).map(p=>({ page:p.page,text:p.text.slice(0,1200) })),
        history: mode === 'ask' ? history.slice(-4) : [],
      }, pending.signal);
      if(pending.signal.aborted || current !== version.current) return;
      setOutput(result.answer);
      setSourcePages(result.consultedPages ?? [...new Set(chosen.map(p=>p.page))]);
      if(mode === 'ask') {
        setHistory(previous => [...previous,
          {role:'user' as const,content:question.trim()},
          {role:'assistant' as const,content:result.answer},
        ].slice(-6));
      }
      onResult(mode);
    } catch(cause) {
      if(!pending.signal.aborted && current === version.current) {
        setError(cause instanceof Error ? cause.message : 'AI is unavailable. Try Instant mode.');
      }
    } finally {
      if(controller.current === pending) { controller.current = null; setRunning(false); setStatus(''); }
    }
  }

  function clear() {
    cancel(); ++version.current;
    setFile(null); setPages([]); setPageCount(0); setTruncated(false); setHistory([]);
    setOutput(''); setError(''); setStatus(''); setReading(false); setSourcePages([]); setConsent(false);
  }

  function download() {
    if(!output) return;
    const text = 'DocOrbit — ' + MODES.find(item => item.id === mode)?.label
      + '\nSource: ' + (file?.name || 'PDF')
      + '\nExcerpts consulted: ' + (sourcePages.join(', ') || 'none')
      + '\nMode: ' + (engine === 'instant' ? 'Extractive' : 'Cloud AI')
      + '\n\n' + output + '\n\nCheck important details against the original file.';
    const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url; link.download = 'docorbit-notes.txt'; link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),15000);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); void attach(event.dataTransfer.files[0]);
  }

  return <section className="ai-page doc-ai">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17}/> Back to tools</button>
    <div className="ai-hero">
      <div className="ai-hero-title"><span className="ai-hero-glyph"><FileText size={24}/></span><span className="ai-feature-pill">DOCUMENT INTELLIGENCE</span></div>
      <h1>Get more from your <span>PDF.</span></h1>
      <p>Read less, understand more. Summarize a document, pick out important details, or ask a question.</p>
      <div className="ai-hero-chips"><span><ShieldCheck size={14}/> Private local option</span><span><Check size={14}/> No signup</span><span><Sparkles size={14}/> AI when you need it</span></div>
    </div>
    <div className="ai-layout">
      <div className="ai-left">
        <div className="workspace-panel ai-panel">
          <div className="panel-heading"><div><h3>01 <span>Your document</span></h3><p>Choose a PDF with selectable text.</p></div></div>
          <input className="visually-hidden" type="file" accept=".pdf,application/pdf" ref={fileInput}
            onChange={(event:ChangeEvent<HTMLInputElement>)=>{void attach(event.target.files?.[0]);event.target.value='';}} />
          {!file ? <div className={'upload-zone ai-upload '+(dragging?'dragging':'')} role="button" tabIndex={0}
              onClick={()=>fileInput.current?.click()}
              onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();fileInput.current?.click();}}}
              onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={drop}>
              <span className="upload-icon">{reading?<LoaderCircle size={24} className="spin"/>:<Upload size={24}/>}</span>
              <strong>{reading?'Reading PDF...':'Drop your PDF here'}</strong>
              <p>or <span>browse your files</span></p>
              <small>Up to 25 MB · first 100 pages · selectable text</small>
            </div> : <div className="ai-file">
              <div className="ai-file-icon"><FileText size={23}/></div>
              <div className="ai-file-meta"><strong title={file.name}>{file.name}</strong><span>{pageCount} pages · {wordCount.toLocaleString()} words</span></div>
              <button onClick={clear} aria-label="Remove PDF"><X size={18}/></button>
            </div>}
          {(truncated||sampled.sampled) && <p className="ai-warning">
            {truncated?'Only the first 100 pages were read. ':''}
            {sampled.sampled?'Summaries use selected excerpts, not the complete document.':''}
          </p>}
        </div>
        <div className="workspace-panel ai-panel">
          <div className="panel-heading"><div><h3>02 <span>What would you like to do?</span></h3><p>Pick one way to explore this document.</p></div></div>
          <div className="ai-mode-grid">{MODES.map(action=>{
            const Icon=action.icon;
            return <button key={action.id} className={'ai-mode '+(mode===action.id?'selected':'')}
              disabled={running} onClick={()=>{setMode(action.id);setOutput('');setError('');setSourcePages([]);}}>
              <Icon size={20}/><strong>{action.label}</strong><small>{action.desc}</small>
            </button>;
          })}</div>
          <div className="engine-picker">
            <div className="engine-picker-title"><span>Processing mode</span><small>Choose what works for you</small></div>
            <div className="engine-options">
              <button className={engine==='instant'?'active':''} disabled={running}
                onClick={()=>{setEngine('instant');setError('');setOutput('');}}>
                <span><ScanText size={17}/> Instant</span><small>On-device · extractive · no download</small>
              </button>
              <button className={engine==='cloud'?'active':''} disabled={running}
                onClick={()=>{setEngine('cloud');setError('');setOutput('');}}>
                <span><Cloud size={17}/> Cloud AI</span><small>Generated answers · limited free usage</small>
              </button>
            </div>
            <p className="engine-note">{engine==='instant'
              ? 'Instant uses sentences from your document. It is not a generative AI summary.'
              : 'Cloud AI sends a few selected excerpts to the AI provider. Your original PDF is not uploaded.'}</p>
            {engine==='cloud' && <label className="consent-line">
              <input type="checkbox" checked={consent} disabled={running} onChange={e=>setConsent(e.target.checked)}/>
              <span>I agree to share selected document text and my question with the AI service.</span>
            </label>}
          </div>
          {mode==='summary' && engine==='cloud' && <div className="summary-styles">
            <span>Summary length</span>
            <div className="segmented">{(['brief','detailed','bullets'] as const).map(option=>
              <button key={option} className={style===option?'chosen':''} disabled={running} onClick={()=>setStyle(option)}>{option}</button>)}</div>
          </div>}
          {mode==='ask' && <label className="ai-question">YOUR QUESTION
            <textarea rows={3} maxLength={280} placeholder="What are the main conclusions?" value={question}
              disabled={running} onChange={e=>setQuestion(e.target.value)}/>
          </label>}
          {error && <div className="error-message" role="alert"><AlertCircle size={17}/><span>{error}</span></div>}
          {status && <div className="ai-progress" role="status"><LoaderCircle size={16} className="spin"/><span>{status}</span></div>}
          <div className="ai-action-row">
            <button className="primary-action" disabled={!file||running||reading} onClick={()=>void run()}>
              {running?<><LoaderCircle size={17} className="spin"/> Working...</>:<>
                <Sparkles size={17}/>{mode==='summary'?'Summarize PDF':mode==='points'?'Find key points':'Ask this PDF'}<ArrowRight size={17}/></>}
            </button>
            {running&&<button className="outline-action" onClick={cancel}>Cancel</button>}
          </div>
        </div>
        {output && <div className="workspace-panel ai-response">
          <div className="ai-response-heading"><span><Check size={17}/> Your result</span>
            <div><button onClick={()=>void navigator.clipboard.writeText(output).then(()=>setCopied(true)).catch(()=>setError('Copy failed. Use Save instead.'))}>
                {copied?<Check size={16}/>:<ClipboardCopy size={16}/>} {copied?'Copied':'Copy'}</button>
              <button onClick={download}><Download size={16}/> Save .txt</button></div>
          </div>
          <p className="ai-output">{output}</p>
          <div className="ai-source"><FileText size={14}/> Excerpts consulted: page{sourcePages.length===1?'':'s'} {sourcePages.join(', ')||'—'}. These are not verified citations for every claim; check the PDF.</div>
        </div>}
      </div>
      <div className="ai-right">
        <div className="workspace-panel ai-panel ai-preview">
          <div className="panel-heading"><div><h3>Document preview</h3><p>See what you're working with.</p></div></div>
          {file?<PdfPreview file={file} compact/>:<div className="ai-preview-empty">
            <FileText size={42}/><strong>No document selected</strong><p>Upload a PDF to see a preview here.</p>
          </div>}
        </div>
        <div className="ai-model-note"><span><ShieldCheck size={19}/></span>
          <div><strong>You control what gets shared</strong>
            <p>Instant mode stays in your browser. Cloud AI sends selected text excerpts only after you give permission. Please avoid sensitive documents.</p>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
