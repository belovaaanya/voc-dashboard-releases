import { addDays, dayCount, isoDate, parseIso } from './dates.js';
import { voc } from './metrics.js';
import { calendarRange } from './period.js';

export const SCALE_OPTIONS = [
  { value: 'day', label: 'Дни' },
  { value: 'week', label: 'Недели' },
  { value: 'month', label: 'Месяцы' },
  { value: 'quarter', label: 'Кварталы' },
];

const SCALES = new Set(SCALE_OPTIONS.map(({ value }) => value));

function minDate(left, right) {
  return left.getTime() <= right.getTime() ? left : right;
}

function naturalBucketEnd(start, scale) {
  if (scale === 'day') return start;
  if (scale === 'week') return addDays(start, (7 - start.getUTCDay()) % 7);
  return parseIso(calendarRange(scale, isoDate(start)).to);
}

function bucketsFor(period, scale) {
  if (!SCALES.has(scale)) throw new Error(`Неизвестный масштаб: ${scale}`);
  const first = parseIso(period.from);
  const last = parseIso(period.to);
  if (first > last) throw new Error(`Диапазон вывернут: ${period.from} … ${period.to}`);

  const buckets = [];
  let cursor = first;
  while (cursor <= last) {
    const end = minDate(naturalBucketEnd(cursor, scale), last);
    buckets.push({ from: isoDate(cursor), to: isoDate(end), ratings: [] });
    cursor = addDays(end, 1);
  }
  return buckets;
}

export function buildTimeSeries(ratings, period, scale = 'day') {
  const buckets = bucketsFor(period, scale);
  const bucketByDate = new Map();

  buckets.forEach((bucket, index) => {
    let cursor = parseIso(bucket.from);
    const end = parseIso(bucket.to);
    while (cursor <= end) {
      bucketByDate.set(isoDate(cursor), index);
      cursor = addDays(cursor, 1);
    }
  });

  for (const row of ratings) {
    const index = bucketByDate.get(row.appeal_date);
    if (index !== undefined) buckets[index].ratings.push(row);
  }

  return buckets.map(({ from, to, ratings: grouped }) => ({
    from,
    to,
    voc: voc(grouped),
    count: grouped.length,
  }));
}

/**
 * J-86: урон интервала — насколько VOC периода ниже того, каким он стал бы, если все
 * оценки интервала заменить пятёрками. Знак как у урона heatmap (D-46): VOC − VOC с пятёрками, не больше нуля.
 * В ряду VOC интервала неокруглённый: округлённый исказил бы сумму оценок.
 */
export function withDamage(series) {
  const total = series.reduce((sum, { count }) => sum + count, 0);
  const marks = series.reduce((sum, { voc: value, count }) => sum + (count ? value * count : 0), 0);
  return series.map((point) => {
    const damage = point.count ? ((point.voc - 5) * point.count) / total : null;
    return { ...point, damage, vocWithFives: point.count ? marks / total - damage : null };
  });
}

export function recommendedScale(period) {
  const days = dayCount(period);
  if (days <= 92) return 'day';
  if (days <= 366) return 'week';
  if (days <= 1096) return 'month';
  return 'quarter';
}

/* Больше точек на ширине sparkline сливаются в «пилу»: форма тренда теряется за дневным шумом (D-52) */
const SPARKLINE_MAX_POINTS = 16;

export function sparklineScale(period) {
  return SCALE_OPTIONS.map(({ value }) => value).find((scale) => bucketsFor(period, scale).length <= SPARKLINE_MAX_POINTS) ?? 'quarter';
}
