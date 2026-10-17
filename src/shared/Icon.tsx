const PATHS: Record<string, string> = {
  "arrow-left": "M19 12H5M12 19l-7-7 7-7",
  "arrow-right": "M5 12h14M12 5l7 7-7 7",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  search: "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm10 18-4.35-4.35",
  "alert-triangle": "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01",
  "info-circle": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16v-4M12 8h.01",
  photo: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm4 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm12 6-5-5L5 21",
  sparkles: "M12 3v4M3 12h4M12 21v-4M21 12h-4M6.5 6.5l1.5 1.5M17.5 6.5 16 8M6.5 17.5 8 16M17.5 17.5 16 16",
  repeat: "m17 2 4 4-4 4M3 11V10a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3",
  "building-factory": "M3 21h18M5 21V11l4-3v3l4-3v3l4-3v13M9 15h.01M13 15h.01M9 18h.01M13 18h.01",
  user: "M12 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 13v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1",
  flag: "M5 3v18M5 4h14l-3 5 3 5H5",
  calendar: "M5 5h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm11-3v4M8 2v4M3 10h18",
  "calendar-due": "M5 5h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm11-3v4M8 2v4M3 10h18M16.5 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  "list-check": "M9 6h11M9 12h11M9 18h11M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17",
  note: "M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2ZM9 13h6M9 17h4",
  wand: "m6 21 9-9M15 4V2M15 10V8M11 6H9M21 6h-2M18.5 3.5l-1 1M18.5 8.5l-1-1",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  eye: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  print: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  download: "M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  "play-circle": "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-2-14 6 4-6 4V8Z",
};

interface Props {
  name: keyof typeof PATHS | string;
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}

// Jeu d'icônes SVG minimal, en ligne (aucune police ni fichier externe) : l'application doit
// fonctionner entièrement hors ligne, une police d'icônes via CDN n'est donc pas une option.
export default function Icon({ name, size = 16, style, className }: Props) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "-3px", flexShrink: 0, ...style }}
      className={className}
    >
      <path d={d} />
    </svg>
  );
}
