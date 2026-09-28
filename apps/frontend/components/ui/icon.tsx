import type { SVGProps } from 'react';
const paths = {
  home: 'M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7',
  building:
    'M3 21V3h8v18M11 9h10v12M6 7h2M6 11h2M6 15h2M15 13h2M15 17h2M1 21h22',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-4M16 3a4 4 0 0 1 0 8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  deals:
    'M2 7l3-2 4 2M15 7l4-2 3 2v7l-3 1M2 7v7l3 1M5 15l5 5a2 2 0 0 0 3-1M13 19a2 2 0 0 0 3-2M16 17a2 2 0 0 0 3-3l-5-5-3 2a2 2 0 0 1-3-3l3-3h3l5 3M10 15l3 4M13 13l3 4',
  wallet: 'M3 6h18v14H3zM3 6l14-3v3M15 11h6v5h-6z',
  chart: 'M4 3v18h17M8 17v-5M13 17V8M18 17V4',
  megaphone: 'M3 9v6h5l11 5V4L8 9H3M8 15l2 6M22 9v6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  more: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
  award: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M8 12l-2 9 6-3 6 3-2-9',
} as const;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
