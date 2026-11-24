import { currentLang, say } from './lang';

/**
 * The API sends UTC timestamps, but SQLite hands them back without a zone
 * marker. `new Date("2026-10-07T04:00:00")` would then be read as local time,
 * so a Malaysian phone would show every alert eight hours off. Treat a bare
 * timestamp as UTC.
 */
function parse(iso: string): Date {
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(iso);
  return new Date(hasZone ? iso : `${iso}Z`);
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - parse(iso).getTime()) / 1000);
  if (seconds < 60) return say('baru sahaja', 'just now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return say(`${minutes} minit lalu`, `${minutes} min ago`);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return say(`${hours} jam lalu`, `${hours} h ago`);
  const days = Math.floor(hours / 24);
  return say(`${days} hari lalu`, `${days} d ago`);
}

export function fullTime(iso: string): string {
  return parse(iso).toLocaleString(currentLang() === 'en' ? 'en-MY' : 'ms-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Hari ini", "Semalam", or the date, as it is in Malaysia. */
export function dayName(iso: string): string {
  const day = (ms: number) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const then = parse(iso).getTime();
  if (day(then) === day(Date.now())) return say('Hari ini', 'Today');
  if (day(then) === day(Date.now() - 86400000)) return say('Semalam', 'Yesterday');
  const [y, m, d] = day(then).split('-').map(Number);
  const months = say(
    'Januari Februari Mac April Mei Jun Julai Ogos September Oktober November Disember',
    'January February March April May June July August September October November December',
  ).split(' ');
  return `${d} ${months[m - 1]} ${y}`;
}

/**
 * Turns what a person typed into an exact amount, or null.
 *
 * parseFloat reads "1,000" as 1, so it must never be used on typed money.
 * The text goes to the server as is, without passing through floating point.
 */
export function parseMoney(typed: string): string | null {
  const t = typed.trim().replace(/^rm\s*/i, '');
  if (!/^(\d{1,9}|\d{1,3}(,\d{3}){1,2})(\.\d{1,2})?$/.test(t)) return null;
  return t.replace(/,/g, '');
}
