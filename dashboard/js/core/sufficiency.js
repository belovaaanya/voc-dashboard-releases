/**
 * Достаточность выборки (`D-25`): срез за период с числом оценок меньше
 * порога помечается «Мало оценок».
 */

import { voc } from './metrics.js';

/** Порог задан заказчиком (`R-10`): меньше `420` оценок за выбранный период. */
export const MINIMUM_RATINGS = 420;

export function sampleSufficiency(ratings, minimumRatings = MINIMUM_RATINGS) {
  const n = ratings.length;
  return { n, mean: voc(ratings), minimumRatings, sufficient: n >= minimumRatings };
}
