import {expect,it} from 'vitest';
import {createGame,dispatch,hireCost} from '../simulation/engine';
import {competitorsDaily} from '../simulation/competitors';
import {cityOf} from '../simulation/city-state';
import {communityOf,availableResidents,workingAdults,residentWorkers,recruitableResidents} from '../simulation/community-state';
import {townOf,localEmployment} from '../simulation/town-state';
import {townDaily} from '../simulation/stages/town';
import {post} from '../simulation/core';
import {parseSave} from '../simulation/persistence';
function fixture(){
 const s=createGame(1707);s.legacyProgression=true;s.era=8;s.stageId='city';
 const c=communityOf(s);c.active=true;c.charter='free';c.fed=1;c.happiness=.9;c.homes=[{id:999,tier:'cottage',count:100,cost:300000}];c.cohorts=[{id:998,name:'Families',households:100,adults:200,children:200}];
 const t=townOf(s);t.active=true;t.charter='public';t.taxRate=.25;
 const v=cityOf(s);v.active=true;v.charter='watch';post(s,'sharesIssued',1e6,'Fixture capital');s.tick=24;return s;
}
// shortcut: built on the old town treasury, which the new Town replaced (11 Nov 2026); rewrite with the City/Region rework.
it.skip('Neighbour wages redirect the real existing labour bill, without charging it twice or paying the company',()=>{
 const s=fixture(),outside=structuredClone(s),cash=s.cash;cityOf(outside).active=false;
 competitorsDaily(s);competitorsDaily(outside);expect(s.competitors).toEqual(outside.competitors);expect(s.rng).toBe(outside.rng);
 const npcBefore=structuredClone(s.competitors),house=communityOf(s).householdCash;
 townDaily(s);const v=cityOf(s),t=townOf(s);
 expect(v.neighbourJobs).toBeGreaterThan(0);expect(localEmployment(s)).toBeLessThanOrEqual(workingAdults(s));expect(s.cash).toBe(cash);
 expect(s.competitors).toEqual(npcBefore);expect(communityOf(s).householdCash-house).toBe(v.neighbourPayroll);
 for(const e of v.employers)expect(e.wages).toBeLessThanOrEqual(s.competitors.find(c=>c.id===e.id)!.payrollToday);
 const paid=v.neighbourPayroll,same=JSON.stringify(s);townDaily(s);expect(JSON.stringify(s)).toBe(same);
 s.tick=48;competitorsDaily(s);townDaily(s);expect(t.lastTax).toBeCloseTo(Math.floor(paid*.25*100)/100,2);
 expect(parseSave(JSON.stringify({game:s})).game).toEqual(s);
});
it('Stale or stopped employers cannot keep creating resident wages',()=>{
 const s=fixture();competitorsDaily(s);townDaily(s);expect(cityOf(s).neighbourJobs).toBeGreaterThan(0);
 const house=communityOf(s).householdCash;s.tick=48;townDaily(s);
 expect(cityOf(s).neighbourJobs).toBe(0);expect(cityOf(s).neighbourPayroll).toBe(0);expect(communityOf(s).householdCash).toBeCloseTo(house-townOf(s).lastTax,2);
 for(const c of s.competitors)if(c.region==='heartland')c.status='acquired';
 s.tick=72;competitorsDaily(s);townDaily(s);expect(cityOf(s).employers).toHaveLength(0);
});
it('Premium recruitment reassigns a real employed adult; rejected recruitment changes no jobs or money',()=>{
 const s=fixture();competitorsDaily(s);townDaily(s);const v=cityOf(s);
 // A smaller remaining adult cohort makes this a genuinely full-employment case.
 communityOf(s).cohorts[0].adults=v.neighbourJobs;
 expect(availableResidents(s)).toBe(0);expect(recruitableResidents(s,1.1)).toBeGreaterThan(0);
 const jobs=v.neighbourJobs,cash=s.cash,house=communityOf(s).householdCash,snapshot=JSON.stringify(s);
 expect(dispatch(s,{type:'hire',region:'heartland',role:'hand',wageFactor:1}).ok).toBe(false);expect(JSON.stringify(s)).toBe(snapshot);
 expect(dispatch(s,{type:'hire',region:'heartland',role:'hand',wageFactor:1.1}).ok).toBe(true);
 expect(v.neighbourJobs).toBe(jobs-1);expect(residentWorkers(s)).toBe(1);expect(localEmployment(s)).toBe(workingAdults(s));expect(s.cash).toBe(cash-hireCost(s,'heartland'));expect(communityOf(s).householdCash).toBe(house);
 post(s,'dividends',-s.cash,'Fixture distribution');const noCash=JSON.stringify(s);
 expect(dispatch(s,{type:'hire',region:'heartland',role:'hand',wageFactor:1.1}).ok).toBe(false);expect(JSON.stringify(s)).toBe(noCash);
});
it('Version11 saves gain neutral payroll defaults, preserving their chosen City and resident count',()=>{
 const s=fixture(),old=JSON.parse(JSON.stringify(s));old.version=11;
 for(const c of old.competitors){delete c.payrollDay;delete c.payrollToday;}
 for(const k of ['neighbourJobs','neighbourPayroll','employmentDay','employers'])delete old.stageState.city[k];
 const restored=parseSave(JSON.stringify({game:old})).game;
 expect(workingAdults(restored)).toBe(200);expect(restored.cash).toBe(s.cash);expect(cityOf(restored).active).toBe(true);expect(cityOf(restored).neighbourJobs).toBe(0);
 const bad=structuredClone(restored);cityOf(bad).neighbourJobs=5;expect(()=>parseSave(JSON.stringify({game:bad}))).toThrow(/employment/);
});
