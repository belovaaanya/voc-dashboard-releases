/**
 * Мини-тренд VOC сегмента (просьба пользователя): три точки по шагу выбранного периода, последняя — выбранный.
 * Целый месяц — три месяца, целый квартал — три квартала, иначе — три недели (пн–вс), последняя содержит конец
 * периода. Подписи коротко: «сен · окт · ноя», «Q2 · Q3 · Q4», недели — датой понедельника «03.11».
 * Методика — `docs/blocks-metrics.md`.
 */

import { addDays, isoDate, parseIso, weekdayOf } from './dates.js';
import { trendOf, voc } from './metrics.js';
import { roundDelta } from './round.js';

/** Точек тренда: подписи значений над каждой помещаются в карточке сегмента на 1280–1600. */
export const TREND_POINTS = 3;

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const pad = (value) => String(value).padStart(2, '0');

function monthBounds(year, month) {
  return { from: isoDate(new Date(Date.UTC(year, month, 1))), to: isoDate(new Date(Date.UTC(year, month + 1, 0))) };
}

/** Шаг периода: `month` — целый месяц, `quarter` — целый квартал, иначе `week`. */
export function trendStep(period) {
  if (!period?.from || !period?.to) return null;
  const start = parseIso(period.from);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  if (period.from === monthBounds(year, month).from && period.to === monthBounds(year, month).to) return 'month';
  if (month % 3 === 0 && period.from === monthBounds(year, month).from && period.to === monthBounds(year, month + 2).to) return 'quarter';
  return 'week';
}

/** Шаги тренда по времени слева направо: `{ from, to, label }`, последний — выбранный период или неделя его конца. */
export function trendSteps(period, count = TREND_POINTS) {
  const step = trendStep(period);
  if (!step) return [];
  const steps = [];
  if (step === 'month' || step === 'quarter') {
    const size = step === 'month' ? 1 : 3;
    const start = parseIso(period.from);
    for (let index = count - 1; index >= 0; index -= 1) {
      const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - index * size, 1));
      const bounds = { from: isoDate(first), to: monthBounds(first.getUTCFullYear(), first.getUTCMonth() + size - 1).to };
      const label = step === 'month' ? MONTHS[first.getUTCMonth()] : `Q${Math.floor(first.getUTCMonth() / 3) + 1}`;
      steps.push({ ...bounds, label });
    }
    return steps;
  }
  const end = parseIso(period.to);
  const monday = addDays(end, -((weekdayOf(period.to) + 6) % 7));
  for (let index = count - 1; index >= 0; index -= 1) {
    const from = addDays(monday, -7 * index);
    steps.push({ from: isoDate(from), to: isoDate(addDays(from, 6)), label: `${pad(from.getUTCDate())}.${pad(from.getUTCMonth() + 1)}` });
  }
  return steps;
}

/** VOC сегмента по шагам: `null` — в шаге нет оценок (разрыв линии, без подписи). */
export function trendValues(rows, steps) {
  return steps.map(({ from, to }) => voc(rows.filter(({ appeal_date: date }) => date >= from && date <= to)));
}

/**
 * Направление тренда — по первой и последней точке с оценками (не по плану): последняя ниже — `down`, выше — `up`,
 * изменение меньше 0,01 после округления, как у дельты VOC (D-22), — `flat`. Меньше двух точек — null.
 */
export function trendDirection(values) {
  const shown = values.filter((value) => value !== null);
  if (shown.length < 2) return null;
  return trendOf(roundDelta(shown.at(-1) - shown[0]));
}
