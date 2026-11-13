/**
 * Плановый коридор: какая запись `reference.plan` описывает срез и как по ней
 * читается бейдж (`D-03`, `D-04`, `D-22`, `D-42`).
 *
 * Правило живёт здесь целиком, потому что его применяют и карточка канала, и
 * сегментные карточки: разъехавшись, они дали бы разный бейдж на одном числе.
 */

import { voc } from './metrics.js';
import { roundVoc } from './round.js';

export const IN_PLAN = 'in';
export const ABOVE_PLAN = 'above';
export const BELOW_PLAN = 'below';

/**
 * J-14: единый коридор канала применяется к любым его разрезам и фильтрам.
 * Исторические записи сегментов не заменяют запись канала.
 */
/**
 * Запись обязана покрывать выбранный период целиком: период, задевающий два
 * коридора, не описан ни одним из них.
 */
function recordFor(plans, channel, segment, from, to) {
  return plans.find(
    (plan) => plan?.channel === channel && (plan.segment ?? null) === segment && plan.period_from <= from && to <= plan.period_to,
  ) ?? null;
}

/* План ведётся на канал: сегмент и фильтры выбор записи не меняют (J-14) */
export function planFor(plans, { channel, from, to } = {}) {
  if (!Array.isArray(plans) || !channel || !from || !to) return null;
  return recordFor(plans, channel, null, from, to);
}

/**
 * Сравнение идёт по значению, округлённому до отображаемых знаков, границы
 * включительно (`D-22`). Границы округляются тем же правилом: подпись коридора
 * показывает их с двумя знаками, и сравнение с неокруглённой границей
 * противоречило бы собственной подписи.
 */
export function planStatus(value, plan) {
  const shown = roundVoc(value);
  const min = roundVoc(plan?.min);
  const max = roundVoc(plan?.max);
  if (shown === null || min === null || max === null) return null;

  if (shown < min) return BELOW_PLAN;
  return shown > max ? ABOVE_PLAN : IN_PLAN;
}

/**
 * J-85: сколько дней среза VOC дня был ниже, в коридоре и выше плана — по тому же
 * правилу, что бейдж. День без оценок или без плана не считается ни в какую сторону.
 */
export function planDays(ratings, plans, channel) {
  const byDay = new Map();
  for (const rating of ratings) {
    const day = byDay.get(rating.appeal_date);
    if (day) day.push(rating);
    else byDay.set(rating.appeal_date, [rating]);
  }
  const days = { [BELOW_PLAN]: 0, [IN_PLAN]: 0, [ABOVE_PLAN]: 0, total: 0 };
  for (const [date, rows] of byDay) {
    const status = planStatus(voc(rows), planFor(plans, { channel, from: date, to: date }));
    if (!status) continue;
    days[status] += 1;
    days.total += 1;
  }
  return days;
}

const GLOW_IN = 'in';
const GLOW_ABOVE = 'above';
export const GLOW_ABOVE_STRONG = 'above-strong';
const GLOW_BELOW = 'below';
export const GLOW_BELOW_STRONG = 'below-strong';

/**
 * J-67: уровень свечения карточки сегмента. «Сильно» — отклонение за границу
 * коридора больше его ширины: VOC < min − (max − min) или VOC > max + (max − min).
 * Сравнение — по тем же округлённым значениям и включительным границам, что и
 * `planStatus` (`D-22`). Коридор из одного числа ширины не имеет — «сильных»
 * уровней у него нет, иначе любое отклонение выглядело бы сильным.
 */
export function planGlow(value, plan) {
  const status = planStatus(value, plan);
  if (!status) return null;
  if (status === IN_PLAN) return GLOW_IN;
  const shown = roundVoc(value);
  const min = roundVoc(plan.min);
  const max = roundVoc(plan.max);
  const width = roundVoc(max - min);
  if (status === BELOW_PLAN) return width > 0 && roundVoc(min - shown) > width ? GLOW_BELOW_STRONG : GLOW_BELOW;
  return width > 0 && roundVoc(shown - max) > width ? GLOW_ABOVE_STRONG : GLOW_ABOVE;
}
