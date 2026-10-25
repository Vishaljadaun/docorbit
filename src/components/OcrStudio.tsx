import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Download,FileText,LoaderCircle,ScanText,Upload,X} from 'lucide-react';
import {isOcrInput,recognizeDocument} from '../lib/ocr';
import type {OcrResult} from '../lib/ocr';
import {ocrToText,ocrToCsv} from '../lib/ocrExport';
import {recognizeHandwriting} from '../lib/handwritingOcr';

export default function OcrStudio({onBack,onFinished}:{onBack:()=>void;onFinished:()=>void}){
  const [file,setFile]=useState<File|null>(null);
  const [range,setRange]=useState('all');
  const [recognitionMode,setRecognitionMode]=useState<'print'|'handwriting'>('print');
  const [editedText,setEditedText]=useState('');
  const [result,setResult]=useState<OcrResult|null>(null);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const version=useRef(0);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>()=>{controller.current?.abort();version.current++;},[]);
  function select(f?:File){
    if(!f)return;
    if(!isOcrInput(f)||f.size>25*1024*1024||!f.size){setError('Choose a PDF, JPG, PNG or WebP file under 25 MB.');return;}
    controller.current?.abort();version.current++;setFile(f);setResult(null);setEditedText('');setError('');setStatus('');
  }
  async function start(){
    if(!file||busy)return;
    const current=++version.current;
    const abort=new AbortController();controller.current=abort;
    setBusy(true);setResult(null);setError('');
    try{
      const recognize=recognitionMode==='handwriting'?recognizeHandwriting:recognizeDocument;
      const found=await recognize(file,{range,onProgress:m=>{if(current===version.current)setStatus(m);},signal:abort.signal});
      if(current!==version.current||abort.signal.aborted)return;
      setResult(found);setEditedText(ocrToText(found.pages));onFinished();
      if(!found.pages.some(p=>p.text.trim()))setError('No readable text recognized. Try a clearer scan.');
    }catch(e){if(current===version.current&&!abort.signal.aborted)setError(e instanceof Error?e.message:'OCR failed.');}
    finally{if(current===version.current){setBusy(false);setStatus('');controller.current=null;}}
  }
  function download(type:'txt'|'csv'){
    if(!result||!file)return;
    const text=type==='txt'?editedText:ocrToCsv([{page:1,text:editedText}]);
    const blob=new Blob([text],{type:type==='csv'?'text/csv;charset=utf-8':'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=file.name.replace(/\.[^.]+$/,'')+'-ocr.'+type;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  return <section className="workspace-page ocr-studio">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17}/> All tools <span>/</span> OCR</button>
    <div className="workspace-heading"><div className="workspace-big-icon icon-blue"><ScanText size={28}/></div><div><div className="eyebrow">DOCUMENT OCR · ON YOUR DEVICE</div><h1>Scan to Text</h1><p>Recognize English text from scanned PDFs and JPG, PNG or WebP images.</p></div></div>
    <div className="workspace-panel">
      <div className="panel-heading"><div><h3>01 <span>Select a scanned document</span></h3><p>Your file stays on your device. The OCR engine downloads once from a public CDN.</p></div></div>
      <input className="visually-hidden" ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={e=>{select(e.target.files?.[0]);e.target.value='';}}/>
      <div className="upload-zone ocr-drop" tabIndex={0} role="button" onClick={()=>input.current?.click()} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.current?.click();}}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();select(e.dataTransfer.files[0]);}}>
        <span className="upload-icon"><Upload size={24}/></span><strong>{file?file.name:'Drop a scanned PDF or image here'}</strong><p>or <span>choose a file</span></p><small>PDF / JPG / PNG / WebP · 25 MB maximum</small>
      </div>
      {file&&<div className="ocr-options"><div><label htmlFor="ocr-pages">PAGES TO RECOGNIZE</label><input id="ocr-pages" className="range-input" value={range} onChange={e=>{setRange(e.target.value);setResult(null);}} disabled={busy||!/\.pdf$/i.test(file.name)} placeholder="all or 1-3,5"/><small>Up to 12 PDF pages per job. "all" means the first 12 pages.</small></div><div className="ocr-recognition-mode"><label>RECOGNITION TYPE</label><div className="segmented ai-engine-switch"><button className={recognitionMode==='print'?'chosen':''} onClick={()=>{setRecognitionMode('print');setResult(null);}}>Printed text</button><button className={recognitionMode==='handwriting'?'chosen':''} onClick={()=>{setRecognitionMode('handwriting');setResult(null);}}>Handwriting (experimental)</button></div><small>{recognitionMode==='handwriting'?'Downloads a larger handwriting model. Supports images or up to 3 PDF pages; accuracy varies and review is essential.':'Best for clear printed text, up to 12 PDF pages.'}</small></div><div className="compress-warning"><FileText size={18}/><p>OCR recognizes text but does not reproduce tables, cell structure, fonts or layout. CSV contains one row per page and can be opened in Excel. English recognition only in this version.</p></div><button className="primary-action" disabled={busy} onClick={()=>void start()}>{busy?<><LoaderCircle size={18} className="spin"/> Recognizing…</>:<><ScanText size={18}/> Extract text</>}</button>{busy&&<button className="outline-action" onClick={()=>{controller.current?.abort();version.current++;setBusy(false);setStatus('');}}>Cancel OCR <X size={15}/></button>}</div>}
      {status&&<div className="ai-progress" role="status"><LoaderCircle className="spin" size={16}/>{status}</div>}
      {error&&<p className="error-message" role="alert">{error}</p>}
    </div>
    {result&&<div className="workspace-panel ocr-result"><div className="panel-heading"><div><h3>02 <span>Recognized text</span></h3><p>{result.pages.length} page(s) processed. Edit recognition mistakes below before downloading.</p></div></div><div className="ocr-downloads"><button className="outline-action" onClick={()=>download('txt')}><Download size={16}/> Download TXT</button><button className="outline-action" onClick={()=>download('csv')}><Download size={16}/> Download CSV for Excel</button></div><textarea className="ocr-text" rows={12} value={editedText} onChange={e=>setEditedText(e.target.value)} aria-label="Recognized text, editable"/><p className="process-footnote">Edit any recognition errors here before downloading. The original image is your reference.</p></div>}
  </section>;
}
