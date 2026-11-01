// Cosy sound, synthesised with Web Audio (no files): short effects plus a slow generative music bed.
// Volumes live per browser; audio only starts after the player's first click (browser rule).

export type Sfx = 'click' | 'plant' | 'harvest' | 'coin' | 'buy' | 'celebrate' | 'error' | 'pop';

let ctx: AudioContext | null = null;
let sfxBus: GainNode, musicBus: GainNode;
let musicTimer = 0;

const pref = (k: string, d: number) => {
  try { const v = localStorage.getItem(`agrarian.ui.${k}`); return v === null ? d : Number(JSON.parse(v)); } catch { return d; }
};
export const volumes = () => ({ sfx: pref('sfx', 0.7), music: pref('music', 0.35) });

export function setVolume(kind: 'sfx' | 'music', v: number) {
  try { localStorage.setItem(`agrarian.ui.${kind}`, JSON.stringify(v)); } catch { /* private mode */ }
  if (!ctx) return;
  (kind === 'sfx' ? sfxBus : musicBus).gain.setTargetAtTime(v * (kind === 'music' ? 0.25 : 0.5), ctx.currentTime, 0.1);
  if (kind === 'music') v > 0 ? startMusic() : stopMusic();
}

/** Call from a user gesture (any click). Safe to call repeatedly. */
export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const v = volumes();
  sfxBus = ctx.createGain();
  sfxBus.gain.value = v.sfx * 0.5;
  musicBus = ctx.createGain();
  musicBus.gain.value = v.music * 0.25;
  sfxBus.connect(ctx.destination);
  musicBus.connect(ctx.destination);
  if (v.music > 0) startMusic();
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', peak = 0.5, bus = sfxBus, glide?: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + dur);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  o.connect(g).connect(bus);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function noise(at: number, dur: number, peak: number, freq: number) {
  if (!ctx) return;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = peak;
  src.connect(f).connect(g).connect(sfxBus);
  src.start(at);
}

export function sfx(kind: Sfx) {
  if (!ctx || volumes().sfx <= 0) return;
  const t = ctx.currentTime + 0.01;
  switch (kind) {
    case 'click': tone(880, t, 0.06, 'triangle', 0.15); break;
    case 'pop': tone(520, t, 0.12, 'sine', 0.3, sfxBus, 900); break;
    case 'plant': noise(t, 0.12, 0.25, 900); tone(392, t + 0.03, 0.18, 'triangle', 0.35); tone(523, t + 0.1, 0.22, 'triangle', 0.3); break;
    case 'harvest': noise(t, 0.22, 0.35, 2400); tone(659, t + 0.05, 0.2, 'triangle', 0.3); tone(880, t + 0.13, 0.3, 'triangle', 0.3); break;
    case 'coin': tone(1319, t, 0.12, 'square', 0.12); tone(1760, t + 0.08, 0.35, 'square', 0.12); break;
    case 'buy': tone(523, t, 0.12, 'triangle', 0.3); tone(659, t + 0.08, 0.12, 'triangle', 0.3); tone(784, t + 0.16, 0.3, 'triangle', 0.3); break;
    case 'celebrate': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.09, 0.5, 'triangle', 0.3)); noise(t + 0.4, 0.5, 0.12, 5000); break;
    case 'error': tone(330, t, 0.18, 'sine', 0.25, sfxBus, 247); break;
  }
}

// ---------------------------------------------------------------- music: slow pentatonic plucks over warm pads

const CHORDS = [[261.6, 329.6, 392.0], [196.0, 246.9, 293.7], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6]]; // C G Am F
const SCALE = [523.3, 587.3, 659.3, 784.0, 880.0, 1046.5];
let bar = 0;

function playBar() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.05;
  const chord = CHORDS[bar % CHORDS.length];
  for (const f of chord) tone(f / 2, t, 4.2, 'sine', 0.22, musicBus);
  for (let i = 0; i < 4; i++) {
    if (Math.random() < 0.35) continue;
    const f = SCALE[Math.floor(Math.random() * SCALE.length)];
    tone(f, t + i * 0.9 + Math.random() * 0.2, 1.6, 'triangle', 0.16, musicBus);
  }
  bar++;
}

function startMusic() {
  if (!ctx || musicTimer) return;
  playBar();
  musicTimer = window.setInterval(playBar, 3600);
}
function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = 0;
}
