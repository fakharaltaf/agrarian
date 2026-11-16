// Reference implementation for src/app/Logo.tsx with the M5 logo (copy logoArt.ts to src/app first).
// Keeps the current API: LogoMark({ size, title, variant, className }) and
// Wordmark({ size, variant, layout, title, className }), and adds `era` and `weight`.
import { GOLD, INK, LOCKUP, MARKS, WORD, WORD_WIDTH, type Era, type Weight } from './logoArt';

/** auto follows the app theme; light/dark force a palette; mono is one colour (currentColor), for watermarks. */
export type LogoVariant = 'auto' | 'light' | 'dark' | 'mono';

const ink = (v: LogoVariant) => (v === 'mono' ? 'currentColor' : v === 'auto' ? `var(--logo-ink, ${INK.light})` : INK[v]);
const gold = (v: LogoVariant) => (v === 'mono' ? 'currentColor' : GOLD);
/** The thin line breaks up when small, so 32px and below use the heavier cut of the same drawing. */
const autoWeight = (px: number): Weight => (px <= 32 ? 'bold' : 'line');

function MarkArt({ era, weight, variant }: { era: Era; weight: Weight; variant: LogoVariant }) {
  const m = MARKS[era][weight];
  return <>
    <path d={m.ink} fill={ink(variant)} />
    {m.accent && <path d={m.accent} fill={gold(variant)} />}
  </>;
}

const a11y = (title?: string) => (title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const, focusable: 'false' as const });

export function LogoMark({ size = 32, title, variant = 'auto', era = 'farm', weight, className }: {
  size?: number; title?: string; variant?: LogoVariant; era?: Era; weight?: Weight; className?: string;
}) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" {...a11y(title)}>
      {title && <title>{title}</title>}
      <MarkArt era={era} weight={weight ?? autoWeight(size)} variant={variant} />
    </svg>
  );
}

/** Mark + wordmark. `size` works like a font size (letter cap height ≈ 0.73 × size). */
export function Wordmark({ size = 20, variant = 'auto', layout = 'horizontal', era = 'farm', title = 'Agrarian', className }: {
  size?: number; variant?: LogoVariant; layout?: 'horizontal' | 'stacked'; era?: Era; title?: string; className?: string;
}) {
  const cap = size * 0.73;
  const word = (x: number, y: number, c: number) => <path transform={`translate(${x} ${y}) scale(${c / 100})`} d={WORD} fill={ink(variant)} />;
  const stacked = layout === 'stacked';
  const unit = cap / (stacked ? LOCKUP.sCap : LOCKUP.hCap);
  const markPx = 64 * unit;
  const weight = autoWeight(markPx);
  let w: number, h: number, body: JSX.Element;
  if (stacked) {
    const ww = (WORD_WIDTH * LOCKUP.sCap) / 100;
    w = Math.max(64, ww); h = 64 + LOCKUP.sGap + LOCKUP.sCap;
    body = <><g transform={`translate(${(w - 64) / 2} 0)`}><MarkArt era={era} weight={weight} variant={variant} /></g>{word((w - ww) / 2, 64 + LOCKUP.sGap, LOCKUP.sCap)}</>;
  } else {
    w = 64 + LOCKUP.hGap + (WORD_WIDTH * LOCKUP.hCap) / 100; h = 64;
    body = <><MarkArt era={era} weight={weight} variant={variant} />{word(64 + LOCKUP.hGap, 32 - LOCKUP.hCap / 2, LOCKUP.hCap)}</>;
  }
  return (
    <svg className={['wordmark', className].filter(Boolean).join(' ')} width={+(w * unit).toFixed(1)} height={+(h * unit).toFixed(1)}
      viewBox={`0 0 ${w.toFixed(2)} ${h}`} role="img" aria-label={title}>
      <title>{title}</title>
      {body}
    </svg>
  );
}
