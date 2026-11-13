/**
 * Округление на выводе (`D-21`): считаем в полной точности, округляем здесь.
 *
 * Это только числа. Строки — запятая, неразрывный пробел, `ru-RU` — дело
 * функции форматирования (`D-20`), и смешивать их нельзя: округлённое число
 * ещё участвует в сравнениях (например, бейдж плана в `D-22`), а строка уже нет.
 */

const VOC_DIGITS = 2;
const DELTA_DIGITS = 2;
const IMPACT_DIGITS = 3;
const COUNT_DIGITS = 0;
const SHARE_DIGITS = 1;
const FREQUENCY_DIGITS = 1;
const DEVIATION_DIGITS = 1;
const SUM_EPSILON = 1e-8;
const REMAINDER_EPSILON = 1e-9;

export function roundVoc(value) {
  return round(value, VOC_DIGITS);
}

export function roundDelta(value) {
  return round(value, DELTA_DIGITS);
}

export function roundImpact(value) {
  return round(value, IMPACT_DIGITS);
}

export function roundCount(value) {
  return round(value, COUNT_DIGITS);
}

/** Доли — один знак (`D-40`), и дельта доли показывается с той же точностью. */
export function roundShare(value) {
  return round(value, SHARE_DIGITS);
}

/** Среднее и разброс числа упоминаний за окно аномалий (`D-47`). */
export function roundFrequency(value) {
  return round(value, FREQUENCY_DIGITS);
}

/** Отклонение от среднего окна в стандартных отклонениях (`D-47`). */
export function roundDeviation(value) {
  return round(value, DEVIATION_DIGITS);
}

/** Доли распределения — десятые, сумма ровно `100` по методу наибольшего остатка (`D-40`). */
export function roundShares(shares, weights = null) {
  if (shares.length === 0) return [];
  if (shares.some((share) => share === null || share === undefined)) {
    return shares.map(() => null);
  }
  if (weights && (weights.length !== shares.length || weights.some((weight) => !Number.isFinite(weight)))) {
    throw new Error('Веса распределения не соответствуют долям');
  }

  const exact = shares.reduce((sum, share) => sum + share, 0);
  if (Math.abs(exact - 100) > SUM_EPSILON) {
    throw new Error(`Доли не дают 100 и раздать нечего: ${exact}`);
  }

  const scale = 10 ** SHARE_DIGITS;
  const totalUnits = 100 * scale;
  const units = shares.map((share) => Math.floor(share * scale));
  const spare = totalUnits - units.reduce((sum, share) => sum + share, 0);
  const byRemainder = shares
    .map((share, index) => ({ index, remainder: share * scale - Math.floor(share * scale) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  if (spare > 0) {
    const cutoff = byRemainder[spare - 1].remainder;
    const certain = byRemainder.filter(({ remainder }) => remainder > cutoff + REMAINDER_EPSILON);
    const tied = byRemainder.filter(({ remainder }) => Math.abs(remainder - cutoff) <= REMAINDER_EPSILON);
    for (const { index } of certain) units[index] += 1;

    const needed = spare - certain.length;
    const chosen = weights
      ? closestWeightedChoice(tied, needed, units, shares, weights, scale)
      : tied.slice(0, needed);
    for (const { index } of chosen) units[index] += 1;
  }

  return units.map((share) => share / scale);
}

function closestWeightedChoice(entries, needed, units, shares, weights, scale) {
  const target = shares.reduce((sum, share, index) => sum + share * scale * weights[index], 0);
  const base = units.reduce((sum, unit, index) => sum + unit * weights[index], 0);
  let best = null;

  function visit(start, chosen, weight) {
    if (chosen.length === needed) {
      const score = Math.abs(base + weight - target);
      if (!best || score < best.score - REMAINDER_EPSILON) best = { chosen: [...chosen], score };
      return;
    }
    for (let index = start; index <= entries.length - (needed - chosen.length); index += 1) {
      const entry = entries[index];
      chosen.push(entry);
      visit(index + 1, chosen, weight + weights[entry.index]);
      chosen.pop();
    }
  }

  visit(0, [], 0);
  return best?.chosen ?? [];
}

function round(value, digits) {
  // round — последняя остановка перед DOM, поэтому NaN гасится здесь, а не на экране.
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  // toFixed не добавляет своего шага умножения на 10^n, в отличие от Math.round.
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
}
