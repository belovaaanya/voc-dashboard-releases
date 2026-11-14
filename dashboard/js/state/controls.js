import { customPeriod, resolvePreset } from '../core/period.js';

/*
  Выбор периода шапки (решение пользователя 14.11): три строки — «Быстро», «Месяцы», «Кварталы», в каждой три
  периода, новые слева. Быстрые окна кончаются последней датой выгрузки; прошлая неделя — последняя полная пн–вс.
  Подпись месяца и квартала — сам период («Октябрь», «Q3’26»), от последней даты выгрузки (D-41, J-61); незаконченный
  текущий период подписан «· по ДД.ММ». Прежние preset'ы (полгода, год, 365 дней, 5 лет) в меню не показываются,
  но старые ссылки с ними открываются (period.js)
*/
export const PERIOD_ROWS = [
  { label: 'Быстро', presets: [
    { value: 'days-7', kind: 'Последние 7 дней' },
    { value: 'days-30', kind: 'Последние 30 дней' },
    { value: 'previous-week', kind: 'Прошлая неделя' },
  ] },
  { label: 'Месяцы', presets: [
    { value: 'month', kind: 'Текущий месяц' },
    { value: 'previous-month', kind: 'Прошлый месяц' },
    { value: 'previous-month-2', kind: 'Позапрошлый месяц' },
  ] },
  { label: 'Кварталы', presets: [
    { value: 'quarter', kind: 'Текущий квартал' },
    { value: 'previous-quarter', kind: 'Прошлый квартал' },
    { value: 'previous-quarter-2', kind: 'Позапрошлый квартал' },
  ] },
];

export const PERIOD_PRESETS = PERIOD_ROWS.flatMap((row) => row.presets);

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_LOWER = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const QUICK_LABELS = { 'days-7': '7 дней', 'days-30': '30 дней', 'previous-week': 'Прошлая неделя' };
const shortYear = (year) => `’${String(year).slice(2)}`;
const isQuarter = (value) => value.includes('quarter');
const dayMonth = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Подпись шорткута: квартал с годом, месяц — с годом, только если он не год выгрузки; незаконченный — «· по ДД.ММ». */
export function presetLabel(value, manifestPeriod) {
  if (QUICK_LABELS[value]) return QUICK_LABELS[value];
  const period = periodForPreset(value, manifestPeriod);
  const year = Number(period.from.slice(0, 4));
  const month = Number(period.from.slice(5, 7)) - 1;
  const anchorYear = Number(manifestPeriod.to.slice(0, 4));
  const name = isQuarter(value) ? `Q${Math.floor(month / 3) + 1}${shortYear(year)}`
    : year === anchorYear ? MONTHS[month] : `${MONTHS[month]}${shortYear(year)}`;
  return period.complete === false ? `${name} · по ${dayMonth(period.to)}` : name;
}

/** Имя для screen reader: вид шорткута и полный период — «Текущий квартал: Q4 2026, по 09.11.2026». */
export function presetName(value, manifestPeriod) {
  const preset = PERIOD_PRESETS.find((item) => item.value === value);
  const period = periodForPreset(value, manifestPeriod);
  const { from, to } = period;
  if (QUICK_LABELS[value]) return `${preset.kind}: ${dayMonth(from)}–${dayMonth(to)}.${to.slice(0, 4)}`;
  const year = from.slice(0, 4);
  const month = Number(from.slice(5, 7)) - 1;
  const full = isQuarter(value) ? `Q${Math.floor(month / 3) + 1} ${year}` : `${MONTHS_LOWER[month]} ${year}`;
  return period.complete === false ? `${preset.kind}: ${full}, по ${dayMonth(to)}.${to.slice(0, 4)}` : `${preset.kind}: ${full}`;
}

/** Есть ли в выгрузке хоть одна дата периода: период целиком вне выгрузки в меню недоступен. */
export function presetHasData(value, manifestPeriod) {
  const { from, to } = periodForPreset(value, manifestPeriod);
  return (!manifestPeriod.from || to >= manifestPeriod.from) && from <= manifestPeriod.to;
}

export function periodForPreset(preset, manifestPeriod) {
  if (!manifestPeriod?.to) throw new Error('Манифест не содержит period.to');
  return resolvePreset(preset, manifestPeriod.to);
}

export function periodFromState(state, fallbackPeriod, manifestPeriod) {
  if (!state.from || !state.to) return fallbackPeriod;

  if (PERIOD_PRESETS.some(({ value }) => value === state.preset)) {
    const presetPeriod = periodForPreset(state.preset, manifestPeriod);
    if (presetPeriod.from === state.from && presetPeriod.to === state.to) return presetPeriod;
  }

  return customPeriod(state.from, state.to);
}

export function validateCustomPeriod(from, to) {
  if (!from || !to) return { period: null, error: 'Выберите начало и конец периода' };
  if (from > to) return { period: null, error: 'Начало периода должно быть не позже конца' };

  try {
    return { period: customPeriod(from, to), error: null };
  } catch {
    return { period: null, error: 'Введите корректные даты' };
  }
}

export function toggleSelectedValue(selected, value) {
  return selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
}
