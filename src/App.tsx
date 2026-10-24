import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight,
  BadgeCheck, BookOpen, Check, CheckCheck, CircleHelp, Clock3,
  CloudOff, Download, FileImage, FilePlus2, FileStack, FileText,
  FolderOpen, GripVertical, Heart, Image, LayoutGrid, Layers3, Lightbulb, Lock,
  Menu, Moon, RotateCw, Scissors, Search, Settings2,
  ShieldCheck, Sparkles, Sun, Trash2, Upload, WandSparkles, X, Zap,
} from 'lucide-react';
import PdfPreview from './components/PdfPreview';
import AiStudio from './components/AiStudio';
import { downloadOutput, isImage, processFiles, readPageCount, validateFiles } from './lib/pdf';
import type { OutputFile, ToolId } from './lib/pdf';
import { prettyBytes } from './lib/pages';

type View = 'overview' | 'all-tools' | 'favorites' | 'recent' | 'ai-studio' | 'roadmap' | 'settings';
type Category = 'All tools' | 'Organize' | 'Edit' | 'Convert';
type Tool = {
  id: ToolId; title: string; summary: string; icon: LucideIcon;
  color: 'violet' | 'blue' | 'orange' | 'mint' | 'pink' | 'yellow';
  category: Exclude<Category, 'All tools'>; badge?: string;
};
type ActivityEntry = { id: string; tool: string; date: string; count: number };

const TOOLS: Tool[] = [
  { id: 'merge', title: 'Merge PDF', summary: 'Combine multiple PDFs into one perfectly organized document.', icon: FileStack, color: 'violet', category: 'Organize', badge: 'POPULAR' },
  { id: 'split', title: 'Split PDF', summary: 'Separate a PDF into smaller, individual files by page range.', icon: Scissors, color: 'orange', category: 'Organize' },
  { id: 'rotate', title: 'Rotate PDF', summary: 'Turn pages clockwise while keeping the content intact.', icon: RotateCw, color: 'blue', category: 'Edit' },
  { id: 'reorder', title: 'Reorder pages', summary: 'Drag pages into the exact order you want them.', icon: Layers3, color: 'mint', category: 'Organize', badge: 'NEW' },
  { id: 'extract', title: 'Extract pages', summary: 'Take only the pages you need from a document.', icon: FilePlus2, color: 'pink', category: 'Organize' },
  { id: 'images', title: 'Images to PDF', summary: 'Convert JPG or PNG images into a clean, multi-page PDF.', icon: FileImage, color: 'yellow', category: 'Convert' },
];
const ROADMAP = [
  { title: 'v0.1 · Core essentials', body: 'Beautiful dashboard, six real PDF tools, in-browser file processing, previews and downloads.', status: 'Ready' },
  { title: 'v0.2 · Local AI Studio', body: 'On-device PDF summarization, key-point extraction and document Q&A using FLAN-T5 Small.', status: 'Ready (beta)' },
  { title: 'v0.3 · PDF editor', body: 'Add signatures, text overlays, annotations, page numbering and watermarks.', status: 'Planned' },
  { title: 'v0.4 · Conversion studio', body: 'Office converters, PDF compression, PDF-to-image and more robust workflows.', status: 'Planned' },
  { title: 'v0.5 · Security & OCR', body: 'OCR, password workflows, real irreversible redaction and document comparison.', status: 'Planned' },
  { title: 'v0.6 · Advanced AI', body: 'OCR and more accurate larger-model options, optional provider API integration with user consent.', status: 'Planned' },
];
const NAV_MAIN: { id: View; title: string; icon: LucideIcon }[] = [
  { id: 'overview', title: 'Overview', icon: LayoutGrid },
  { id: 'all-tools', title: 'All tools', icon: FolderOpen },
  { id: 'favorites', title: 'Favorites', icon: Heart },
  { id: 'recent', title: 'Recent activity', icon: Clock3 },
  { id: 'ai-studio', title: 'AI Studio', icon: Sparkles },
];
const NAV_OTHER: { id: View; title: string; icon: LucideIcon }[] = [
  { id: 'roadmap', title: 'Roadmap', icon: BookOpen },
  { id: 'settings', title: 'Preferences', icon: Settings2 },
];

function useStoredState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const stored = localStorage.getItem(key); return stored ? JSON.parse(stored) as T : initial; }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage optional */ } }, [key, value]);
  return [value, setValue];
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><span className="brand-planet" /><span className="brand-satellite" /></span><span className="brand-word">doc<span>orbit</span><span className="brand-dot">.</span></span></div>;
}

function Tag({ children, color = 'subtle' }: { children: ReactNode; color?: string }) {
  return <span className={`tag tag-${color}`}>{children}</span>;
}

function ToolCard({ tool, isFavorite, onOpen, onFavorite }: { tool: Tool; isFavorite: boolean; onOpen: () => void; onFavorite: () => void }) {
  const Icon = tool.icon;
  return <article className="tool-card" onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }} role="button" tabIndex={0} aria-label={`Open ${tool.title}`}>
    <div className="tool-card-top"><span className={`tool-icon icon-${tool.color}`}><Icon size={23} strokeWidth={1.8} /></span><button type="button" className={`favorite ${isFavorite ? 'active' : ''}`} onClick={e => { e.stopPropagation(); onFavorite(); }} aria-label={isFavorite ? `Unfavorite ${tool.title}` : `Favorite ${tool.title}`}><Heart size={17} fill={isFavorite ? 'currentColor' : 'none'} /></button></div>
    <div className="tool-card-copy"><div className="tool-title-line"><h3>{tool.title}</h3>{tool.badge && <span className="micro-badge">{tool.badge}</span>}</div><p>{tool.summary}</p></div>
    <div className="tool-card-bottom"><span>{tool.category}</span><span className="card-arrow"><ArrowUpRight size={18} /></span></div>
  </article>;
}

function Sidebar({ view, navigate, open, dismiss, theme, toggleTheme }: { view: View; navigate: (view: View) => void; open: boolean; dismiss: () => void; theme: 'dark' | 'light'; toggleTheme: () => void }) {
  function item(item: { id: View; title: string; icon: LucideIcon }) {
    const Icon = item.icon;
    return <button key={item.id} className={`nav-item ${view === item.id ? 'selected' : ''}`} onClick={() => { navigate(item.id); dismiss(); }}><Icon size={18} strokeWidth={1.75} /><span>{item.title}</span>{view === item.id && <span className="nav-indicator" />}</button>;
  }
  return <><div className={`mobile-scrim ${open ? 'show' : ''}`} onClick={dismiss} /><aside className={`sidebar ${open ? 'is-open' : ''}`}>
    <div className="sidebar-logo"><Brand /><button className="mobile-close" onClick={dismiss} aria-label="Close navigation"><X size={20}/></button></div>
    <div className="sidebar-content"><span className="nav-caption">WORKSPACE</span><nav>{NAV_MAIN.map(item)}</nav><span className="nav-caption nav-caption-later">EXPLORE</span><nav>{NAV_OTHER.map(item)}</nav>
      <div className="sidebar-note"><span className="note-icon"><ShieldCheck size={19} /></span><strong>Private by design.</strong><p>Your files stay on your device. Nothing is uploaded.</p><span className="note-online"><span />LOCAL PROCESSING</span></div>
    </div>
    <div className="sidebar-footer"><button className="sidebar-theme" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}<span>{theme === 'dark' ? 'Light appearance' : 'Dark appearance'}</span><ArrowRight size={16}/></button><div className="sidebar-version"><span>DOCORBIT STUDIO</span><span>v0.2.0</span></div></div>
  </aside></>;
}

function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={30} strokeWidth={1.4} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function Workspace({ tool, onBack, onFinished }: { tool: Tool; onBack: () => void; onFinished: (tool: Tool, count: number) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [range, setRange] = useState('1');
  const [rotation, setRotation] = useState<90 | 180 | 270>(90);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [dragPage, setDragPage] = useState<number | null>(null);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileVersion = useRef(0);
  const isMulti = tool.id === 'merge' || tool.id === 'images';
  const Icon = tool.icon;

  async function attach(added: File[]) {
    if (!added.length) return;
    const version = ++fileVersion.current;
    setError(''); setOutputs([]);
    const list = isMulti ? [...files, ...added] : [added[0]];
    try {
      await validateFiles(list, tool.id);
      if (version !== fileVersion.current) return;
      let count = 0;
      if (!isMulti) count = await readPageCount(list[0]);
      if (version !== fileVersion.current) return;
      setFiles(list);
      setPageCount(count);
      setPageOrder(Array.from({ length: count }, (_, i) => i));
      setRange(tool.id === 'split' ? `1-${count}` : `1${count > 1 ? `-${Math.min(count, 2)}` : ''}`);
    } catch (cause) { if (version === fileVersion.current) setError(cause instanceof Error ? cause.message : 'Unable to open this file.'); }
  }
  function drop(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setDragging(false); void attach(Array.from(e.dataTransfer.files)); }
  function moveFile(index: number, direction: number) {
    const next = [...files]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setFiles(next); setOutputs([]);
  }
  function removeFile(index: number) {
    ++fileVersion.current;
    const next = files.filter((_, i) => i !== index);
    setFiles(next); setOutputs([]); setError('');
    if (!next.length) { setPageCount(0); setPageOrder([]); }
  }
  function movePage(sourceIndex: number, targetIndex: number) {
    if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0 || targetIndex >= pageOrder.length) return;
    const next = [...pageOrder]; const [value] = next.splice(sourceIndex, 1); next.splice(targetIndex, 0, value);
    setPageOrder(next); setOutputs([]);
  }
  async function start() {
    setBusy(true); setOutputs([]); setError('');
    try {
      const finished = await processFiles(tool.id, files, { ranges: range, rotation, pageOrder });
      setOutputs(finished);
      onFinished(tool, finished.length);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Processing failed. Try a different file.'); }
    finally { setBusy(false); }
  }
  const canProcess = files.length >= (tool.id === 'merge' ? 2 : 1) && !busy;
  const accept = tool.id === 'images' ? '.png,.jpg,.jpeg,image/png,image/jpeg' : '.pdf,application/pdf';
  return <section className="workspace-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17}/> All tools <span>/</span> {tool.title}</button>
    <div className="workspace-heading"><div className={`workspace-big-icon icon-${tool.color}`}><Icon size={28} /></div><div><div className="eyebrow">PDF WORKSPACE <span className="eyebrow-dot">•</span> 100% IN YOUR BROWSER</div><h1>{tool.title}</h1><p>{tool.summary}</p></div></div>
    <div className="workspace-grid"><div className="workspace-left">
      <div className="workspace-panel"><div className="panel-heading"><div><h3>01 <span>Upload your {tool.id === 'images' ? 'images' : 'documents'}</span></h3><p>{isMulti ? 'Add multiple files in the order you want.' : 'Start by selecting a PDF from your device.'}</p></div><Tag color="mint"><Lock size={11}/> PRIVATE</Tag></div>
        <input ref={fileInput} className="visually-hidden" type="file" accept={accept} multiple={isMulti} onChange={(e: ChangeEvent<HTMLInputElement>) => { void attach(Array.from(e.target.files || [])); e.target.value = ''; }} aria-label="Choose files to process" />
        <div className={`upload-zone ${dragging ? 'dragging' : ''} ${files.length ? 'smaller' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={drop} onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}>
          <span className="upload-icon"><Upload size={25} strokeWidth={1.6}/></span><strong>{files.length ? 'Add more files' : 'Drop your files here'}</strong><p>or <span>browse from your device</span></p><small>{tool.id === 'images' ? 'JPG or PNG' : 'PDF files'} · Up to 50 MB each · 120 MB total</small>
        </div>
        {files.length > 0 && <div className="file-stack"><div className="file-stack-title"><span>SELECTED FILES <b>{files.length}</b></span><button onClick={() => { ++fileVersion.current; setFiles([]); setPageCount(0); setPageOrder([]); setOutputs([]); setError(''); }}>Clear all</button></div>{files.map((file, i) => <div className="selected-file" key={`${file.name}-${file.size}-${i}`}><span className="selected-file-icon">{isImage(file) ? <Image size={18}/> : <FileText size={18}/>}</span><div className="file-info"><strong title={file.name}>{file.name}</strong><span>{prettyBytes(file.size)}{!isMulti && pageCount > 0 ? ` · ${pageCount} page${pageCount === 1 ? '' : 's'}` : ''}</span></div>{isMulti && <div className="move-buttons"><button aria-label={`Move ${file.name} up`} disabled={i === 0} onClick={() => moveFile(i, -1)}><ArrowUp size={14}/></button><button aria-label={`Move ${file.name} down`} disabled={i === files.length - 1} onClick={() => moveFile(i, 1)}><ArrowDown size={14}/></button></div>}<button className="remove-file" aria-label={`Remove ${file.name}`} onClick={() => removeFile(i)}><X size={17}/></button></div>)}</div>}
      </div>
      <div className="workspace-panel options-panel"><div className="panel-heading"><div><h3>02 <span>Configure & process</span></h3><p>Fine-tune your settings before exporting.</p></div></div>
        {tool.id === 'merge' && <div className="options-info"><GripVertical size={17}/> Use the arrows beside your files to arrange merge order.</div>}
        {tool.id === 'images' && <div className="options-info"><Image size={17}/> Images are scaled to fit A4 pages without cropping.</div>}
        {tool.id === 'rotate' && <div className="option-field"><label>ROTATION ANGLE</label><div className="segmented">{([90, 180, 270] as const).map(angle => <button key={angle} onClick={() => { setRotation(angle); setOutputs([]); }} className={rotation === angle ? 'chosen' : ''}>{angle}°</button>)}</div><small>Applies to every page, relative to its existing orientation.</small></div>}
        {(tool.id === 'split' || tool.id === 'extract') && <div className="option-field"><label htmlFor="ranges">{tool.id === 'split' ? 'SPLIT INTO SEPARATE RANGES' : 'PAGES TO EXTRACT'}</label><input id="ranges" className="range-input" type="text" placeholder={tool.id === 'split' ? '1-3, 4-6, 7' : '1-3, 5'} value={range} onChange={e => { setRange(e.target.value); setOutputs([]); }}/><small>{tool.id === 'split' ? 'Each comma-separated range creates its own PDF.' : 'Use commas and ranges to select pages; duplicates are ignored.'}</small></div>}
        {tool.id === 'reorder' && (pageCount > 0 ? <div className="order-control"><label>DRAG TO CHANGE THE PAGE ORDER</label><div className="page-order">{pageOrder.map((num, i) => <button className={`order-chip ${selectedPage === i ? 'picked' : ''}`} key={num} draggable onDragStart={() => setDragPage(i)} onDragEnd={() => setDragPage(null)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragPage !== null) movePage(dragPage, i); setDragPage(null); setSelectedPage(null); }} onClick={() => { if (selectedPage === null) setSelectedPage(i); else { movePage(selectedPage, i); setSelectedPage(null); } }} aria-pressed={selectedPage === i} aria-label={`Page ${num + 1}, position ${i + 1}`}><GripVertical size={15}/><span>{num + 1}</span></button>)}</div><small>Drag tiles, or tap a page then its destination to reorder. Original file stays unchanged.</small></div> : <div className="options-info">Upload a PDF to reorder its pages.</div>)}
        {error && <div className="error-message"><CircleHelp size={16}/><span>{error}</span></div>}
        <button className="primary-action" disabled={!canProcess} onClick={() => void start()}>{busy ? <><span className="button-loader"/> Processing locally…</> : <><WandSparkles size={18}/> {tool.id === 'merge' ? 'Merge PDFs' : tool.id === 'images' ? 'Create PDF' : tool.id === 'split' ? 'Split PDF' : tool.id === 'extract' ? 'Extract pages' : tool.id === 'reorder' ? 'Reorder pages' : 'Rotate PDF'} <ArrowRight size={17}/></>}</button>
        <p className="process-footnote"><ShieldCheck size={14}/> All processing happens on your device. No uploads, no accounts.</p>
      </div>
      {outputs.length > 0 && <div className="workspace-panel completed-panel"><div className="completed-heading"><span className="completed-check"><Check size={19}/></span><div><h3>Your {outputs.length === 1 ? 'file is' : 'files are'} ready!</h3><p>Processed successfully in your browser.</p></div></div><div className="output-list">{outputs.map((output, i) => <div className="output-row" key={`${output.name}-${i}`}><FileText size={20}/><div><strong>{output.name}</strong><small>{prettyBytes(output.bytes.byteLength)}</small></div><button onClick={() => downloadOutput(output)} aria-label={`Download ${output.name}`}><Download size={17}/> <span>Download</span></button></div>)}</div></div>}
    </div><aside className="workspace-right"><div className="preview-panel"><div className="preview-header"><div><span className="eyebrow">DOCUMENT PREVIEW</span><h3>First page</h3></div><span className="preview-led"/></div>{files.length && tool.id !== 'images' ? <PdfPreview file={files[0]}/> : files.length && tool.id === 'images' ? <ImagePreview file={files[0]}/> : <div className="empty-preview"><div className="ghost-paper"><div className="ghost-line wide"/><div className="ghost-line"/><div className="ghost-line wide"/><div className="ghost-box"/><div className="ghost-line"/><div className="ghost-line short"/></div><strong>Nothing to preview yet</strong><p>Your document preview will appear here once you add a file.</p></div>}</div>
      <div className="privacy-card"><span className="privacy-icon"><CloudOff size={21}/></span><div><h4>Designed for privacy</h4><p>Your files are processed right in your browser. They never reach our servers.</p></div></div>
      <div className="tip-card"><Lightbulb size={17}/><span><b>Pro tip</b><br/>{isMulti ? 'Use the arrow controls to fine-tune file order before processing.' : 'Your original file is never modified. Download the new PDF when it is ready.'}</span></div>
    </aside></div>
  </section>;
}

function ImagePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return <div className="image-preview">{url && <img src={url} alt={`Preview of ${file.name}`}/>}</div>;
}

export default function App() {
  const [view, setView] = useState<View>('overview');
  const [toolId, setToolId] = useState<ToolId | null>(null);
  const [category, setCategory] = useState<Category>('All tools');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useStoredState<ToolId[]>('docorbit:favorites', []);
  const [history, setHistory] = useStoredState<ActivityEntry[]>('docorbit:recent', []);
  const [theme, setTheme] = useStoredState<'dark' | 'light'>('docorbit:theme', 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const currentTool = TOOLS.find(tool => tool.id === toolId);
  const visibleTools = useMemo(() => TOOLS.filter(tool => {
    const matchesCategory = category === 'All tools' || category === tool.category;
    const matchesSearch = `${tool.title} ${tool.summary} ${tool.category}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesCategory && matchesSearch && (view !== 'favorites' || favorites.includes(tool.id));
  }), [category, search, view, favorites]);
  function navigate(next: View) { setView(next); setToolId(null); setSearch(''); setCategory('All tools'); window.scrollTo(0, 0); }
  function openTool(id: ToolId) { setToolId(id); window.scrollTo(0, 0); }
  function favorite(id: ToolId) { setFavorites(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]); }
  function finish(tool: Tool, count: number) {
    setHistory(prev => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, tool: tool.title, count, date: new Date().toISOString() }, ...prev].slice(0, 30));
  }
  function finishAi(mode: 'summary' | 'points' | 'ask') {
    const label = mode === 'summary' ? 'AI PDF summary' : mode === 'points' ? 'AI key points' : 'AI PDF Q&A';
    setHistory(prev => [{ id: `${Date.now()}-ai`, tool: label, count: 0, date: new Date().toISOString() }, ...prev].slice(0, 30));
  }
  const toolList = (view === 'overview' || view === 'all-tools' || view === 'favorites');
  return <div className="shell"><Sidebar view={view} navigate={navigate} open={sidebarOpen} dismiss={() => setSidebarOpen(false)} theme={theme} toggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} />
    <main className="main-area"><header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={22}/></button><span className="topbar-path">Workspace</span><span className="path-divider">/</span><b>{currentTool ? currentTool.title : ({ overview: 'Overview', 'all-tools': 'All tools', favorites: 'Favorites', recent: 'Recent activity', roadmap: 'Roadmap', settings: 'Preferences', 'ai-studio': 'AI Studio' } as Record<View, string>)[view]}</b></div><div className="topbar-right"><span className="secure-pill"><span/> ALL SYSTEMS LOCAL</span><button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">{theme === 'dark' ? <Sun size={19}/> : <Moon size={19}/>}</button><div className="user-avatar" aria-label="Guest workspace">D</div></div></header>
      <div className="content-wrap">{currentTool ? <Workspace key={currentTool.id} tool={currentTool} onBack={() => { setToolId(null); setView('all-tools'); }} onFinished={finish}/> : view === 'ai-studio' ? <AiStudio onBack={() => navigate('overview')} onResult={finishAi}/> : <>
        {view === 'overview' && <><section className="hero"><div className="hero-pattern"/><div className="hero-copy"><div className="hero-pill"><Sparkles size={13}/> THE NEW WAY TO HANDLE DOCUMENTS <span>↗</span></div><h1>Every document.<br/><span>One beautiful workspace.</span></h1><p>Powerful PDF tools that respect your privacy. Merge, split, transform, and organize—all without uploading a single file.</p><div className="hero-actions"><button className="hero-action" onClick={() => navigate('all-tools')}>Explore all tools <ArrowUpRight size={18}/></button><button className="hero-ai-action" onClick={() => navigate('ai-studio')}><Sparkles size={17}/> Try AI Studio</button></div><div className="hero-assurance"><span><CheckCheck size={15}/> No signup</span><span><CheckCheck size={15}/> Free to use</span><span><CheckCheck size={15}/> Private by default</span></div></div><div className="hero-art" aria-hidden="true"><div className="art-halo halo-one"/><div className="art-halo halo-two"/><div className="art-card art-back"><div className="art-line"/><div className="art-line short"/><div className="art-chart"/></div><div className="art-card art-front"><div className="art-card-head"><span className="art-pdf">PDF</span><span className="art-dots">•••</span></div><div className="art-graphic"><div className="art-bars"><i/><i/><i/><i/><i/></div><span className="art-swish"/></div><div className="art-line"/><div className="art-line medium"/><div className="art-line short"/></div><span className="art-float float-secure"><Lock size={16}/></span><span className="art-float float-spark"><Sparkles size={19}/></span><span className="art-float float-files"><FileText size={17}/> AI + 06 TOOLS</span></div></section>
          <div className="stats-row"><div><span className="stat-icon purple"><LayoutGrid size={19}/></span><div><strong>06</strong><span>Ready-to-use tools</span></div></div><div><span className="stat-icon cyan"><ShieldCheck size={19}/></span><div><strong>100%</strong><span>Local PDF processing</span></div></div><div><span className="stat-icon peach"><Zap size={19}/></span><div><strong>₹0</strong><span>Subscription required</span></div></div></div>
        </>}
        {toolList && <section className="tools-section"><div className="section-bar"><div><div className="section-eyebrow">YOUR CREATIVE TOOLKIT</div><h2>{view === 'favorites' ? 'Your favorites' : view === 'overview' ? 'Popular tools' : 'All PDF tools'}<span className="heading-spark">✦</span></h2><p>{view === 'favorites' ? 'Your go-to PDF tools, one click away.' : 'Everything you need to work smarter with your documents.'}</p></div>{view === 'overview' && <button className="text-link" onClick={() => navigate('all-tools')}>View all tools <ArrowRight size={17}/></button>}</div>
          <div className="filter-bar"><div className="filter-tabs">{(['All tools', 'Organize', 'Edit', 'Convert'] as Category[]).map(c => <button key={c} className={c === category ? 'active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div><label className="search-field"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tools..." aria-label="Search tools" />{search && <button aria-label="Clear search" onClick={() => setSearch('')}><X size={15}/></button>}</label></div>
          {visibleTools.length ? <div className="tool-grid">{visibleTools.map(tool => <ToolCard key={tool.id} tool={tool} isFavorite={favorites.includes(tool.id)} onOpen={() => openTool(tool.id)} onFavorite={() => favorite(tool.id)} />)}</div> : <EmptyState icon={view === 'favorites' ? Heart : Search} title={view === 'favorites' ? 'No favorites yet' : 'No tools found'} description={view === 'favorites' ? 'Tap the heart on any tool to save it here.' : 'Try searching for another feature or clearing your category filter.'} action={<button className="outline-action" onClick={() => { if (view === 'favorites') navigate('all-tools'); else { setSearch(''); setCategory('All tools'); } }}>Browse all tools <ArrowRight size={15}/></button>} />}
        </section>}
        {view === 'overview' && <section className="bottom-banner"><div className="banner-symbol"><ShieldCheck size={26}/></div><div><h3>What happens to your files? Absolutely nothing.</h3><p>Your PDFs never leave your device. Every tool runs securely inside your browser—no cloud uploads and no hidden file storage.</p></div><button onClick={() => navigate('settings')}>How privacy works <ArrowRight size={17}/></button></section>}
        {view === 'recent' && <section className="plain-section"><div className="section-eyebrow">ON THIS DEVICE</div><div className="section-bar"><div><h1>Recent activity</h1><p>Only tool names and output counts are stored locally. No document content is saved.</p></div>{history.length > 0 && <button className="outline-action" onClick={() => setHistory([])}><Trash2 size={16}/> Clear history</button>}</div>{history.length ? <div className="activity-table">{history.map(entry => <div className="activity-row" key={entry.id}><span className="activity-mark"><Activity size={19}/></span><div><strong>{entry.tool}</strong><small>{entry.count === 0 ? 'On-device AI response' : `${entry.count} PDF${entry.count > 1 ? 's' : ''} generated`}</small></div><time>{new Date(entry.date).toLocaleString()}</time><BadgeCheck size={17} className="activity-check"/></div>)}</div> : <EmptyState icon={Clock3} title="Your next creation starts here" description="Process a document and your tool activity will show up here." action={<button className="outline-action" onClick={() => navigate('all-tools')}>Explore tools <ArrowRight size={16}/></button>} />}</section>}
        {view === 'roadmap' && <section className="plain-section"><div className="section-eyebrow">BUILDING IN PUBLIC</div><h1>What's next for DocOrbit</h1><p className="section-subline">From six powerful essentials to a complete document workspace. Milestones are goals, not shipped features.</p><div className="roadmap-list">{ROADMAP.map((item, i) => <div className="roadmap-item" key={item.title}><div className={`roadmap-index ${i < 2 ? 'ready' : ''}`}>{i < 2 ? <Check size={20}/> : String(i + 1).padStart(2, '0')}</div><div><div className="roadmap-item-head"><h3>{item.title}</h3><Tag color={i < 2 ? 'mint' : 'subtle'}>{item.status}</Tag></div><p>{item.body}</p></div></div>)}</div></section>}
        {view === 'settings' && <section className="plain-section"><div className="section-eyebrow">WORKSPACE PREFERENCES</div><h1>Make it yours</h1><p className="section-subline">A few thoughtful settings. No account required.</p><div className="settings-list"><div className="setting-card"><span className="setting-symbol"><Moon size={20}/></span><div><h3>Appearance</h3><p>Choose the theme that feels right.</p></div><div className="setting-options"><button className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><Moon size={15}/> Dark</button><button className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><Sun size={15}/> Light</button></div></div><div className="setting-card"><span className="setting-symbol"><ShieldCheck size={20}/></span><div><h3>Local processing</h3><p>PDF content is processed in browser memory and is not uploaded. AI Studio downloads model weights from Hugging Face, but runs document inference locally.</p></div><Tag color="mint">ENABLED</Tag></div><div className="setting-card"><span className="setting-symbol"><Trash2 size={20}/></span><div><h3>Clear activity</h3><p>Delete locally saved tool names and output counts. File contents are not stored.</p></div><button className="outline-action" onClick={() => setHistory([])}>Clear history</button></div></div><div className="security-explainer"><CloudOff size={22}/><div><strong>Privacy note</strong><p>Files exist in browser memory while you use a tool; this app does not upload their contents. Local AI Studio downloads public model files separately. Do not assume an unmanaged or compromised device is secure. Browsers may retain downloaded files in their download folder.</p></div></div></section>}
      </>}
      <footer className="footer"><span>© 2026 DocOrbit. Crafted for better document days.</span><span><Lock size={12}/> Processed locally <span className="footer-separator">·</span> Built with React & TypeScript</span></footer>
      </div>
    </main>
  </div>;
}
