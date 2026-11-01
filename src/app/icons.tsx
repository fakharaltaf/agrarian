// Minimal line icon set (24×24, stroke = currentColor).
const P: Record<string, string> = {
  logo: 'M12 22V8M12 8c0-3 2-5 5-6 0 3-2 5-5 6Zm0 4c0-3-2-5-5-6 0 3 2 5 5 6Zm0 4c0-3 2-5 5-6 0 3-2 5-5 6Z',
  overview: 'M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z',
  fields: 'M3 20h18M5 20V10l7-5 7 5v10M9 20v-5h6v5',
  markets: 'M4 19V5M4 19h16M8 15l3-4 3 2 5-6',
  workers: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 9c0-3 2-5 5-5s5 2 5 5M17 11a2.5 2.5 0 1 0 0-5M20 20c0-2-1-4-3-4.5',
  storage: 'M3 9l9-5 9 5v11H3V9Zm4 11v-7h10v7M7 16h10',
  finance: 'M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H7',
  equipment: 'M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm10-1a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM9 17h6M3 17v-6h9l2 5M7 11V7h5l2 4',
  automation: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.3-1.3L14.4 3h-4l-.3 2.5a7 7 0 0 0-2.3 1.3l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.3 1.3l.3 2.5h4l.3-2.5a7 7 0 0 0 2.3-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3Z',
  production: 'M3 20V10l5 3V10l5 3V6h4l1 4h3v10H3Zm4-3h2m4 0h2',
  research: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9',
  logistics: 'M3 6h11v10H3zM14 9h4l3 3v4h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  analytics: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  competitors: 'M8 21V11l4-3 4 3v10M3 21V14l5-3M21 21v-7l-5-3M2 21h20',
  world: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3Z',
  corporation: 'M4 21V5l8-3v19M12 21V9l8 3v9M2 21h20M7 8h2M7 12h2M7 16h2M15 14h2M15 18h2',
  policy: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Zm-3 9 2 2 4-4',
  livestock: 'M5 13c0-4 3-7 7-7s7 3 7 7v4H5v-4Zm2 4v3m10-3v3M9 10h.01M15 10h.01M3 9l2 2m16-2-2 2',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4a2 2 0 0 0 4 0',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14m0 3v.01',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
};
export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.overview} />
    </svg>
  );
}
