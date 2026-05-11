export interface AvatarStyle {
  initial: string;
  bg: string;
  fg: string;
  vacant: boolean;
}

export const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#0F172A', fg: '#FFFFFF' }, // harvey-style: deep slate
  { bg: '#FCE7F3', fg: '#BE185D' }, // mia-style: pink
  { bg: '#DBEAFE', fg: '#1D4ED8' }, // qi-style: blue
  { bg: '#FEF3C7', fg: '#B45309' }, // shawn-style: amber
  { bg: '#DCFCE7', fg: '#15803D' }, // george-style: green
  { bg: '#EDE9FE', fg: '#6D28D9' }, // jianhao-style: violet
  { bg: '#CFFAFE', fg: '#0E7490' }, // yang-style: cyan
  { bg: '#FFE4E6', fg: '#BE123C' }, // tobi-style: rose
];

const VACANT_STYLE: AvatarStyle = {
  initial: '?',
  bg: '#F1F5F9',
  fg: '#94A3B8',
  vacant: true,
};

export function getAvatar(name: string | null | undefined): AvatarStyle {
  if (!name || name.trim() === '') return VACANT_STYLE;
  const initial = Array.from(name.trim())[0];
  // djb2-style hash with better distribution
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.codePointAt(i)!;
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  const { bg, fg } = AVATAR_PALETTE[index];
  return { initial, bg, fg, vacant: false };
}
