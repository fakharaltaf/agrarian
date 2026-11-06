import { describe, expect, it } from 'vitest';
// @ts-expect-error Node APIs only used in development tests.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node APIs only used in development tests.
import { createHash } from 'node:crypto';
import { ART_IDS, artModel } from '../app/world/art';

describe('licensed farm assets',()=>{
  it('ships valid embedded glTF with exact provenance within the mobile budget',()=>{
    const sources=JSON.parse(readFileSync('public/models/quaternius/sources.json','utf8')) as {file:string;license:string;author:string;sha256:string}[];
    expect(sources.length).toBe(ART_IDS.length);
    let bytes=0;
    for(const id of ART_IDS){
      const source=sources.find(s=>s.file===`${id}.glb`)!;
      expect(source.license).toBe('CC0 1.0');expect(source.author).toBe('Quaternius');
      const data=readFileSync(`public/models/quaternius/${id}.glb`);bytes+=data.length;
      expect(data.toString('ascii',0,4)).toBe('glTF');expect(data.readUInt32LE(4)).toBe(2);
      expect(data.readUInt32LE(8)).toBe(data.length);
      expect(createHash('sha256').update(data).digest('hex')).toBe(source.sha256);
      const json=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
      expect(json.extensionsRequired??[]).toEqual([]);
      for(const item of [...(json.buffers??[]),...(json.images??[])])expect(item.uri??'').not.toMatch(/^https?:/);
    }
    expect(bytes).toBeLessThan(15*1024*1024);
  });
  it('offers an immediate procedural fallback before graphics load',()=>{
    expect(artModel('house',3,3)).toBeNull();
  });
});
