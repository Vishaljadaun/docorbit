/** Optional on-device handwriting OCR, using a line recognition model.
 * Models load only when handwriting mode is explicitly chosen.
 * Results remain estimates: always proofread handwriting.
 */
import type {OcrPage} from './ocr';

type TextGenerator = (image: string, options?: {max_new_tokens?:number}) => Promise<{generated_text:string}[]>;
let modelPromise:Promise<TextGenerator>|null=null;
async function model(progress:(message:string)=>void):Promise<TextGenerator>{
  if(!modelPromise){
    modelPromise=import('@huggingface/transformers').then(async ({pipeline,env})=>{
      env.allowLocalModels=false;
      progress('Downloading handwriting model (first run can be large)…');
      const instance=await pipeline('image-to-text','Xenova/trocr-small-handwritten',{device:'wasm',dtype:'q8'});
      return instance as unknown as TextGenerator;
    }).catch(e=>{modelPromise=null;throw e;});
  }
  return modelPromise;
}
function segmentLines(canvas:HTMLCanvasElement):{top:number;bottom:number}[]{
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Image pixels unavailable.');
  const {width,height}=canvas;
  const image=ctx.getImageData(0,0,width,height).data;
  const counts:number[]=new Array(height).fill(0);
  const threshold=Math.max(2,Math.round(width*.003));
  for(let y=0;y<height;y++)for(let x=0;x<width;x+=2){
    const p=(y*width+x)*4;
    const bright=(image[p]*.299+image[p+1]*.587+image[p+2]*.114);
    if(bright<115)counts[y]++;
  }
  const spans:{top:number;bottom:number}[]=[];let start=-1;
  for(let y=0;y<height;y++){
    if(counts[y]>=threshold&&start<0)start=y;
    if((counts[y]<threshold||y===height-1)&&start>=0){
      const end=counts[y]<threshold?y-1:y;
      if(end-start>=Math.max(5,height*.006))spans.push({top:start,bottom:end});
      start=-1;
    }
  }
  // Merge connected handwriting line fragments separated by tiny gaps.
  const merged:typeof spans=[];
  for(const span of spans){
    const prev=merged[merged.length-1];
    if(prev && span.top-prev.bottom<=Math.max(4,height*.008))prev.bottom=span.bottom;
    else merged.push({...span});
  }
  return merged.slice(0,42);
}
async function recognizeCanvas(canvas:HTMLCanvasElement,recognize:TextGenerator,onProgress:(s:string)=>void,signal?:AbortSignal){
  const lines=segmentLines(canvas);
  if(lines.length<1)throw Error('No handwriting lines detected. Use Printed text mode or a clearer scan.');
  const out:string[]=[];
  for(let index=0;index<lines.length;index++){
    if(signal?.aborted)throw Error('Recognition cancelled.');
    const line=lines[index];
    const pad=Math.max(9,Math.round((line.bottom-line.top)*.35));
    const top=Math.max(0,line.top-pad),height=Math.min(canvas.height-top,line.bottom-line.top+1+pad*2);
    const crop=document.createElement('canvas');crop.width=canvas.width;crop.height=height;
    const ctx=crop.getContext('2d');if(!ctx)throw Error('Canvas unavailable.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,crop.width,crop.height);
    ctx.drawImage(canvas,0,top,canvas.width,height,0,0,canvas.width,height);
    onProgress('Reading handwriting line '+(index+1)+' of '+lines.length+'…');
    const result=await recognize(crop.toDataURL('image/png'),{max_new_tokens:100});
    out.push(result?.[0]?.generated_text?.trim()||'');
    crop.width=crop.height=0;
  }
  return out.filter(Boolean).join('\n');
}
export async function recognizeHandwriting(file:File,{range='all',onProgress=()=>{},signal}:{range?:string;onProgress?:(message:string)=>void;signal?:AbortSignal}={}):Promise<{pages:OcrPage[];totalPages:number;skippedPages:boolean}>{
  if(file.size>25*1024*1024||!/\.(png|jpe?g|webp|pdf)$/i.test(file.name))throw Error('Choose a supported image or PDF under 25 MB.');
  const recognize=await model(onProgress);
  if(signal?.aborted)throw Error('Recognition cancelled.');
  const pdfMode=/\.pdf$/i.test(file.name);
  let task: {destroy:()=>Promise<void>}|undefined;
  try{
    if(!pdfMode){
      const bitmap=await createImageBitmap(file);
      const canvas=document.createElement('canvas');const factor=Math.min(1,1600/bitmap.width,2400/bitmap.height);
      canvas.width=Math.round(bitmap.width*factor);canvas.height=Math.round(bitmap.height*factor);
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable.');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      try{return{pages:[{page:1,text:await recognizeCanvas(canvas,recognize,onProgress,signal)}],totalPages:1,skippedPages:false};}
      finally{canvas.width=canvas.height=0;}
    }
    const pdfjs=await import('pdfjs-dist');
    const workerUrl=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc=workerUrl.default;
    task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
    const doc=await (task as ReturnType<typeof pdfjs.getDocument>).promise;
    const totalPages=doc.numPages;
    const {parsePageRange}=await import('./pages');
    const indexes=range.trim().toLowerCase()==='all'||!range.trim()
      ?Array.from({length:Math.min(totalPages,3)},(_,i)=>i):parsePageRange(range,totalPages);
    if(indexes.length>3)throw Error('Handwriting mode supports up to 3 PDF pages per run.');
    const pages:OcrPage[]=[];
    for(const i of indexes){
      if(signal?.aborted)throw Error('Recognition cancelled.');
      const page=await doc.getPage(i+1);const viewport=page.getViewport({scale:1.45});
      if(viewport.width*viewport.height>7_000_000)throw Error('Page is too large.');
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try{const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable.');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        await page.render({canvas,canvasContext:ctx,viewport}).promise;
        pages.push({page:i+1,text:await recognizeCanvas(canvas,recognize,onProgress,signal)});
      }finally{canvas.width=canvas.height=0;page.cleanup();}
    }
    return{pages,totalPages,skippedPages:indexes.length<totalPages};
  }finally{if(task)await task.destroy();}
}
