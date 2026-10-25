/** Lightweight horizontal-projection line segmentation.
 * A handwritten descender may leave a few dark pixels in the whitespace
 * between lines. Use a density threshold instead of treating every dark
 * pixel as part of the same line.
 */
export type InkLine = { top: number; bottom: number };
export function segmentInkRows(counts: readonly number[], imageWidth: number): InkLine[] {
  if (!counts.length || !Number.isFinite(imageWidth) || imageWidth < 1) return [];
  const smoothed = counts.map((_,y) => {
    let sum=0,seen=0;
    for (let k=Math.max(0,y-2);k<=Math.min(counts.length-1,y+2);k++) { sum+=counts[k];seen++; }
    return sum/seen;
  });
  // counts are sampled at every other pixel column.
  const threshold = Math.max(9, Math.round(imageWidth * 0.012));
  const gapTolerance = Math.max(3, Math.min(8, Math.round(counts.length * 0.006)));
  const lines:InkLine[] = [];
  let top=-1,last=-1;
  for (let y=0;y<=counts.length;y++) {
    const active = y<counts.length && smoothed[y]>=threshold;
    if (active) { if(top<0)top=y; last=y; }
    else if(top>=0 && (y===counts.length||y-last>gapTolerance)) {
      if(last-top>=Math.max(4,Math.round(counts.length*.004))) lines.push({top,bottom:last});
      top=-1;last=-1;
    }
  }
  return lines;
}

/** Crop margins around an ink core, respecting neighboring line boundaries. */
export function expandedLineBounds(lines: readonly InkLine[], index: number, fullHeight: number): InkLine {
  const current = lines[index];
  if (!current) throw new Error('Missing handwritten line.');
  const pad = Math.round((current.bottom-current.top+1)*.28)+7;
  let top=Math.max(0,current.top-pad),bottom=Math.min(fullHeight,current.bottom+pad+1);
  if(index>0) top=Math.max(top,Math.ceil((lines[index-1].bottom+current.top)/2));
  if(index+1<lines.length) bottom=Math.min(bottom,Math.floor((current.bottom+lines[index+1].top)/2));
  return {top,bottom};
}

/** Choose a gap near the center instead of splitting a word across two images. */
export function bestWordGap(columnInk: readonly number[], minGap = 10): number | null {
  const width = columnInk.length;
  if(width<100) return null;
  const lower=Math.floor(width*.34), upper=Math.ceil(width*.66);
  let best:number|null=null, bestScore=-Infinity;
  for(let x=lower;x<upper;) {
    if(columnInk[x]>0){x++;continue;}
    let end=x+1;
    while(end<upper && columnInk[end]===0)end++;
    const length=end-x;
    if(length>=minGap) {
      const center=(x+end)/2;
      const score=length - Math.abs(center-width/2)*.15;
      if(score>bestScore){bestScore=score;best=Math.round(center);}
    }
    x=end;
  }
  return best;
}
