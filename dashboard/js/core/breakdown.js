/**
 * Неаддитивные разрезы: проекция `оценка → ключи` (`D-08`, `D-09`, `D-11`, `D-12`).
 * Какие четыре числа несёт группа и почему их именно четыре — `docs/calc-core.md` §4.
 *
 * Справочник триггер → продукт остаётся снаружи: ядро знает только проекцию.
 */

import { compareKeys, LOW_MARK_MAX } from './metrics.js';

/** Пустая разметка — не потерянная оценка, а явная группа (`D-11`). */
export const UNLABELLED = 'Без разметки';

export function breakdown(ratings, project) {
  const groups = new Map();
  const total = ratings.length;

  for (const rating of ratings) {
    // Без идентификатора дедупликация внутри группы схлопнула бы разные оценки в одну.
    if (isBlank(rating.voc_ccode)) {
      throw new Error(`Оценка без voc_ccode: ${JSON.stringify(rating)}`);
    }

    const keys = projectKeys(rating, project);
    const weight = 1 / keys.length;

    for (const key of keys) {
      const group = groupFor(groups, key);
      group.weightedCount += weight;
      group.weightedMarkSum += weight * rating.mark;

      if (group.seen.has(rating.voc_ccode)) continue;
      group.seen.add(rating.voc_ccode);
      group.mentions += 1;
      group.markSum += rating.mark;
      if (rating.mark <= LOW_MARK_MAX) group.lowCount += 1;
    }
  }

  return [...groups.values()]
    .map(({ seen, markSum, weightedMarkSum, ...group }) => ({
      ...group,
      voc: group.mentions === 0 ? null : markSum / group.mentions,
      weightedVoc:
        group.weightedCount === 0 ? null : weightedMarkSum / group.weightedCount,
      share: total === 0 ? null : (group.weightedCount * 100) / total,
    }))
    .sort(byWeightThenKey);
}

function projectKeys(rating, project) {
  const keys = (project(rating) ?? []).map((key) => (isBlank(key) ? UNLABELLED : key));
  return keys.length === 0 ? [UNLABELLED] : keys;
}

function isBlank(key) {
  return key === null || key === undefined || String(key).trim() === '';
}

function groupFor(groups, key) {
  const existing = groups.get(key);
  if (existing) return existing;

  const group = {
    key,
    mentions: 0,
    weightedCount: 0,
    lowCount: 0,
    markSum: 0,
    weightedMarkSum: 0,
    seen: new Set(),
  };
  groups.set(key, group);
  return group;
}

function byWeightThenKey(left, right) {
  if (left.weightedCount !== right.weightedCount) {
    return right.weightedCount - left.weightedCount;
  }
  return compareKeys(left.key, right.key);
}
