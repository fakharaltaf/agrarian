// Brand mark: a smiling sun rising over a sprout on a furrowed hill.
export function LogoMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <g stroke="#F4B63F" strokeWidth="3.2" strokeLinecap="round">
        {[...Array(8)].map((_, i) => {
          const a = (Math.PI * (i + 0.5)) / 8 + Math.PI; // rays across the upper half
          return <line key={i} x1={32 + Math.cos(a) * 17} y1={25 + Math.sin(a) * 17} x2={32 + Math.cos(a) * 23} y2={25 + Math.sin(a) * 23} />;
        })}
      </g>
      <circle cx="32" cy="25" r="12.5" fill="#F4B63F" />
      <circle cx="27.5" cy="22.5" r="1.7" fill="#3A2E25" />
      <circle cx="36.5" cy="22.5" r="1.7" fill="#3A2E25" />
      <path d="M27 27.5 Q32 31.5 37 27.5" fill="none" stroke="#3A2E25" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M2 62 Q32 34 62 62 Z" fill="#6BB35A" />
      <path d="M12 60 Q32 44 52 60M20 61 Q32 51 44 61" fill="none" stroke="#4E9442" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M32 50 V42" stroke="#2F7A45" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M32 46 Q25.5 45 24.5 40 Q31 40.5 32 46Z M32 44 Q38 43 39.5 38.5 Q33 38.5 32 44Z" fill="#2F7A45" />
    </svg>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      <LogoMark size={size * 1.55} />
      <span>Agrarian</span>
    </span>
  );
}
