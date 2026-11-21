const paths = {
  building: <><path d="M4 21V5l8-3 8 3v16M8 21v-4h8v4M8 7h1m6 0h1M8 11h1m6 0h1"/><path d="M2 21h20"/></>,
  layers: <><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/></>,
  lift: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 3v18M6 10l2-3 2 3m4 4 2 3 2-3"/></>,
  people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 2 4v2"/></>,
  agent: <><rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 3v3m-4 6h.01M16 12h.01M9 16h6M1 11v5m22-5v5"/></>,
  pin: <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  minus: <path d="M5 12h14"/>,
  reset: <><path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  focus: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><circle cx="12" cy="12" r="3"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  chevron: <path d="m9 5 7 7-7 7"/>,
};
export default function Icon({ name, size = 20, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.building}</svg>;
}
