import { customPeriod, resolvePreset } from '../core/period.js';

/*
  J-61: шорткаты периода — текущий и прошлый квартал, текущий и прошлый месяц. Подпись — сам период
  («Q4’26», «Октябрь»), от последней даты выгрузки, как и сами диапазоны (D-41). Прежние preset'ы
  (полгода, год, 365 дней, 5 лет) из меню убраны, но старые ссылки с ними открываются (period.js)
*/
export const PERIOD_PRESETS = [
  { value: 'quarter', kind: 'Текущий квартал' },
  { value: 'previous-quarter', kind: 'Прошлый квартал' },
  { value: 'month', kind: 'Текущий месяц' },
  { value: 'previous-month', kind: 'Прошлый месяц' },
];

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_LOWER = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const shortYear = (year) => `’${String(year).slice(2)}`;

/** Подпись шорткута: квартал всегда с годом, месяц — с годом, только если он не год выгрузки. */
export function presetLabel(value, manifestPeriod) {
  const { from } = periodForPreset(value, manifestPeriod);
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7)) - 1;
  if (value === 'quarter' || value === 'previous-quarter') return `Q${Math.floor(month / 3) + 1}${shortYear(year)}`;
  const anchorYear = Number(manifestPeriod.to.slice(0, 4));
  return year === anchorYear ? MONTHS[month] : `${MONTHS[month]}${shortYear(year)}`;
}

/** Имя для screen reader: вид шорткута и полный период — «Текущий квартал: Q4 2026». */
export function presetName(value, manifestPeriod) {
  const preset = PERIOD_PRESETS.find((item) => item.value === value);
  const { from } = periodForPreset(value, manifestPeriod);
  const year = from.slice(0, 4);
  const month = Number(from.slice(5, 7)) - 1;
  const full = value.endsWith('quarter') ? `Q${Math.floor(month / 3) + 1} ${year}` : `${MONTHS_LOWER[month]} ${year}`;
  return `${preset.kind}: ${full}`;
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
