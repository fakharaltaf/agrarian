// Existing NPC labour expense can be paid to local residents instead of outside contractors.
// This allocation never changes a competitor's cost/profit or posts income to the company.
import type {GameState} from './types';
import {cityActive,cityOf} from './city-state';
import {marketWage,round2} from './core';
import {payHouseholds} from './town-state';
export function allocateNeighbourJobs(s:GameState,available:number) {
  if(!cityActive(s))return;
  const v=cityOf(s),day=Math.floor(s.tick/24);
  if(v.employmentDay===day)return;
  v.employmentDay=day;v.neighbourJobs=0;v.neighbourPayroll=0;v.employers=[];
  let adults=Math.max(0,Math.floor(available));
  const dailyPay=round2(12*marketWage(s,'heartland'));
  if(dailyPay<=0)return;
  for(const employer of s.competitors) {
    if(!adults)break;
    if(employer.region!=='heartland'||employer.payrollDay!==day||!['active','distressed'].includes(employer.status))continue;
    const jobs=Math.min(adults,Math.floor(employer.payrollToday/dailyPay));
    if(jobs<=0)continue;
    const wages=round2(jobs*dailyPay);
    v.employers.push({id:employer.id,jobs,wages});v.neighbourJobs+=jobs;v.neighbourPayroll=round2(v.neighbourPayroll+wages);
    payHouseholds(s,wages);adults-=jobs;
  }
}
/** Successful recruitment reassigns a real employed adult. Already-earned wages are not erased. */
export function releaseNeighbourJob(s:GameState) {
  if(!cityActive(s))return false;
  const v=cityOf(s),employer=[...v.employers].reverse().find(e=>e.jobs>0);
  if(!employer||v.neighbourJobs<1)return false;
  employer.jobs--;v.neighbourJobs--;return true;
}
