import { ABOVE, BELOW } from './anomalies.js';
import { decomposeVocChange } from './impact.js';
import { compareKeys } from './metrics.js';
import { ignoredCauseKey } from './analytical-causes.js';
import { breakdown, UNLABELLED } from './breakdown.js';

const EPSILON = 1e-12;

/**
 * J-12: оба направления — итоговый вклад D-10 за один и тот же период сравнения. `dimension` — разрез подписей
 * и исключённых причин: триггер по умолчанию, пул «Главного вывода» считает так же сегмент, ОС, версию и проблему.
 */
export function periodFactors(previous, current, project, label = (_dimension, key) => key, dimension = 'trigger') {
  const decomposition = decomposeVocChange(previous, current, project);
  // Один факт с несколькими кодами одной подписи учитывается в объёме и среднем только один раз.
  const namedKeys = row => {
    const keys = project(row) ?? [];
    return [...new Set((keys.length ? keys : [UNLABELLED]).map(key =>
      label(dimension, key === null || key === undefined || String(key).trim() === '' ? UNLABELLED : key)))];
  };
  const before = new Map(breakdown(previous, namedKeys).map(group => [group.key, group]));
  const after = new Map(breakdown(current, namedKeys).map(group => [group.key, group]));
  const byName = new Map();
  for (const factor of decomposition.contributions) {
    if (ignoredCauseKey(dimension, factor.key, label)) continue;
    const name = label(dimension, factor.key);
    const existing = byName.get(name);
    if (existing) {
      existing.impact += factor.impact;
      existing.markEffect += factor.markEffect;
      existing.mixEffect += factor.mixEffect;
    } else byName.set(name, { key: factor.key, name, impact: factor.impact,
      markEffect: factor.markEffect, mixEffect: factor.mixEffect,
      ratings: after.get(name)?.mentions ?? 0, previousRatings: before.get(name)?.mentions ?? 0,
      voc: after.get(name)?.voc ?? null, previousVoc: before.get(name)?.voc ?? null,
    });
  }
  const factors = [...byName.values()].filter(({ impact }) => Math.abs(impact) > EPSILON);
  const strongest = (left, right) => Math.abs(right.impact) - Math.abs(left.impact) || compareKeys(left.name, right.name);
  return { ...decomposition,
    positive: factors.filter(({ impact }) => impact > 0).sort(strongest),
    negative: factors.filter(({ impact }) => impact < 0).sort(strongest),
  };
}

export function buildConclusion(current, previous, project, label, limit = 1) {
  return conclusionGroups(periodFactors(previous, current, project, label), limit);
}

/** Строки вывода из готовых факторов `periodFactors`. */
export function conclusionGroups(result, limit = 1) {
  const capacity = Math.max(1, Math.min(3, Math.trunc(limit) || 1));
  const groups = [
    { direction: ABOVE, tone: 'positive', items: result.positive.slice(0, capacity).map(factor => ({ factor })) },
    { direction: BELOW, tone: 'negative', items: result.negative.slice(0, capacity).map(factor => ({ factor })) },
  ].filter(({ items }) => items.length);
  return { ...result, groups };
}
