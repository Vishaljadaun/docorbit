import {useState} from 'react';
import type {FormEvent} from 'react';
import {ArrowLeft,ArrowUpRight,CheckCircle2,Clapperboard,Download,ExternalLink,Info,Link2,LoaderCircle,ShieldCheck} from 'lucide-react';
import {classifyMediaLink,configuredMediaApi,availableDownloadQualities} from '../lib/mediaLinks';
import type {MediaPlatform} from '../lib/mediaLinks';

// Dedicated public media service. The address is not a credential.
const API_BASE=configuredMediaApi(import.meta.env.VITE_MEDIA_API_BASE || 'https://docorbit-media.onrender.com');
type Inspection={platform:MediaPlatform;title:string;duration:number;resolutions:number[];bestAvailable:number|null};
type FileReady={filePath:string;fileName:string;size:number;expiresIn:number};
type Quality='best'|'1080'|'720'|'480';

const guidance:Record<MediaPlatform,{desc:string;help:string}>={
  YouTube:{desc:'Videos and Shorts',help:'For your own uploads, use YouTube Studio → Content → Download. Other downloads follow YouTube’s authorized options.'},
  Instagram:{desc:'Reels and video posts',help:'For permitted public Reels, choose Share → Download in Instagram. Creators can disable downloads.'},
  X:{desc:'Public video posts',help:'Where enabled by the creator and your subscription, choose Download video from the post menu.'},
  Threads:{desc:'Public video posts',help:'Open the post and use any official options for sharing or downloading.'},
};
const platforms:MediaPlatform[]=['YouTube','Instagram','X','Threads'];

async function api<T>(path:string,body:unknown):Promise<T>{
  if(!API_BASE)throw Error('Media processing is not configured.');
  const res=await fetch(API_BASE+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(typeof data.detail==='string'?data.detail:'Provider did not complete this request.');
  return data as T;
}
function duration(seconds:number){return seconds?Math.floor(seconds/60)+'m '+String(seconds%60).padStart(2,'0')+'s':'Unknown length';}

export default function MediaDownloader({onBack}:{onBack:()=>void}){
  const [url,setUrl]=useState(''),[quality,setQuality]=useState<Quality>('best');
  const [inspection,setInspection]=useState<Inspection|null>(null);
  const [ready,setReady]=useState<FileReady|null>(null);
  const [busy,setBusy]=useState<'inspect'|'prepare'|null>(null);
  const [error,setError]=useState('');
  const platform=classifyMediaLink(url);
  const readyPath=ready && /^\/api\/media\/file\/[A-Za-z0-9_-]{12,}$/.test(ready.filePath);
  function change(next:string){setUrl(next);setInspection(null);setReady(null);setError('');setQuality('best');}
  async function inspect(e:FormEvent){
    e.preventDefault();
    if(!platform){setError('Paste a public video post link from YouTube, Instagram, X or Threads.');return;}
    setBusy('inspect');setInspection(null);setReady(null);setError('');
    try{setInspection(await api<Inspection>('/api/media/inspect',{url:url.trim()}));}
    catch(e){setError(e instanceof Error?e.message:'Cannot inspect the post.');}
    finally{setBusy(null);}
  }
  async function prepare(){
    if(!inspection||!API_BASE)return;
    setBusy('prepare');setReady(null);setError('');
    try{
      const result=await api<FileReady>('/api/media/prepare',{url:url.trim(),quality});
      if(!/^\/api\/media\/file\/[A-Za-z0-9_-]{12,}$/.test(result.filePath))throw Error('Invalid temporary download link.');
      setReady(result);
    }catch(e){setError(e instanceof Error?e.message:'Could not prepare video.');}
    finally{setBusy(null);}
  }
  const qualities:[Quality,string][]=[['best','Best available · up to 1080p'],['1080','Up to 1080p'],['720','Up to 720p'],['480','Up to 480p']];
  return <section className="workspace-page media-workspace">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17}/> Home <span>/</span> Video Downloader</button>
    <div className="media-head"><div className="workspace-big-icon media-head-icon"><Clapperboard size={27}/></div>
      <div><div className="eyebrow">MEDIA TOOLS · PUBLIC LINKS ONLY</div><h1>Video Downloader</h1>
        <p>Paste a public video URL and save available media up to Full HD, where downloads are permitted.</p></div></div>
    <div className="media-platforms">{platforms.map(name=><div key={name} className={'media-platform '+(platform===name?'media-platform-active':'')}>
      <strong>{name==='X'?'X (Twitter)':name}</strong><span>{guidance[name].desc}</span></div>)}</div>
    <section className="workspace-panel media-panel">
      <div className="panel-heading"><div><h3>01 <span>Paste a public video link</span></h3><p>Individual public video posts only. Protected content and playlists aren't supported.</p></div><span className="tag tag-mint"><ShieldCheck size={11}/> PUBLIC</span></div>
      <form className="media-input-form" onSubmit={e=>void inspect(e)}>
        <label htmlFor="media-url">VIDEO POST URL</label>
        <div className="media-input"><Link2 size={18}/><input id="media-url" type="url" required autoComplete="off" value={url} onChange={e=>change(e.target.value)} placeholder="https://www.youtube.com/watch?v=..."/></div>
        <div className="media-input-actions">{platform&&<span className="media-platform-detected"><CheckCircle2 size={15}/> {platform} link recognized</span>}
          <button type="submit" className="primary-action" disabled={!API_BASE||!platform||busy!==null}>
            {busy==='inspect'?<><LoaderCircle className="spin" size={16}/> Checking…</>:<><ArrowUpRight size={17}/> Check available quality</>}
          </button>
        </div>
      </form>
      {!API_BASE&&<div className="media-service-notice" role="status"><Info size={19}/><div><strong>Media processing has not been activated yet.</strong>
        <p>Media extraction needs the separate FFmpeg-powered server. Its code is ready, but downloads will become available only after that server is deployed and connected.</p></div></div>}
      {platform&&<div className="media-native-help"><div><strong>Official option for {platform}</strong><p>{guidance[platform].help}</p></div>
        <a href={url.trim()} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/> Open original post</a></div>}
      {error&&<p className="error-message" role="alert">{error}</p>}
      {inspection&&<div className="media-inspection">
        <div className="media-inspection-heading"><CheckCircle2 size={19}/><div><strong>{inspection.title}</strong>
          <small>{inspection.platform} · {duration(inspection.duration)} · {inspection.bestAvailable?'Up to '+inspection.bestAvailable+'p reported':'Quality varies'}</small></div></div>
        <label htmlFor="media-quality">VIDEO QUALITY</label>
        <select id="media-quality" value={quality} onChange={e=>{setQuality(e.target.value as Quality);setReady(null);}} disabled={busy!==null} className="range-input">
          {qualities.filter(([value])=>availableDownloadQualities(inspection.resolutions).includes(value)).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
        <p className="media-quality-hint">Resolution is limited to what the source provides. Audio and video may need server-side merging.</p>
        <button type="button" className="primary-action" onClick={()=>void prepare()} disabled={busy!==null}>
          {busy==='prepare'?<><LoaderCircle className="spin" size={17}/> Preparing video…</>:<><Download size={17}/> Prepare download</>}
        </button>
      </div>}
      {ready&&readyPath&&<div className="media-ready" role="status"><CheckCircle2 size={20}/><div><strong>Video ready · {(ready.size/1048576).toFixed(1)} MB</strong>
        <p>One-time download link. Expires in 10 minutes.</p>
        <a className="media-download-link" href={API_BASE+ready.filePath}><Download size={17}/> Download {ready.fileName}</a></div></div>}
      <div className="media-disclaimer"><Info size={16}/><p>Public links can still be subject to creator rights and platform terms. Download only where permitted. Access controls, private accounts, DRM and paywalls are not bypassed; some public links may not be retrievable.</p></div>
    </section>
  </section>;
}
