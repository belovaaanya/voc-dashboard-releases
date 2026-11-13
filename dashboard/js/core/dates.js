/** Календарные даты дашборда — ISO `YYYY-MM-DD` в UTC: сравниваются сутки, а не моменты времени. */

export const MS_PER_DAY = 86_400_000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const timeOf = (value) => Date.parse(`${value}T00:00:00Z`);

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/** `Date` докручивает 30 февраля до марта, поэтому мало проверить разбор: дата обязана вернуться той же строкой. */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const time = timeOf(value);
  return Number.isFinite(time) && isoDate(new Date(time)) === value;
}

export function parseIso(value) {
  if (!isIsoDate(value)) throw new Error(`Не дата: ${value}`);
  return new Date(timeOf(value));
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Сдвиг уже проверенной ISO-даты; горячие циклы окон аномалий не разбирают её заново регуляркой. */
export function shiftDay(value, days) {
  return isoDate(new Date(timeOf(value) + days * MS_PER_DAY));
}

/** 0 — воскресенье, как `getUTCDay`. */
export function weekdayOf(value) {
  return new Date(timeOf(value)).getUTCDay();
}

export function daysBetween(from, to) {
  return Math.round((timeOf(to) - timeOf(from)) / MS_PER_DAY);
}

export function dayCount({ from, to }) {
  return daysBetween(from, to) + 1;
}

/** Первая и последняя дата оценок; `''` — оценок с датой нет. */
export function earliestDate(rows) {
  return memoized(earliestByRows, rows, () => rows.reduce((min, { appeal_date: date }) => (typeof date === 'string' && date && (min === '' || date < min) ? date : min), ''));
}

export function latestDate(rows) {
  return memoized(latestByRows, rows, () => rows.reduce((max, { appeal_date: date }) => (date > max ? date : max), ''));
}

/* Массив строк после сборки не меняется: границы истории на каждом кадре drag не пересчитываются; длина — страховка */
const earliestByRows = new WeakMap();
const latestByRows = new WeakMap();

function memoized(cache, rows, compute) {
  const known = cache.get(rows);
  if (known && known.length === rows.length) return known.value;
  const value = compute();
  cache.set(rows, { length: rows.length, value });
  return value;
}
