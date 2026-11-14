/**
 * Прогноз числа оценок незаконченного месяца или квартала по темпу: оценки ÷ прошедшие дни × дни периода.
 *
 * Незаконченный период сравнивается с прошлым целиком (J-85): за 13 дней ноября оценок, конечно, меньше, чем
 * за весь октябрь, и дельта числа оценок сама по себе пугает. Прогноз отвечает на вопрос «а к концу периода?».
 * Полный период и произвольный диапазон прогноза не имеют: они уже закончились.
 */

import { dayCount } from './dates.js';
import { calendarRange, previousPeriod } from './period.js';

/* Прогноз — только у календарных блоков, которые идут сейчас; у полугодия и года темп первых недель случаен */
export const FORECAST_PRESETS = ['month', 'quarter'];

/**
 * `{ forecast, change, elapsed, total, unit, previous }` или null. `previousCount` — оценки прошлого периода
 * целиком (`previous` — его границы); без него `change` — null. Значения не округлены: округляет вывод (D-21).
 */
export function ratingsForecast(count, period, previousCount = null) {
  if (!period?.from || !period?.to || period.complete !== false || !FORECAST_PRESETS.includes(period.preset)) return null;
  const full = calendarRange(period.preset, period.from);
  const elapsed = dayCount(period);
  const total = dayCount(full);
  if (elapsed < 1 || elapsed >= total) return null;
  const forecast = (count / elapsed) * total;
  return {
    forecast,
    change: previousCount ? forecast - previousCount : null,
    elapsed,
    total,
    unit: period.preset,
    previous: previousPeriod(period),
  };
}
