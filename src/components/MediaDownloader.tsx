import {useState} from 'react';
import type {FormEvent} from 'react';
import {ArrowLeft,CheckCircle2,Clapperboard,Download,ExternalLink,Info,Link2,LoaderCircle,ShieldCheck} from 'lucide-react';
import {classifyMediaLink,configuredMediaApi} from '../lib/mediaLinks';
import type {MediaPlatform} from '../lib/mediaLinks';

// The API is a media-only service; no PDF, OCR or AI tools call this endpoint.
const API_BASE=configuredMediaApi(import.meta.env.VITE_MEDIA_API_BASE || 'https://docorbit-media.onrender.com');

type MediaResult={
  status:'ready'|'picker';
  url?:string;
  filename?:string;
  expiresIn?:number;
  items?:{type:string;url:string}[];
};
type Downloadable={url:string;label:string};

const guidance:Record<MediaPlatform,{desc:string;help:string}>={
  YouTube:{desc:'Videos and Shorts',help:'For videos you own, YouTube Studio offers an official download option.'},
  Instagram:{desc:'Reels, videos and photos',help:'Some creators enable downloads directly through Instagram.'},
  X:{desc:'Public video posts',help:'Where available, the original post may have a Download video option.'},
  Threads:{desc:'Public media posts',help:'Open the original post to review the available share and download options.'},
};
const platforms:MediaPlatform[]=['YouTube','Instagram','X','Threads'];

async function requestMedia(url:string):Promise<MediaResult>{
  if(!API_BASE)throw new Error('Media processing is not available.');
  const res=await fetch(API_BASE+'/api/media/download',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({url,quality:'best'}),
  });
  const data:unknown=await res.json().catch(()=>null);
  if(!res.ok){
    const message=data && typeof data==='object' && 'detail' in data && typeof data.detail==='string'
      ?data.detail:'This media could not be downloaded right now.';
    throw new Error(message);
  }
  if(!data || typeof data!=='object' || !('status' in data))throw new Error('The media service returned an invalid response.');
  return data as MediaResult;
}

function safeDownloadUrl(value:string|undefined):string|null{
  if(!value)return null;
  if(/^\/api\/media\/file\/[A-Za-z0-9_-]{12,}$/.test(value))return API_BASE+value;
  try{
    const link=new URL(value);
    if(link.protocol!=='https:' || link.username || link.password)return null;
    return link.href;
  }catch{return null;}
}

export default function MediaDownloader({onBack}:{onBack:()=>void}){
  const [url,setUrl]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [downloads,setDownloads]=useState<Downloadable[]>([]);
  const platform=classifyMediaLink(url);

  function change(value:string){setUrl(value);setError('');setDownloads([]);}

  async function startDownload(e:FormEvent){
    e.preventDefault();
    if(!platform){setError('Paste an individual supported public media post URL.');return;}
    if(busy)return;
    setBusy(true);setError('');setDownloads([]);
    try{
      const result=await requestMedia(url.trim());
      if(result.status==='ready'){
        const href=safeDownloadUrl(result.url);
        if(!href)throw new Error('The download service did not return a usable file link.');
        const label=result.filename||'Download media';
        setDownloads([{url:href,label}]);
        // Use navigation rather than a popup: browsers may block new windows
        // opened after an asynchronous request. Cobalt tunnels and our own
        // temporary files provide download response headers.
        window.location.assign(href);
      }else if(result.status==='picker'){
        const available=(result.items||[]).slice(0,10).flatMap((item,index)=>{
          const href=safeDownloadUrl(item.url);
          return href?[{url:href,label:'Download '+(item.type||'media')+' '+(index+1)}]:[];
        });
        if(!available.length)throw new Error('No usable download links were returned for this post.');
        setDownloads(available);
      }else{
        throw new Error('This post could not be downloaded.');
      }
    }catch(e){
      setError(e instanceof Error?e.message:'The download could not be completed.');
    }finally{
      setBusy(false);
    }
  }

  return <section className="workspace-page media-workspace">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17}/> Home <span>/</span> Video Downloader</button>
    <div className="media-head">
      <div className="workspace-big-icon media-head-icon"><Clapperboard size={27}/></div>
      <div>
        <div className="eyebrow">MEDIA TOOLS · PUBLIC LINKS</div>
        <h1>Video Downloader</h1>
        <p>Paste a public post link to save available videos or images to your device, where downloading is permitted.</p>
      </div>
    </div>
    <div className="media-platforms">
      {platforms.map(name=><div key={name} className={'media-platform '+(platform===name?'media-platform-active':'')}>
        <strong>{name==='X'?'X (Twitter)':name}</strong><span>{guidance[name].desc}</span>
      </div>)}
    </div>
    <section className="workspace-panel media-panel">
      <div className="panel-heading">
        <div><h3>Download media</h3><p>Paste one post URL. DocOrbit selects an available download method automatically.</p></div>
        <span className="tag tag-mint"><ShieldCheck size={11}/> PUBLIC</span>
      </div>
      <form className="media-input-form" onSubmit={e=>void startDownload(e)}>
        <label htmlFor="media-url">POST URL</label>
        <div className="media-input">
          <Link2 size={18}/>
          <input id="media-url" type="url" required autoComplete="off" value={url} onChange={e=>change(e.target.value)} placeholder="https://www.instagram.com/reel/…"/>
        </div>
        <div className="media-input-actions">
          {platform&&<span className="media-platform-detected"><CheckCircle2 size={15}/> {platform} link recognized</span>}
          <button type="submit" className="primary-action" disabled={!API_BASE||!platform||busy}>
            {busy?<><LoaderCircle className="spin" size={17}/> Preparing download…</>:<><Download size={17}/> Download</>}
          </button>
        </div>
      </form>
      {error&&<div className="media-service-notice" role="alert">
        <Info size={19}/>
        <div><strong>Download unavailable</strong><p>{error}</p><p>Public posts may still require authentication or restrict access from hosted services.</p></div>
      </div>}
      {downloads.length>0&&<div className="media-ready" role="status">
        <CheckCircle2 size={20}/>
        <div>
          <strong>{downloads.length>1?'Select a media file':'Download ready'}</strong>
          <p>{downloads.length===1?'If your download did not start automatically, use the link below.':'This post contains multiple items. Choose the file you want to save.'}</p>
          {downloads.map((item,index)=><a key={index} className="media-download-link" href={item.url} rel="noopener noreferrer">
            <Download size={17}/>{item.label}
          </a>)}
        </div>
      </div>}
      {platform&&<div className="media-native-help">
        <div><strong>Original post</strong><p>{guidance[platform].help}</p></div>
        <a href={url.trim()} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/> Open post</a>
      </div>}
      <div className="media-disclaimer">
        <Info size={16}/>
        <p>Download only content you own or have permission to save. Private posts, paywalls, DRM, and some public media cannot be retrieved.</p>
      </div>
    </section>
  </section>;
}
