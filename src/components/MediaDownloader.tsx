import {useState} from 'react';
import type {FormEvent} from 'react';
import {ArrowLeft,CheckCircle2,Clapperboard,Download,ExternalLink,FileImage,FileVideo,ImageOff,Info,Link2,LoaderCircle,ShieldCheck} from 'lucide-react';
import {classifyMediaLink,configuredMediaApi} from '../lib/mediaLinks';
import type {MediaPlatform} from '../lib/mediaLinks';

// This isolated service is not used by the PDF, OCR or AI tools.
const API_BASE=configuredMediaApi(import.meta.env.VITE_MEDIA_API_BASE || 'https://docorbit-media.onrender.com');

type MediaKind='photo'|'video'|'file';
type MediaResult={
  status:'ready'|'picker';
  url?:string;
  previewUrl?:string|null;
  thumbnail?:string|null;
  mediaType?:string;
  filename?:string;
  expiresIn?:number;
  items?:{type?:string;url:string;thumbnail?:string|null;previewUrl?:string|null}[];
};
type PreviewItem={
  downloadUrl:string;
  previewUrl:string|null;
  thumbnail:string|null;
  kind:MediaKind;
  label:string;
};

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
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({url,quality:'best'}),
  });
  const data:unknown=await res.json().catch(()=>null);
  if(!res.ok){
    const message=data && typeof data==='object' && 'detail' in data && typeof data.detail==='string'
      ?data.detail:'This media could not be retrieved right now.';
    throw new Error(message);
  }
  if(!data || typeof data!=='object' || !('status' in data)){
    throw new Error('The media service returned an invalid response.');
  }
  return data as MediaResult;
}

function safeMediaUrl(value:string|undefined|null):string|null{
  if(!value)return null;
  if(/^\/api\/media\/(?:file|preview)\/[A-Za-z0-9_-]{12,}$/.test(value))return API_BASE+value;
  try{
    const link=new URL(value);
    if(link.protocol!=='https:' || link.username || link.password)return null;
    return link.href;
  }catch{return null;}
}

function mediaKind(type:string|undefined,url:string):MediaKind{
  const declared=(type||'').toLowerCase();
  if(declared==='photo'||declared==='image'||declared==='gif')return 'photo';
  if(declared==='video')return 'video';
  if(/\.(?:jpg|jpeg|png|webp|gif)(?:[?#]|$)/i.test(url))return 'photo';
  if(/\.(?:mp4|webm|mov|mkv)(?:[?#]|$)/i.test(url))return 'video';
  return 'file';
}

function mediaItems(result:MediaResult):PreviewItem[]{
  if(result.status==='ready'){
    const downloadUrl=safeMediaUrl(result.url);
    if(!downloadUrl)return [];
    const kind=mediaKind(result.mediaType||undefined,result.filename||result.url||'');
    return [{
      downloadUrl,
      previewUrl:kind==='file'?null:safeMediaUrl(result.previewUrl||result.url),
      thumbnail:safeMediaUrl(result.thumbnail),
      kind,
      label:result.filename||'Media file',
    }];
  }
  if(result.status==='picker'){
    return (result.items||[]).slice(0,10).flatMap((item,index)=>{
      const downloadUrl=safeMediaUrl(item.url);
      if(!downloadUrl)return [];
      const kind=mediaKind(item.type,item.url);
      const thumbnail=safeMediaUrl(item.thumbnail);
      const previewUrl=kind==='file'?null:safeMediaUrl(item.previewUrl||item.url);
      const description=kind==='photo'?'Photo':kind==='video'?'Video':'Media';
      return [{downloadUrl,previewUrl,thumbnail,kind,label:`${description} ${index+1}`}];
    });
  }
  return [];
}

function MediaPreviewCard({item,index}:{item:PreviewItem;index:number}){
  const [failed,setFailed]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const photoSource=item.thumbnail||item.previewUrl;
  const canPreview=item.kind==='photo'&&!!photoSource || item.kind==='video'&&!!item.previewUrl;
  return <article className="media-preview-card">
    <div className="media-preview-frame">
      {!failed&&item.kind==='photo'&&photoSource
        ?<img src={photoSource} alt={`Preview of ${item.label}`} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>
        :null}
      {!failed&&item.kind==='video'&&item.previewUrl
        ?<video controls playsInline preload="metadata" poster={item.thumbnail||undefined} src={item.previewUrl} onError={()=>setFailed(true)} aria-label={`Preview of ${item.label}`}/>
        :null}
      {(!canPreview||failed)&&<div className="media-preview-unavailable">
        <ImageOff size={25}/>
        <span>{failed?'Preview could not load':'Preview not available'}</span>
        <small>The file may still be downloadable.</small>
      </div>}
    </div>
    <div className="media-preview-details">
      <div className="media-preview-title">
        {item.kind==='video'?<FileVideo size={17}/>:<FileImage size={17}/>}
        <strong>{item.label}</strong>
      </div>
      <span className="media-preview-kind">{item.kind==='photo'?'Image':item.kind==='video'?'Video':'File'}</span>
      {item.kind==='photo'&&photoSource&&!failed&&
        <button className="media-preview-expand" type="button" onClick={()=>setExpanded(true)}>View larger</button>}
      <a className="media-download-link" href={item.downloadUrl} rel="noopener noreferrer">
        <Download size={16}/> Download {item.kind==='photo'?'image':item.kind==='video'?'video':'file'}
      </a>
    </div>
    {expanded&&photoSource&&<div className="media-preview-lightbox" role="dialog" aria-modal="true" aria-label={`Large preview of ${item.label}`} onKeyDown={e=>{if(e.key==='Escape')setExpanded(false);}}>
      <button className="media-lightbox-close" type="button" onClick={()=>setExpanded(false)} aria-label="Close large preview">Close ✕</button>
      <img src={photoSource} alt={`Full preview of ${item.label}`} onError={()=>setExpanded(false)}/>
    </div>}
  </article>;
}

export default function MediaDownloader({onBack}:{onBack:()=>void}){
  const [url,setUrl]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [downloads,setDownloads]=useState<PreviewItem[]>([]);
  const platform=classifyMediaLink(url);

  function change(value:string){setUrl(value);setError('');setDownloads([]);}

  async function loadPreviews(e:FormEvent){
    e.preventDefault();
    if(!platform){setError('Paste an individual supported public media post URL.');return;}
    if(busy)return;
    setBusy(true);setError('');setDownloads([]);
    try{
      const result=await requestMedia(url.trim());
      const items=mediaItems(result);
      if(!items.length)throw new Error('This post returned no usable media files.');
      setDownloads(items);
    }catch(e){
      setError(e instanceof Error?e.message:'The media could not be retrieved.');
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
        <p>Preview available photos or videos before choosing what to save to your device.</p>
      </div>
    </div>
    <div className="media-platforms">
      {platforms.map(name=><div key={name} className={'media-platform '+(platform===name?'media-platform-active':'')}>
        <strong>{name==='X'?'X (Twitter)':name}</strong><span>{guidance[name].desc}</span>
      </div>)}
    </div>
    <section className="workspace-panel media-panel">
      <div className="panel-heading">
        <div><h3>Preview and download</h3><p>Paste a post URL. Review the available media, then download what you want.</p></div>
        <span className="tag tag-mint"><ShieldCheck size={11}/> PUBLIC</span>
      </div>
      <form className="media-input-form" onSubmit={e=>void loadPreviews(e)}>
        <label htmlFor="media-url">POST URL</label>
        <div className="media-input">
          <Link2 size={18}/>
          <input id="media-url" type="url" required autoComplete="off" value={url} onChange={e=>change(e.target.value)} placeholder="https://www.instagram.com/p/…"/>
        </div>
        <div className="media-input-actions">
          {platform&&<span className="media-platform-detected"><CheckCircle2 size={15}/> {platform} link recognized</span>}
          <button type="submit" className="primary-action" disabled={!API_BASE||!platform||busy}>
            {busy?<><LoaderCircle className="spin" size={17}/> Finding media…</>:<><FileImage size={17}/> Show previews</>}
          </button>
        </div>
      </form>
      {error&&<div className="media-service-notice" role="alert">
        <Info size={19}/>
        <div><strong>Media unavailable</strong><p>{error}</p><p>Some public posts restrict access from hosted services.</p></div>
      </div>}
      {downloads.length>0&&<section className="media-preview-results" aria-label="Media available for download">
        <div className="media-preview-heading">
          <div>
            <div className="media-preview-summary"><CheckCircle2 size={19}/><strong>{downloads.length===1?'Media ready to preview':`${downloads.length} media files found`}</strong></div>
            <p>Review each {downloads.length>1?'item':'file'} below, then select Download. Previews depend on source access and links may expire.</p>
          </div>
          <span className="media-count-pill">{downloads.length} {downloads.length===1?'item':'items'}</span>
        </div>
        <div className="media-preview-grid">
          {downloads.map((item,index)=><MediaPreviewCard key={item.downloadUrl+index} item={item} index={index}/>)}
        </div>
      </section>}
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
