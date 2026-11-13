/**
 * Критическое снижение VOC в календаре (`D-62`): день сравнивается с оценками окна, а не со
 * средним ± σ дневных значений. Почему и какие пороги — `docs/calc-core.md`.
 */

import { ANOMALY_MIN_WINDOW_VALUES, ANOMALY_WINDOW_DAYS, BELOW } from './anomalies.js';
import { MARKS } from './metrics.js';

/** Падение случайно, если такое или большее встречается чаще одного дня из ста. */
export const CRITICAL_DROP_ALPHA = 0.01;
/** Одностороннее нормальное значение для той же вероятности: падение сверяется с ним при любом объёме дня. */
export const CRITICAL_DROP_Z = 2.326;
/** Падение к среднему окна, меньше которого снижение не показывается, каким бы значимым ни было. */
export const CRITICAL_DROP_MIN = 0.1;
/** Меньше оценок в окне — распределение окна не на что опереть. */
export const CRITICAL_DROP_MIN_WINDOW_RATINGS = 30;
/** До стольких оценок дня включительно вероятность дополнительно считается точно: у малых дней нормальное приближение врёт. */
export const CRITICAL_DROP_EXACT_RATINGS = 300;

/** Серия отмеченных дней от такой длины — событие, а не обычный разброс разреза. */
export const CRITICAL_DROP_EVENT_DAYS = 3;

const EPSILON = 1e-9;
const TOP_MARK = MARKS.at(-1);
/* Сглаживание Джеффриса: окно из одних пятёрок не делает другие оценки невозможными */
const SMOOTHING = 0.5;

function smoothedShares(counts, total) {
  const denominator = total + SMOOTHING * MARKS.length;
  return MARKS.map((mark) => ({ loss: TOP_MARK - mark, share: (counts[mark] + SMOOTHING) / denominator }));
}

/**
 * Вероятность за день из `n` оценок при распределении окна потерять до пятёрок не меньше,
 * чем `lost` баллов: свёртка распределения, без случайности и без нормального приближения.
 */
export function dropTail(windowCounts, windowRatings, n, lost) {
  if (lost <= 0) return 1;
  const shares = smoothedShares(windowCounts, windowRatings);
  let below = new Float64Array(lost);
  below[0] = 1;
  for (let rating = 0; rating < n; rating += 1) {
    const next = new Float64Array(lost);
    for (let sum = 0; sum < lost; sum += 1) {
      if (below[sum] === 0) continue;
      for (const { loss, share } of shares) {
        if (sum + loss < lost) next[sum + loss] += below[sum] * share;
      }
    }
    below = next;
  }
  return Math.max(0, 1 - below.reduce((total, value) => total + value, 0));
}

function windowOf(history) {
  const counts = Object.fromEntries(MARKS.map((mark) => [mark, 0]));
  let ratings = 0;
  let sum = 0;
  for (const day of history) {
    ratings += day.n;
    sum += day.mean * day.n;
    for (const mark of MARKS) counts[mark] += day.counts[mark];
  }
  const mean = sum / ratings;
  const spread = MARKS.reduce((total, mark) => total + counts[mark] * (mark - mean) ** 2, 0) / Math.max(1, ratings - 1);
  return { counts, ratings, mean, variance: Math.max(spread, smoothedVariance(counts, ratings)) };
}

/* Дисперсия по сглаженным долям — нижняя граница: малое окно без редких оценок занижает разброс, а без разброса большой день не с чем сравнить */
function smoothedVariance(counts, ratings) {
  const shares = smoothedShares(counts, ratings);
  const meanLoss = shares.reduce((total, { loss, share }) => total + loss * share, 0);
  return shares.reduce((total, { loss, share }) => total + share * (loss - meanLoss) ** 2, 0);
}

/**
 * Разброс дней окна сверх случайного (метод моментов). Идущая сейчас серия снижения в оценку не
 * входит: иначе первые дни аварии выдают себя за обычный разброс и прячут следующие.
 */
function betweenDayVariance(ordinary, base) {
  if (ordinary.length < 2) return 0;
  const weights = ordinary.map(({ n }) => n / base.variance);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const center = ordinary.reduce((sum, { mean }, index) => sum + weights[index] * mean, 0) / total;
  const excess = ordinary.reduce((sum, { mean }, index) => sum + weights[index] * (mean - center) ** 2, 0) - (ordinary.length - 1);
  const scale = total - weights.reduce((sum, weight) => sum + weight ** 2, 0) / total;
  return scale > 0 ? Math.max(0, excess / scale) : 0;
}

/** Стандартная ошибка разности: случайность дня, случайность окна и обычный разброс дней. */
function errorOf(day, base, between) {
  return Math.sqrt(base.variance / day.n + base.variance / base.ratings + between);
}

/* Малый день должен быть значим и без своей самой низкой оценки: одна оценка не делает снижение */
function isUnlikelyWithoutWorst(day, base) {
  const lost = MARKS.reduce((total, mark) => total + (TOP_MARK - mark) * day.counts[mark], 0);
  const worst = TOP_MARK - MARKS.find((mark) => day.counts[mark] > 0);
  return dropTail(base.counts, base.ratings, day.n - 1, lost - worst) < CRITICAL_DROP_ALPHA;
}

function isCritical(day, base, between, drop) {
  if (base.ratings < CRITICAL_DROP_MIN_WINDOW_RATINGS || drop < CRITICAL_DROP_MIN - EPSILON) return false;
  if (drop / errorOf(day, base, between) <= CRITICAL_DROP_Z) return false;
  return day.n > CRITICAL_DROP_EXACT_RATINGS || isUnlikelyWithoutWorst(day, base);
}

/* Начало идущей сейчас серии отмеченных дней; дни без оценок её не обрывают */
function currentSeriesStart(samples, verdicts, first, index) {
  let start = index;
  for (let day = index - 1; day >= first; day -= 1) {
    if (!samples[day]) continue;
    if (!verdicts[day]?.direction) break;
    start = day;
  }
  return start;
}

function isLongSeriesDay(verdicts, day) {
  if (!verdicts[day]?.direction) return false;
  let from = day;
  let to = day;
  while (verdicts[from - 1]?.direction) from -= 1;
  while (verdicts[to + 1]?.direction) to += 1;
  return to - from + 1 >= CRITICAL_DROP_EVENT_DAYS;
}

/*
  Дни окна для оценки обычного разброса. Идущая серия не входит: первые дни аварии спрятали бы
  следующие. Прошедшая серия от `CRITICAL_DROP_EVENT_DAYS` дней — событие и тоже не входит, иначе
  спрячет рецидив. Короткая просадка — например, каждый понедельник — и есть обычный разброс разреза
*/
function ordinaryDays(samples, verdicts, first, index) {
  const start = currentSeriesStart(samples, verdicts, first, index);
  return samples.slice(first, start).filter((sample, offset) => sample && !isLongSeriesDay(verdicts, first + offset));
}

/**
 * Опирается ли день `index` на окно, достаточное для вердикта: те же условия, что в
 * `dropVerdicts` и `isCritical`. Иначе «Мало истории» и вердикт разреза разойдутся.
 */
export function hasDropWindow(samples, index, window = ANOMALY_WINDOW_DAYS) {
  if (!samples[index]) return false;
  const history = samples.slice(Math.max(0, index - window), index).filter(Boolean);
  return history.length >= ANOMALY_MIN_WINDOW_VALUES
    && history.reduce((ratings, { n }) => ratings + n, 0) >= CRITICAL_DROP_MIN_WINDOW_RATINGS;
}

/**
 * `samples` — `markSample` подряд идущих дней, `null` — оценок нет. Форма вердикта та же, что у
 * `bandVerdicts`, без границ коридора: коридора здесь нет. `mean` — средняя всех оценок окна.
 */
export function dropVerdicts(samples, { window = ANOMALY_WINDOW_DAYS } = {}) {
  const verdicts = [];
  samples.forEach((day, index) => {
    const first = Math.max(0, index - window);
    const history = samples.slice(first, index).filter(Boolean);
    if (!day || history.length < ANOMALY_MIN_WINDOW_VALUES) {
      verdicts.push(null);
      return;
    }
    const base = windowOf(history);
    const drop = base.mean - day.mean;
    const ordinary = ordinaryDays(samples, verdicts, first, index);
    const between = betweenDayVariance(ordinary, base);
    const direction = isCritical(day, base, between, drop) ? BELOW : null;
    const previous = verdicts[index - 1];
    verdicts.push({
      value: day.mean,
      mean: base.mean,
      delta: -drop,
      deviation: -drop / errorOf(day, base, between),
      direction,
      streak: direction ? (previous?.direction === direction ? previous.streak + 1 : 1) : 0,
      windowValues: history.length,
    });
  });
  return verdicts;
}
