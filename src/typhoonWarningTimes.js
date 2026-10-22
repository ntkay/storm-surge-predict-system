// CWA land-typhoon-warning issue times. These establish the first forecast
// issue time shown for each held-out historical storm (Taiwan time, UTC+8).
export const landWarningTimes = Object.freeze({
  haitang: '2005-07-16T23:30:00+08:00',
  talim: '2005-08-30T20:30:00+08:00',
  kaemi: '2006-07-23T23:30:00+08:00',
  sinlaku: '2008-09-12T05:30:00+08:00',
  jangmi: '2008-09-27T08:30:00+08:00',
  'kong-rey': '2013-08-28T11:30:00+08:00',
});

export function parseTaiwanTime(value) {
  const text = String(value || '');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}+08:00`);
}

export function sixHourTicks(start, end) {
  const step = 6 * 60 * 60 * 1000;
  return Array.from(
    { length: Math.floor((end - start) / step) + 1 },
    (_, index) => new Date(start + index * step).toISOString(),
  );
}
