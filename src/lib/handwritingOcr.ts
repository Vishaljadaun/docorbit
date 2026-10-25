import { segmentInkRows, expandedLineBounds } from './handwritingSegmentation';
import { isInkPixel } from './ocrImage';
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
function segmentLines(canvas:HTMLCanvasElement,ignoreColorArt:boolean):{top:number;bottom:number}[]{
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Image pixels unavailable.');
  const {width,height}=canvas;
  const image=ctx.getImageData(0,0,width,height).data;
  const counts:number[]=new Array(height).fill(0);
  for(let y=0;y<height;y++)for(let x=0;x<width;x+=2){
    const p=(y*width+x)*4;
    if(isInkPixel(image[p],image[p+1],image[p+2],ignoreColorArt))counts[y]++;
  }
  return segmentInkRows(counts,width).slice(0,42);
}
async function recognizeCanvas(canvas:HTMLCanvasElement,recognize:TextGenerator,onProgress:(s:string)=>void,signal?:AbortSignal,ignoreColorArt=true){
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('Image pixels unavailable.');
  const lines=segmentLines(canvas,ignoreColorArt);
  if(lines.length<1)throw Error('No handwriting lines detected. Use Printed text mode or a clearer scan.');
  const out:string[]=[];
  for(let index=0;index<lines.length;index++){
    if(signal?.aborted)throw Error('Recognition cancelled.');
    const bounds=expandedLineBounds(lines,index,canvas.height);
    const top=bounds.top;
    const height=bounds.bottom-bounds.top;
    const source=ctx.getImageData(0,top,canvas.width,height);
    let left=canvas.width,right=-1;
    for(let y=0;y<height;y++)for(let x=0;x<canvas.width;x+=2){
      const k=(y*canvas.width+x)*4;
      if(isInkPixel(source.data[k],source.data[k+1],source.data[k+2],ignoreColorArt)){
        left=Math.min(left,x);right=Math.max(right,x);
      }
    }
    if(right<left)continue;
    left=Math.max(0,left-20);
    right=Math.min(canvas.width,right+22);
    const crop=document.createElement('canvas');
    crop.width=right-left;crop.height=height;
    const cropCtx=crop.getContext('2d');
    if(!cropCtx)throw Error('Canvas unavailable.');
    cropCtx.fillStyle='#ffffff';
    cropCtx.fillRect(0,0,crop.width,crop.height);
    cropCtx.drawImage(canvas,left,top,crop.width,height,0,0,crop.width,height);
    // Solid backgrounds (such as turquoise paper) become white, ink becomes dark.
    const pixels=cropCtx.getImageData(0,0,crop.width,crop.height);
    for(let k=0;k<pixels.data.length;k+=4){
      const normalized=isInkPixel(pixels.data[k],pixels.data[k+1],pixels.data[k+2],ignoreColorArt)?0:255;
      pixels.data[k]=normalized;pixels.data[k+1]=normalized;pixels.data[k+2]=normalized;pixels.data[k+3]=255;
    }
    cropCtx.putImageData(pixels,0,0);
    onProgress('Reading handwriting line '+(index+1)+' of '+lines.length+'…');
    const result=await recognize(crop.toDataURL('image/png'),{max_new_tokens:100});
    out.push(result?.[0]?.generated_text?.trim()||'');
    crop.width=crop.height=0;
  }
  return out.filter(Boolean).join('\n');
}
export async function recognizeHandwriting(file:File,{range='all',onProgress=()=>{},signal,ignoreColorArt=true}:{range?:string;onProgress?:(message:string)=>void;signal?:AbortSignal;ignoreColorArt?:boolean}={}):Promise<{pages:OcrPage[];totalPages:number;skippedPages:boolean}>{
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
      try{return{pages:[{page:1,text:await recognizeCanvas(canvas,recognize,onProgress,signal,ignoreColorArt)}],totalPages:1,skippedPages:false};}
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
        pages.push({page:i+1,text:await recognizeCanvas(canvas,recognize,onProgress,signal,ignoreColorArt)});
      }finally{canvas.width=canvas.height=0;page.cleanup();}
    }
    return{pages,totalPages,skippedPages:indexes.length<totalPages};
  }finally{if(task)await task.destroy();}
}
