/**
 * Статистика обзвона по месяцам («Для аналитика», неделя 16–22.11).
 *
 * Прямого поля «звонок» в выгрузке нет: попытка звонка — приближение по экспертизе УИУКО (`oslk_expertise_name`,
 * D-05). Успешный звонок — экспертиза с установленной причиной, по тому же правилу, что `has_feedback` по экспертизе
 * (`docs/data-model.md`, J-24, J-134); экспертиза «Выявить / выяснить причину снижения не удалось…» — недозвон или
 * отказ от ОС, одной фразой их не различить. Обзвон — по сниженным оценкам 1–3: доля попыток считается от них.
 * Экспертиза есть только в lazy `verbatim`, основной JSON её не содержит.
 */

import { isoDate, parseIso } from './dates.js';
import { isNoReasonExpertise, normalizeExpertise, validateVerbatim } from './verbatim.js';

/** Сниженная оценка — 1–3: та же граница, что у «Конверсии опроса» и доли с обратной связью. */
const NEGATIVE_MAX = 3;

/** Колонки таблицы: `share` — доля строки от колонки `of`, в процентах. */
export const CALL_COLUMNS = [
  { key: 'rated', label: 'Оценки', full: 'все оценки среза' },
  { key: 'negative', label: '1–3', full: 'сниженные оценки' },
  { key: 'attempts', label: 'Попытки звонка', full: 'сниженные оценки с экспертизой УИУКО; поля «звонок» в выгрузке нет — попытка определяется по экспертизе' },
  { key: 'attemptShare', label: 'Попытки от 1–3', share: { part: 'attempts', of: 'negative' } },
  { key: 'success', label: 'Успешные звонки', full: 'экспертиза с установленной причиной снижения' },
  { key: 'successShare', label: 'Успешные от попыток', share: { part: 'success', of: 'attempts' } },
  { key: 'failed', label: 'Недозвон или отказ', full: 'экспертиза «выявить / выяснить причину снижения не удалось»: недозвон и отказ этой фразой не различить' },
];

/** Исход обзвона оценки по тексту экспертизы: нет экспертизы — `null`. */
export function callOutcome(expertise) {
  const text = normalizeExpertise(expertise);
  if (!text) return null;
  return isNoReasonExpertise(text) ? 'failed' : 'success';
}

const monthEnd = (from) => {
  const start = parseIso(from);
  return isoDate(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)));
};

/**
 * Календарные месяцы периода `{ from, to }`, обрезанные его краями и диапазоном выгрузки `data` (`{ from, to }`): месяц,
 * который выгрузка не покрывает до конца, — незаконченный, его конец — последний день данных; месяцев до начала данных
 * нет. `partial` — месяц не целиком.
 */
export function periodMonths(period, data = period) {
  const first = data.from && data.from > period.from ? data.from : period.from;
  const last = data.to && data.to < period.to ? data.to : period.to;
  const months = [];
  for (let start = `${first.slice(0, 7)}-01`; start <= last; start = isoDate(new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 1)))) {
    const end = monthEnd(start);
    const range = { month: start.slice(0, 7), from: start < first ? first : start, to: end > last ? last : end };
    months.push({ ...range, partial: range.from !== start || range.to !== end });
  }
  return months;
}

const shareOf = (part, whole) => (whole > 0 ? (part * 100) / whole : null);

function counted(rows, items) {
  const counts = { rated: rows.length, negative: 0, attempts: 0, success: 0, failed: 0 };
  for (const row of rows) {
    if (!(row.mark >= 1 && row.mark <= NEGATIVE_MAX)) continue;
    counts.negative += 1;
    const outcome = callOutcome(items[row.voc_ccode]?.oslk_expertise_name);
    if (!outcome) continue;
    counts.attempts += 1;
    counts[outcome] += 1;
  }
  for (const column of CALL_COLUMNS) {
    if (column.share) counts[column.key] = shareOf(counts[column.share.part], counts[column.share.of]);
  }
  return counts;
}

/**
 * Строки таблицы: месяц периода и итог за период. `rows` — срез шапки (канал, сегмент, триггеры, кэшбек уже применены),
 * `verbatim` — lazy-файл текстов, `data` — диапазон выгрузки `{ from, to }`. Доли — полной точности, `null` при пустой базе; округление на выводе (D-21).
 */
export function callStats(rows, verbatim, period, data = period) {
  const items = validateVerbatim(verbatim);
  const months = periodMonths(period, data).map((month) => ({
    ...month,
    ...counted(rows.filter((row) => row.appeal_date >= month.from && row.appeal_date <= month.to), items),
  }));
  const inside = rows.filter((row) => row.appeal_date >= period.from && row.appeal_date <= period.to);
  return { months, total: counted(inside, items) };
}

/** Месяц воронки по умолчанию: последний, который выгрузка покрывает до конца; полного нет — последний. */
export function defaultCallMonth(months) {
  const whole = months.filter((month) => month.to === monthEnd(`${month.month}-01`));
  return (whole.at(-1) ?? months.at(-1))?.month ?? null;
}

/**
 * Ступени воронки месяца: оценки → 1–3 → попытки → успешные; `share` — доля от предыдущей ступени, у оценок — база
 * 100 %. `branch` — «недозвон или отказ», доля от попыток: ответвление, а не ступень — успех и он вместе дают попытки.
 */
export function callFunnel(month) {
  const steps = [
    { key: 'rated', count: month.rated, share: month.rated > 0 ? 100 : null },
    { key: 'negative', count: month.negative, share: shareOf(month.negative, month.rated) },
    { key: 'attempts', count: month.attempts, share: month.attemptShare },
    { key: 'success', count: month.success, share: month.successShare },
  ];
  return { steps, branch: { key: 'failed', count: month.failed, share: shareOf(month.failed, month.attempts) } };
}
