/*
  Единственный модуль форматирования на весь дашборд (D-20).
  Считаем в полной точности, округляем только при выводе (D-21).
*/

const NBSP = ' ';

const MINUS = '−';

const formatters = new Map();

function formatter(digits) {
  let cached = formatters.get(digits);
  if (!cached) {
    cached = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping: true,
    });
    formatters.set(digits, cached);
  }
  return cached;
}

/* Часть сборок ICU группирует ru-RU разряды узким пробелом U+202F — приводим к NBSP */
function withNbsp(text) {
  return text.replace(/[\s  ]/g, NBSP);
}

/* ru-RU в Intl ставит дефис-минус U+002D, в тексте нужен знак минус U+2212 (docs/ui-texts.md §9) */
export function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return withNbsp(formatter(digits).format(value)).replace(/^-/, MINUS);
}

export function formatVoc(value) {
  return formatNumber(value, 2);
}

export function formatDelta(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return sign + formatNumber(value, 2);
}

export function formatDeltaCount(value) {
  if (!Number.isFinite(value)) return '—';
  return (value > 0 ? '+' : '') + formatNumber(value, 0);
}

/** Изменение в процентах к прошлому значению: «−76 %», «+4 %»; целые проценты. */
export function formatDeltaPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatNumber(value, 0)}${NBSP}%`;
}

export function formatDeltaShare(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatNumber(value, 1)}${NBSP}п.${NBSP}п.`;
}

export function formatImpact(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatNumber(value, 3)}`;
}

export function formatSigned(value, digits) {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatNumber(value, digits)}`;
}

/*
  Предлог или союз из одной-двух букв не остаётся в конце строки статичного
  заголовка: пробел после него неразрывный (docs/ui-system.md §7).
  Вторая буква строчная — коды «ФО», «ОС» к следующему слову не привязываются
*/
export function bindShortWords(text) {
  return String(text).replace(/(?<![А-Яа-яЁё])([А-ЯЁа-яё][а-яё]?) (?=\S)/g, `$1${NBSP}`);
}

/* Цитата — в «ёлочках», кавычки внутри неё — „лапки“ (docs/ui-texts.md §10) */
export const quoted = (text) => `«${String(text).replaceAll('«', '„').replaceAll('»', '“')}»`;

export function formatCount(value) {
  return formatNumber(value, 0);
}

/** Форма существительного при числе: `[одна, две, пять]` — «оценка», «оценки», «оценок». */
export function plural(count, [one, few, many]) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

export function formatRatings(count) {
  return `${formatCount(count)}${NBSP}${plural(count, ['оценка', 'оценки', 'оценок'])}`;
}

/* Доли — один знак после запятой (D-40); пробел перед знаком процента неразрывный */
export function formatShare(value) {
  if (!Number.isFinite(value)) return '—';
  return `${formatNumber(value, 1)}${NBSP}%`;
}

/*
  Даты разбираем по частям строки: new Date('2026-05-12') — UTC-полночь, и в
  часовом поясе западнее Гринвича toLocale* отдаёт предыдущий день
*/
function parseIsoDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!match) return null;
  const [, year, month, day] = match;
  return { year, month, day };
}

export function formatDate(iso) {
  const parts = parseIsoDate(iso);
  if (!parts) return '—';
  return `${parts.day}.${parts.month}.${parts.year.slice(2)}`;
}

export const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** Месяц словом в именительном падеже: `2026-05` и `2026-05-31` — «май». */
export function monthName(iso) {
  const month = Number(String(iso).slice(5, 7));
  return MONTHS_FULL[month - 1] ?? '—';
}

const MONTHS_DATIVE = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
const QUARTERS = ['I', 'II', 'III', 'IV'];

/** Период «к чему»: месяц — «к октябрю», квартал — «к III кварталу»; год не пишется — сравнение всегда с соседним. */
export function formatPeriodDative(from, unit) {
  const parts = parseIsoDate(from);
  if (!parts) return '—';
  const month = Number(parts.month);
  if (unit === 'quarter') return `${QUARTERS[Math.floor((month - 1) / 3)]}${NBSP}кварталу`;
  return MONTHS_DATIVE[month - 1];
}

/** Интервал тренда одной подписью: месяц — «май 26», квартал — «II кв. 26», неделя — «неделя с 04.05.26». */
export function formatBucket(from, scale) {
  const parts = parseIsoDate(from);
  if (!parts) return '—';
  const year = parts.year.slice(2);
  const month = Number(parts.month);
  if (scale === 'quarter') return `${['I', 'II', 'III', 'IV'][Math.floor((month - 1) / 3)]} кв. ${year}`;
  if (scale === 'month') return `${MONTHS[month - 1]} ${year}`;
  return `неделя с ${formatDate(from)}`;
}

/* Диапазон — короткое тире без пробелов, как у дней серии ниже (docs/ui-texts.md §9) */
export function formatDateRange(from, to) {
  if (!from && !to) return '—';
  return `${formatDate(from)}–${formatDate(to)}`;
}

export function formatInterval({ from, to }) {
  return from === to ? formatDate(from) : formatDateRange(from, to);
}

/** Дни серии одной подписью (R-44): «19.05–21.05.26», через год — обе даты целиком. */
export function formatDayRange(from, to) {
  if (from === to) return formatDate(to);
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return '—';
  return start.year === end.year ? `${start.day}.${start.month}–${formatDate(to)}` : `${formatDate(from)}–${formatDate(to)}`;
}

export function formatBuildTime(isoTimestamp) {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${pad(parsed.getDate())}.${pad(parsed.getMonth() + 1)}.${String(parsed.getFullYear()).slice(2)}`;
  return `${date}, ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/** Время книги — wall clock: не зависит от часового пояса браузера. */
export function formatEventTime(iso) {
  const time = /T(\d{2}:\d{2})(?::(\d{2})(\.\d+)?)?/.exec(iso ?? '');
  if (!time) return formatDate(iso);
  const seconds = time[2] && (time[2] !== '00' || time[3]) ? `:${time[2]}${time[3] ?? ''}` : '';
  return `${formatDate(iso)} ${time[1]}${seconds}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const parts = [];
  let rest = Math.round(seconds * 1_000_000) / 1_000_000;
  for (const [size, unit] of [[86400, 'д'], [3600, 'ч'], [60, 'мин']]) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${formatCount(count)}${NBSP}${unit}`);
    rest = Math.round((rest - count * size) * 1_000_000) / 1_000_000;
  }
  if (rest || !parts.length) parts.push(`${(Number.isInteger(rest) ? formatNumber(rest) : formatNumber(rest, 6).replace(/0+$/, ''))}${NBSP}с`);
  return parts.join(NBSP);
}

/** J-25: короткая длительность для тега аварии; от часа минуты не выводятся. */
export function formatCompactDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds === 0) return `0${NBSP}мин`;
  if (seconds < 60) return `<1${NBSP}мин`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}${NBSP}мин`;
  const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600);
  return [days ? `${days}${NBSP}д` : null, hours ? `${hours}${NBSP}ч` : null].filter(Boolean).join(NBSP);
}
