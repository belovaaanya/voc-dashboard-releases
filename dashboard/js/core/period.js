/**
 * Периоды дашборда: preset → диапазон дат и «предыдущий аналогичный» (`D-23`, `J-85`).
 *
 * Диапазон — включительно с обеих сторон, даты — ISO `YYYY-MM-DD` в UTC:
 * дашборд сравнивает календарные сутки, а не моменты времени.
 */

import { addDays, dayCount, earliestDate, isoDate, parseIso } from './dates.js';

export const PRESETS = [
  'month',
  'previous-month',
  'quarter',
  'previous-quarter',
  'half-year',
  'calendar-year',
  'days-365',
  'years-5',
];

const ROLLING_DAYS = { 'days-365': 365 };

/** Границы календарного периода preset'а, внутрь которого попадает `date`. */
const CALENDAR_BOUNDS = {
  month: (year, month) => [[year, month, 1], [year, month + 1, 0]],
  /* J-61: прошлый месяц и квартал — полный блок перед тем, в который попадает дата */
  'previous-month': (year, month) => [[year, month - 1, 1], [year, month, 0]],
  quarter: (year, month) => [[year, month - (month % 3), 1], [year, month - (month % 3) + 3, 0]],
  'previous-quarter': (year, month) => [[year, month - (month % 3) - 3, 1], [year, month - (month % 3), 0]],
  'half-year': (year, month) =>
    month < 6 ? [[year, 0, 1], [year, 6, 0]] : [[year, 6, 1], [year, 12, 0]],
  'calendar-year': (year) => [[year, 0, 1], [year, 12, 0]],
  'years-5': (year) => [[year - 4, 0, 1], [year, 12, 0]],
};

/**
 * Сдвиг назад по `from`, а не по длине блока: `CALENDAR_BOUNDS` разворачивает
 * год в блок сам, поэтому для `years-5` шаг — год, а не пятилетие.
 */
const CALENDAR_STEP = {
  month: { months: 1 },
  'previous-month': { months: 1 },
  quarter: { months: 3 },
  'previous-quarter': { months: 3 },
  'half-year': { months: 6 },
  'calendar-year': { months: 12 },
  'years-5': { months: 12 },
};

/** Календарный блок preset'а целиком, без обрезки по сегодня: месяц, квартал, полугодие, год. */
export function calendarRange(preset, date) {
  const bounds = CALENDAR_BOUNDS[preset];
  if (!bounds) throw new Error(`Неизвестный preset периода: ${preset}`);
  const day = parseIso(date);
  const [start, end] = bounds(day.getUTCFullYear(), day.getUTCMonth()).map(fromParts);
  return { from: isoDate(start), to: isoDate(end) };
}

export function resolvePreset(preset, today) {
  const rollingDays = ROLLING_DAYS[preset];
  if (rollingDays) {
    return {
      preset,
      from: isoDate(addDays(parseIso(today), 1 - rollingDays)),
      to: normalize(today),
      complete: true,
    };
  }

  const { from, to } = calendarRange(preset, today);
  const complete = today >= to;

  return { preset, from, to: complete ? to : today, complete };
}

export function customPeriod(from, to) {
  const start = normalize(from);
  const end = normalize(to);
  if (start > end) throw new Error(`Диапазон вывернут: ${from} … ${to}`);

  return { preset: 'custom', from: start, to: end, complete: true };
}

/**
 * Возвращает период той же формы, что `resolvePreset`: результат сам является
 * периодом, поэтому «май → апрель → март» — это повторный вызов, а не потеря
 * календарной семантики.
 */
export function previousPeriod(period) {
  const step = CALENDAR_STEP[period.preset];
  if (!step) return precedingRange(period);

  // J-85 (отменяет D-24): неполный период сравнивается с предыдущим целиком.
  return { preset: period.preset, ...shiftCalendarBlock(period.preset, period.from, step.months), complete: true };
}

function precedingRange(period) {
  const to = addDays(parseIso(period.from), -1);
  return {
    preset: period.preset,
    from: isoDate(addDays(to, 1 - dayCount(period))),
    to: isoDate(to),
    complete: true,
  };
}

const BLOCK_OF = { 'previous-month': 'month', 'previous-quarter': 'quarter' };

function shiftCalendarBlock(preset, from, months) {
  const start = parseIso(from);
  const shifted = fromParts([
    start.getUTCFullYear(),
    start.getUTCMonth() - months,
    1,
  ]);
  /* Прошлый месяц/квартал сдвигается как свой блок: bounds «предыдущего» от сдвинутой даты ушли бы на шаг дальше */
  const [previousStart, previousEnd] = CALENDAR_BOUNDS[BLOCK_OF[preset] ?? preset](
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
  ).map(fromParts);

  return { from: isoDate(previousStart), to: isoDate(previousEnd) };
}

function fromParts([year, month, day]) {
  return new Date(Date.UTC(year, month, day));
}

function normalize(value) {
  return isoDate(parseIso(value));
}

/**
 * Период по умолчанию берётся из выгрузки, а не из часов машины (`D-41`): на
 * фиксированных датах сэмпла «по сегодня» дало бы пустой дашборд при первой же
 * загрузке.
 *
 * Месяц раскрывается здесь, а не читается из `period.current`: строка
 * `YYYY-MM` не знает последней оценки, по которой месяц обрезан. Расхождение двух полей манифеста — ошибка
 * сборки, а не повод молча выбрать одно из них.
 */
export function defaultPeriod({ to, current } = {}) {
  const period = resolvePreset('month', to);
  if (current && period.from.slice(0, 7) !== current) {
    throw new Error(`Манифест противоречив: period.current ${current}, последняя оценка ${to}`);
  }
  return period;
}

/**
 * J-37: подпись базы сравнения не шире данных. Прошлый период, начатый до
 * первой оценки, сравнивается только с днями, где оценки есть, — так его и
 * подписываем. Без строк период возвращается как есть.
 */
/**
 * J-65: база дельт карточек метрик — по оценкам канала за прошлый период, а не по срезу
 * с фильтром сегмента: сегментные карточки сравнивают без этого фильтра (D-43)
 */
export function metricsBase(period, rows) {
  if (!period || !rows?.some(({ appeal_date: date }) => date >= period.from && date <= period.to)) return null;
  return comparedPeriod(period, rows);
}

export function comparedPeriod(period, rows) {
  if (!period || !rows?.length) return period;
  const first = earliestDate(rows);
  return first && period.from < first && first <= period.to ? { ...period, from: first } : period;
}
