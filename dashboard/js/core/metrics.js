/**
 * Базовые агрегации по оценкам (`D-07`, `D-15`) — методика в `docs/calc-core.md` §3.
 *
 * Неопределённое на срезе значение — `null`, а не `0`: ноль это ответ, а не его
 * отсутствие. Числа полной точности, округление на выводе (`D-21`).
 */

export const MARKS = [1, 2, 3, 4, 5];

/** `docs/data-model.md` §4. */
export const LOW_MARK_MAX = 2;

export function voc(ratings) {
  if (ratings.length === 0) return null;
  return ratings.reduce((sum, { mark }) => sum + mark, 0) / ratings.length;
}

export function ratingCount(ratings) {
  return ratings.length;
}

export function lowRatingCount(ratings) {
  return ratings.filter(({ mark }) => mark <= LOW_MARK_MAX).length;
}

/** Доля оценок 1–3 с ОС среди оценок 1–3; признак вычислен при импорте без текстов в факте. */
export function negativeFeedbackShare(ratings) {
  const negative = ratings.filter(({ mark }) => mark >= 1 && mark <= 3);
  if (negative.length === 0 || negative.some(({ has_feedback }) => typeof has_feedback !== 'boolean')) return null;
  return negative.filter(({ has_feedback }) => has_feedback === true).length * 100 / negative.length;
}

export function markDistribution(ratings) {
  const total = ratings.length;

  return MARKS.map((mark) => {
    const count = ratings.filter((rating) => rating.mark === mark).length;
    return { mark, count, share: total === 0 ? null : (count * 100) / total };
  });
}

/**
 * Изменение показателя к предыдущему периоду. Не определён любой из двух —
 * `null`, а не `0`: «сравнивать не с чем» и «не изменилось» — разные ответы.
 */
export function deltaOf(current, previous) {
  if (current === null || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return current - previous;
}

export function vocDelta(ratings, previousRatings) {
  return deltaOf(voc(ratings), voc(previousRatings));
}

/**
 * Направление тренда выводится из знака дельты, а не задаётся отдельно
 * (`V-15`).
 *
 * На вход идёт **уже округлённое до отображаемых знаков** число, и точность у
 * каждого показателя своя: иначе `+0,04` п. п. показало бы стрелку роста рядом
 * с подписью `+0,0` — то же противоречие, от которого защищает `D-22`. Пару
 * «округление + формат» держит `DELTA_SHAPES` в `blocks/metric-card.js`, чтобы
 * они не разъехались.
 */
export function trendOf(shownDelta) {
  if (shownDelta === null || shownDelta === undefined || !Number.isFinite(shownDelta)) return null;
  if (shownDelta > 0) return 'up';
  return shownDelta < 0 ? 'down' : 'flat';
}

export function groupBy(ratings, select) {
  const groups = new Map();

  for (const rating of ratings) {
    const key = select(rating);
    const group = groups.get(key);
    if (group) group.push(rating);
    else groups.set(key, [rating]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => compareKeys(left, right))
    .map(([key, grouped]) => ({ key, ratings: grouped }));
}

export function summarize(ratings) {
  const total = ratings.length;
  const fives = ratings.filter(({ mark }) => mark === 5).length;
  const lowCount = lowRatingCount(ratings);
  /* J-85: плитка считает оценки 1–3, а `lowCount` — 1–2 (data-model, разбивка оценок) */
  const oneToThree = ratings.filter(({ mark }) => mark >= 1 && mark <= 3).length;

  return {
    voc: voc(ratings),
    count: total,
    lowCount,
    shareLow: total === 0 ? null : (oneToThree * 100) / total,
    negativeFeedbackShare: negativeFeedbackShare(ratings),
    share5: total === 0 ? null : (fives * 100) / total,
  };
}

/** Порядок групп для вывода: `ru`, иначе `Ё` встанет перед `А`, а строчные — после всех прописных. */
export function compareKeys(left, right) {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.localeCompare(right, 'ru');
  }
  if (left < right) return -1;
  return left > right ? 1 : 0;
}
