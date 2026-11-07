import {expect,it} from 'vitest';
import {tooltipPlacement} from '../app/tooltip';
it('Keeps explanations inside narrow and wide screens, including both bottom edges',()=>{
  for(const width of [240,390,1400])for(const left of [0,width-44])for(const top of [0,400,800]) {
    const p=tooltipPlacement({left,top,bottom:top+44,width:44},{width,height:844});
    expect(p.x).toBeGreaterThanOrEqual(12);expect(p.x+p.width).toBeLessThanOrEqual(width-12);
    const start=p.below?p.y:p.y-p.maxHeight,end=p.below?p.y+p.maxHeight:p.y;
    expect(start).toBeGreaterThanOrEqual(12);expect(end).toBeLessThanOrEqual(844-12);
    expect(p.width).toBeLessThanOrEqual(320);
  }
});
