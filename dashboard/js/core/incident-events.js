/** Интервалы аварий J-22. UTC служит только арифметике: время источника не сдвигается. */
import { daysBetween, shiftDay } from './dates.js';
import { normalizeLabel } from './labels.js';

function wallTime(iso) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(iso ?? '');
  if (!match) return null;
  const seconds = Date.parse(`${match[1]}Z`);
  return Number.isFinite(seconds) ? BigInt(seconds) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0')) : null;
}

/* J-108: Альфа-Мобайл — канал физических лиц: его аварии дашборд юрлиц не показывает. Альфа-Бизнес Мобайл — другой канал */
const RETAIL_CHANNEL = 'альфа мобайл';

export function isRetailIncident({ channel }) {
  return normalizeLabel(channel, { dashes: 'space' }) === RETAIL_CHANNEL;
}

export function incidentSpan(item) {
  if (!item.started_at && !item.ended_at) return { from: item.date, to: item.date, days: [item.date] };
  const start = wallTime(item.started_at), end = wallTime(item.ended_at);
  if (start === null || end === null || end < start) return null;
  const first = item.started_at.slice(0, 10);
  let last = item.ended_at.slice(0, 10);
  /* Конечная полночь завершает прошлый день; точечная авария остаётся на своей дате.
     Микросекунды сравниваем точно: Date.parse округляет их до миллисекунд. */
  if (/T00:00:00(?:\.0+)?$/.test(item.ended_at) && end > start) last = shiftDay(last, -1);
  const days = Array.from({ length: daysBetween(first, last) + 1 }, (_, index) => shiftDay(first, index));
  return { from: days[0], to: days.at(-1), days, started_at: item.started_at, ended_at: item.ended_at,
    duration_seconds: Number(end - start) / 1_000_000 };
}

/** J-25: доля затронутых × часы; 0 / 1 / 24 эквивалентных часа → светлый / оранжевый / красный.
 * Без длительности сохраняется прежняя шкала доли, без вымышленного времени. */
export function accidentColor(effect, durationSeconds) {
  const fraction = Number.isFinite(effect) ? Math.max(0, Math.min(1, effect)) : 1;
  const exposure = Number.isFinite(durationSeconds) && durationSeconds >= 0 ? fraction * durationSeconds / 3600 : null;
  const value = exposure === null ? Math.min(0.5, fraction)
    : exposure <= 1 ? exposure * 0.25 : 0.25 + Math.min(23, exposure - 1) * 0.25 / 23;
  const stops = [[219, 237, 153], [255, 147, 60], [255, 55, 107]];
  const index = value < 0.25 ? 0 : 1;
  const weight = (value - index * 0.25) / 0.25;
  return `#${stops[index].map((part, i) => Math.round(part + (stops[index + 1][i] - part) * weight).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Непрозрачный стабильный ключ: разные аварии с теми же днями имеют свой выбор.
 * В URL не попадают описание и исходные поля аварии. FNV-1a, 64 bit. */
export function accidentId(item) {
  const source = JSON.stringify([item.channel ?? null, item.started_at ?? item.date, item.ended_at ?? null,
    item.effect, item.product ?? null, item.description ?? null]);
  let hash = 0xcbf29ce484222325n;
  for (const char of new TextEncoder().encode(source)) hash = BigInt.asUintN(64, (hash ^ BigInt(char)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}
