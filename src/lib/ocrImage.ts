/** Detect dark ink while optionally excluding strongly colored decorations.
 *  A low-saturation pixel likely belongs to ordinary black/gray handwriting.
 *  When colored content matters, callers can disable color rejection.
 */
export function isInkPixel(red:number,green:number,blue:number,ignoreColorArt:boolean):boolean {
  const luma=red*.299+green*.587+blue*.114;
  if(luma>=145) return false;
  if(!ignoreColorArt) return true;
  return Math.max(red,green,blue)-Math.min(red,green,blue)<40;
}
