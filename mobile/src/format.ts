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
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

export function fullTime(iso: string): string {
  return parse(iso).toLocaleString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
