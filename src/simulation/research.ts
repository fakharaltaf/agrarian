import { TECH, TECHS } from './config';
import { log, post } from './core';
import type { GameState } from './types';

export const labLevel = (s: GameState) => {
  const labs = s.buildings.filter((b) => b.active && (b.type === 'lab' || b.type === 'lab2'));
  return labs.some((b) => b.type === 'lab2') ? 2 : labs.length ? 1 : 0;
};

export function canResearch(s: GameState, id: string): string | null {
  const t = TECH[id];
  if (!t) return 'Unknown project.';
  if (s.research.done.includes(id)) return 'Already researched.';
  if (s.research.active) return 'A project is already running.';
  const lvl = labLevel(s);
  if (lvl === 0) return 'Build a research station first.';
  if (t.advanced && lvl < 2) return 'Needs an advanced laboratory.';
  const missing = t.requires.filter((r) => !s.research.done.includes(r));
  if (missing.length) return `Requires ${missing.map((m) => TECH[m].name).join(', ')}.`;
  const cost = t.cost * s.macro.cpi;
  if (cost > s.cash) return `Costs $${Math.round(cost).toLocaleString()}.`;
  return null;
}

export function startResearch(s: GameState, id: string) {
  post(s, 'research', -TECH[id].cost * s.macro.cpi, `Research: ${TECH[id].name}`, 'heartland', 'corporate');
  s.research.active = { id, progress: 0 };
}

export function researchDaily(s: GameState) {
  const a = s.research.active;
  if (!a) return;
  const lvl = labLevel(s);
  if (!lvl) return; // a paused or demolished lab stalls the project
  a.progress += (lvl === 2 ? 2 : 1) / TECH[a.id].days;
  if (a.progress >= 1) {
    s.research.done.push(a.id);
    s.research.active = null;
    log(s, 'opportunity', `Research complete: ${TECH[a.id].name}. ${TECH[a.id].benefit}`, 'research');
  }
}

export const available = (s: GameState) => TECHS.filter((t) => !s.research.done.includes(t.id));
