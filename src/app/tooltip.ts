/** Pure placement shared by hover/focus/touch explanations. */
export function tooltipPlacement(anchor: {left:number;top:number;bottom:number;width:number}, viewport: {width:number;height:number}) {
  const width=Math.max(1,Math.min(320,viewport.width-24));
  const above=Math.max(0,anchor.top-20),belowSpace=Math.max(0,viewport.height-anchor.bottom-20);
  const below=belowSpace>=above;
  return {
    x:Math.max(12,Math.min(viewport.width-width-12,anchor.left+anchor.width/2-width/2)),
    y:below?anchor.bottom+8:anchor.top-8,
    width,below,maxHeight:Math.max(1,Math.min(480,below?belowSpace:above)),
  };
}
