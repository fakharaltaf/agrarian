// Compact civic state: per-home safety on the map, the police charter, and open cases. Never one record per citizen.
import type { GoodId } from './config';
import type { GameState, ShopType } from './types';
export type PoliceCharter = 'watch' | 'professional' | 'strict';
export type JusticePolicy = 'rehabilitate' | 'punish';
/** theft: goods taken from your stores; smuggling: town shops buy less from you while it runs; gang: happiness falls each day until answered. */
export type CaseKind = 'theft' | 'smuggling' | 'gang';
export interface CityCase {
  id: number; kind: CaseKind; opened: number; deadline: number;
  good: GoodId; lost: number;
  /** the home whose street it happened on (shown on the map) */
  home?: number;
}
/** What reaches one home, from Town's daily pass: street power along the lines and the watch within a watchhouse's reach (0–1). */
export interface HomeCover { id: number; families: number; power: number; watch: number; /** how well each kind of shop reaches it */ shops?: Partial<Record<ShopType, number>> }
/** Yesterday's trade at the city's shops. */
export interface CityTrade { spend: number; ours: number; imports: number; gst: number; /** goods families wanted that you had none of, biggest first */ gaps: { good: GoodId; value: number }[] }
export interface CityState {
  active: boolean; enteredAt: number; charter: PoliceCharter | null; reformUntil: number;
  justice: JusticePolicy;
  training: number; trainingUntil: number; trainingTarget: number;
  lastDay: number; crime: number; crimeHistory: number[];
  /** share of families inside a working watchhouse's reach, weighted by how well */
  police: number;
  homes?: HomeCover[];
  /** crime on each home's street, by home id */
  homeCrime?: Record<number, number>;
  case: CityCase | null; nextCaseDay: number; prevention: number;
  neighbourJobs:number; neighbourPayroll:number; employers:{id:number;jobs:number;wages:number}[]; employmentDay:number;
  solved: number; rehabilitated: number; punished: number; caseHistory: {day:number;kind:string;answer:string}[];
  threatAt: number; safeDays: number;
  /** GST on shop sales: 0, 0.05 or 0.1 */
  gst: number;
  trade?: CityTrade;
}
export function createCityState(): CityState {
  return {active:false,enteredAt:-1,charter:null,reformUntil:-1,justice:'rehabilitate',
    training:1,trainingUntil:-1,trainingTarget:1,lastDay:-1,crime:0,crimeHistory:[],police:0,homes:[],homeCrime:{},
    case:null,nextCaseDay:-1,prevention:0,neighbourJobs:0,neighbourPayroll:0,employers:[],employmentDay:-1,solved:0,rehabilitated:0,punished:0,caseHistory:[],threatAt:-1,safeDays:0,gst:.05};
}
/** Share of families (weighted by how well) that a kind of shop reaches. */
export const shopReach=(s:GameState,kind:ShopType)=>{const c=s.stageState.city as unknown as CityState|undefined,h=c?.active?c.homes??[]:[],n=h.reduce((a,x)=>a+x.families,0);return n?h.reduce((a,x)=>a+(x.shops?.[kind]??0)*x.families,0)/n:0;};
const SHOPS:ShopType[]=['shopBaker','shopDairy','shopButcher','shopGrocer','shopGeneral'];
/** Shops in reach lift the mood of the homes (up to +4% with all five kinds); GST takes some back (10% is a small net loss). */
export const shopMood=(s:GameState)=>{const c=s.stageState.city as unknown as CityState|undefined;if(!c?.active)return 0;const r=SHOPS.map(k=>shopReach(s,k));return r.reduce((a,b)=>a+b,0)/5*.04-Math.max(...r)*c.gst*.5;};
export const cityOf=(s:GameState):CityState=>(s.stageState.city??=createCityState() as unknown as Record<string,unknown>) as unknown as CityState;
export const POLICE_CHARTERS:Record<PoliceCharter,{name:string;icon:string;staff:number;suppression:number;happiness:number}>={
  watch:{name:'Community watch',icon:'🤝',staff:.5,suppression:.2,happiness:.002},
  professional:{name:'Professional police',icon:'🛡',staff:1,suppression:.4,happiness:0},
  strict:{name:'Strict order',icon:'⚖',staff:1.5,suppression:.55,happiness:-.005},
};
export const cityActive=(s:GameState)=>!!(s.stageState.city as unknown as CityState|undefined)?.active;
export const policeJobs=(s:GameState)=>6*(cityActive(s)?POLICE_CHARTERS[cityOf(s).charter??'watch'].staff:1);
/** Crime on a home's street, from the last civic day (0 before City begins). */
export const crimeAt=(s:GameState,home:number)=>cityOf(s).homeCrime?.[home]??0;
