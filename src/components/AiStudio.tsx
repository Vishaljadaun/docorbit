import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  ArrowLeft, ArrowRight, Bot, Check, CircleHelp, ClipboardCopy, CloudOff,
  Download, FileText, Lightbulb, LoaderCircle, MessageCircleQuestion,
  RefreshCcw, ShieldCheck, Sparkles, Upload, X,
} from 'lucide-react';
import PdfPreview from './PdfPreview';
import { extractPdfText } from '../lib/ai/pdfText';
import { makePassages, relevantPassages, balancedPassages, combineDocuments, sourceLabel, checkModelCitations, retrieveQuestionPassages } from '../lib/ai/document';
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
  const [documents,setDocuments]=useState<{file:File;pages:DocumentPage[];pageCount:number;truncated:boolean}[]>([]);
  const [previewIndex,setPreviewIndex]=useState(0);
  const combined=useMemo(()=>combineDocuments(documents.map(d=>({name:d.file.name,pages:d.pages}))),[documents]);
  const pages=combined.pages;
  const sources=combined.sources;
  const file=documents[previewIndex]?.file??null;
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
  const [evidence,setEvidence]=useState<{page:number;text:string}[]>([]);
  const [citationWarning,setCitationWarning]=useState('');
  const [copied, setCopied] = useState(false);
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const passages = useMemo(() => makePassages(pages), [pages]);
  const sample = useMemo(() => balancedPassages(passages,sources,7), [passages,sources]);

  useEffect(() => () => { cloudController.current?.abort(); ++version.current; }, []);

  async function attach(selected: File[]) {
    if(!selected.length||reading)return;
    if(documents.length+selected.length>5){setError('Select up to five PDFs.');return;}
    const current=++version.current;
    cancel();setError('');setOutput('');setSourcePages([]);setEvidence([]);setCitationWarning('');setChatHistory([]);setCopied(false);setReading(true);
    try {
      const next:typeof documents=[];
      for(const file of selected){
        if(!/\.pdf$/i.test(file.name))throw new Error('Only PDF files are supported.');
        if(file.size>25*1024*1024)throw new Error('PDFs must be 25 MB or smaller.');
        if(documents.some(d=>d.file.name===file.name)||next.some(d=>d.file.name===file.name))throw new Error('Duplicate PDF filename.');
        setStatus('Reading '+file.name+'…');
        const result=await extractPdfText(file,msg=>{if(current===version.current)setStatus(msg);});
        if(current!==version.current)return;
        if(result.pages.reduce((n,p)=>n+p.text.trim().length,0)<80)throw new Error('Not enough selectable text in '+file.name);
        next.push({file,pages:result.pages,pageCount:result.pageCount,truncated:result.truncated});
      }
      setDocuments(old=>[...old,...next]);
    }catch(cause){if(current===version.current)setError(cause instanceof Error?cause.message:'Cannot read PDFs.');}
    finally{if(current===version.current){setReading(false);setStatus('');}}
  }
  function removeDocument(index:number){
    cancel();++version.current;setDocuments(old=>old.filter((_,i)=>i!==index));
    setPreviewIndex(0);setChatHistory([]);setOutput('');setSourcePages([]);setEvidence([]);setCitationWarning('');setError('');
  }

  function cancel() {
    cloudController.current?.abort();
    cloudController.current = null;
    setRunning(false); setStatus('');
  }

  function run() {
    if (!file || !pages.length || running || reading) return;
    setOutput(''); setError(''); setSourcePages([]);setEvidence([]);setCitationWarning(''); setCopied(false);
    if (mode === 'ask') {
      if (question.trim().length < 4) { setError('Enter a specific question with at least 4 characters.'); return; }
      const matched = retrieveQuestionPassages(passages,sources,question,7);
      if (!matched.length) { setError('No relevant passages were found for that question. Try more specific keywords.'); return; }
      setSourcePages([...new Set(matched.map(p => p.page))]);
    } else {
      setSourcePages([...new Set(sample.passages.map(p => p.page))]);
    }
    if (engine === 'instant') {
      const insight = quickInsight(passages, mode, question.trim());
      setOutput(insight.output.replace(/Page (\d+):/g, (_match,id:string)=>sourceLabel(sources,Number(id))+':'));
      setSourcePages(insight.sourcePages);
      setEvidence(passages.filter(p=>insight.sourcePages.includes(p.page)).slice(0,7));
      onResult(mode);
      return;
    }
    if (engine === 'cloud') {
      let gatewayUrl: URL;
      try {
        gatewayUrl = new URL(gateway.trim());
        if (gatewayUrl.protocol !== 'https:' || gatewayUrl.username || gatewayUrl.password || gatewayUrl.search || gatewayUrl.hash || gatewayUrl.pathname !== '/') throw Error();
      } catch { setError('Enter a valid HTTPS Cloudflare Worker base URL ending in / (no path, query or credentials).'); return; }
      const references = (mode === 'ask' ? retrieveQuestionPassages(passages,sources,question,7) : sample.passages).slice(0, 7);
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
          const consulted=references.map(p=>p.page);
          const checked=checkModelCitations(data.answer,sources,consulted);
          setOutput(checked.answer);setSourcePages(checked.citedPages);setEvidence(references.map(p=>({page:p.page,text:p.text})));
          setCitationWarning(checked.rejectedCount?'Some page references were not in the supplied excerpts and have been marked unverified.':!checked.hasPageCitations?'The model did not cite page numbers. Review the supporting excerpts below.':'Page references identify excerpts supplied to the model; they do not verify factual claims.');
          if (mode === 'ask') setChatHistory(old => [...old, {role:'user' as const,content:question.trim()}, {role:'assistant' as const,content:data.answer!}].slice(-6));
          onResult(mode);
        })
        .catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Cloud AI request failed.');})
        .finally(() => { if (cloudController.current===controller){cloudController.current=null;setRunning(false);setStatus('');} });
      return;
    }

  }

  function download() {
    if (!output) return;
    const text = `DocOrbit AI Studio — ${MODES.find(m => m.id === mode)?.label}\nSources: ${documents.map(d=>d.file.name).join(', ')}\nExcerpts: ${sourcePages.map(p=>sourceLabel(sources,p)).join(', ')}\n\n${output}\n\nAI-generated; verify against the original document.`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'docorbit-ai-notes.txt'; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }

  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void attach(Array.from(event.dataTransfer.files)); }
  return <section className="ai-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17}/> Workspace <span>/</span> AI Studio</button>
    <div className="ai-hero"><div className="ai-hero-title"><span className="ai-hero-glyph"><Bot size={25}/></span><span className="ai-feature-pill"><Sparkles size={12}/> PDF DOCUMENT ASSISTANT</span></div><h1>Make sense of your <span>PDF.</span></h1><p>Summarize and ask questions across multiple documents.</p><div className="ai-hero-chips"><span><ShieldCheck size={14}/> No API key</span><span><CloudOff size={14}/> Your PDF stays on your device</span><span><Check size={14}/> Free model</span></div></div>

    <div className="ai-layout"><div className="ai-left">
      <div className="workspace-panel ai-panel"><div className="panel-heading"><div><h3>01 <span>Choose your PDFs</span></h3><p>Ask questions across up to five text-based PDFs.</p></div><span className="tag tag-mint"><ShieldCheck size={11}/> LOCAL</span></div>
        <input className="visually-hidden" type="file" accept=".pdf,application/pdf" multiple ref={input} onChange={(event:ChangeEvent<HTMLInputElement>)=>{void attach(Array.from(event.target.files||[]));event.target.value='';}}/>
        <div className={`upload-zone ai-upload ${dragging?'dragging':''}`} role="button" tabIndex={0} onClick={()=>input.current?.click()}
          onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();input.current?.click();}}}
          onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={drop}>
          <span className="upload-icon">{reading?<LoaderCircle size={25} className="spin"/>:<Upload size={25}/>}</span>
          <strong>{reading?'Reading PDFs…':documents.length?'Add another PDF':'Choose one or more PDFs'}</strong>
          <p>Drop files or <span>browse from your device</span></p><small>Up to 5 PDFs · 25 MB each · text-based documents</small>
        </div>
        {documents.length>0&&<div className="ai-document-list">{documents.map((doc,i)=><div className={`ai-file ${previewIndex===i?'active':''}`} key={doc.file.name}>
          <button className="ai-document-choice" onClick={()=>setPreviewIndex(i)} aria-label={`Preview ${doc.file.name}`}><FileText size={19}/><span><strong>{doc.file.name}</strong><small>{doc.pageCount} pages</small></span></button>
          <button aria-label={`Remove ${doc.file.name}`} onClick={()=>removeDocument(i)}><X size={17}/></button>
        </div>)}</div>}
        {(documents.some(d=>d.truncated)||sample.sampled)&&<div className="ai-warning"><CircleHelp size={15}/><span>Answers use selected excerpts, not every page. The first 100 pages of each PDF are read.</span></div>}
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
      {output && <div className="workspace-panel ai-response"><div className="ai-response-heading"><span><Check size={17}/> AI result</span><div><button onClick={() => { void navigator.clipboard.writeText(output).then(() => setCopied(true)).catch(() => setError('Unable to copy. You can download the notes instead.')); }}>{copied ? <Check size={16}/> : <ClipboardCopy size={16}/>} {copied ? 'Copied' : 'Copy'}</button><button onClick={download}><Download size={16}/> Save .txt</button></div></div><p className="ai-output">{output}</p><div className="ai-source"><FileText size={14}/> Source excerpts: {sourcePages.map(p=>sourceLabel(sources,p)).join('; ')||'—'}. AI responses may contain errors; verify important details in the PDF.</div>{citationWarning&&<p className="ai-citation-warning">{citationWarning}</p>}{evidence.length>0&&<details className="ai-evidence"><summary>Review supporting excerpts ({evidence.length})</summary>{evidence.map((p,i)=><div className="ai-evidence-item" key={i}><strong>{sourceLabel(sources,p.page)}</strong><p>{p.text.slice(0,850)}</p></div>)}</details>}</div>}
    </div>
    <div className="ai-right"><div className="workspace-panel ai-panel ai-preview"><div className="panel-heading"><div><h3>Document preview</h3><p>Your original PDFs stay on your device.</p></div></div>{file ? <PdfPreview file={file} compact/> : <div className="ai-preview-empty"><FileText size={46}/><strong>No document selected</strong><p>Choose a PDF to see the first page.</p></div>}</div>
      <div className="ai-model-note"><span><RefreshCcw size={18}/></span><div><strong>Private where possible</strong><p>PDF tools and Instant insights work locally. Cloud AI sends selected document excerpts when you request an AI result. Scanned PDFs require OCR, which is not supported yet.</p></div></div>
    </div></div>
  </section>;
}
