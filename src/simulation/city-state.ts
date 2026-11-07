// Compact civic state: three existing neighbourhoods, never one record per citizen.
import type { GoodId } from './config';
import type { DistrictId, GameState } from './types';
export type PoliceCharter = 'watch' | 'professional' | 'strict';
export type JusticePolicy = 'rehabilitate' | 'punish';
export type ZoneType = 'farm' | 'residential' | 'industrial';
export interface CityDistrict {
  zone: ZoneType; rezonedAt: number; sanitation: number; lighting: number; police: number;
}
export interface CityCase {
  id: number; district: DistrictId; kind: 'theft' | 'smuggling' | 'gang'; opened: number; deadline: number;
  good: GoodId; lost: number;
}
export interface CityState {
  active: boolean; autoFund:boolean; enteredAt: number; charter: PoliceCharter | null; reformUntil: number;
  justice: JusticePolicy; districts: Record<DistrictId,CityDistrict>;
  training: number; trainingUntil: number; trainingTarget: number;
  lastDay: number; crime: number; crimeHistory: number[]; sanitation: number; lighting: number; police: number;
  case: CityCase | null; nextCaseDay: number; prevention: number;
  solved: number; rehabilitated: number; punished: number; caseHistory: {day:number;kind:string;answer:string}[];
  threatAt: number; safeDays: number;
}
export function createCityState(): CityState {
  const district=(zone:ZoneType):CityDistrict=>({zone,rezonedAt:-1,sanitation:0,lighting:0,police:0});
  return {active:false,autoFund:false,enteredAt:-1,charter:null,reformUntil:-1,justice:'rehabilitate',
    districts:{farmgate:district('farm'),orchard:district('residential'),heights:district('residential')},
    training:1,trainingUntil:-1,trainingTarget:1,lastDay:-1,crime:0,crimeHistory:[],sanitation:0,lighting:0,police:0,
    case:null,nextCaseDay:-1,prevention:0,solved:0,rehabilitated:0,punished:0,caseHistory:[],threatAt:-1,safeDays:0};
}
export const cityOf=(s:GameState):CityState=>(s.stageState.city??=createCityState() as unknown as Record<string,unknown>) as unknown as CityState;
export const POLICE_CHARTERS:Record<PoliceCharter,{name:string;icon:string;staff:number;suppression:number;happiness:number}>={
  watch:{name:'Community watch',icon:'🤝',staff:.5,suppression:.2,happiness:.002},
  professional:{name:'Professional police',icon:'🛡',staff:1,suppression:.4,happiness:0},
  strict:{name:'Strict order',icon:'⚖',staff:1.5,suppression:.55,happiness:-.005},
};
export const cityActive=(s:GameState)=>!!(s.stageState.city as unknown as CityState|undefined)?.active;
export const policeJobs=(s:GameState)=>6*(cityActive(s)?POLICE_CHARTERS[cityOf(s).charter??'watch'].staff:1);
