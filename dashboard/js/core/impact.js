/**
 * Вклад антидрайвера: разложение изменения VOC по элементам разреза (`D-10`).
 * Формула и её обоснование — `docs/calc-core.md` §5.
 *
 * **Методика требует подписи аналитики**, поэтому лежит в одном файле целиком:
 * замена методики — правка этого файла, а не поиск слагаемых по дашборду.
 *
 * Сумма вкладов равна `ΔVOC` при любой точке отсчёта, поэтому главный инвариант
 * саму методику не закрепляет: её держат антисимметрия сравнения и нейтральный
 * элемент (`test/negative-controls.test.js`).
 */

import { breakdown } from './breakdown.js';
import { voc } from './metrics.js';

export function decomposeVocChange(previous, current, project) {
  const previousVoc = voc(previous);
  const currentVoc = voc(current);

  if (previousVoc === null || currentVoc === null) {
    return { previousVoc, currentVoc, delta: null, contributions: [] };
  }

  const before = index(breakdown(previous, project));
  const after = index(breakdown(current, project));
  const center = (previousVoc + currentVoc) / 2;

  const contributions = [...new Set([...before.keys(), ...after.keys()])]
    .map((key) => contribution(key, before.get(key), after.get(key), {
      previousSize: previous.length,
      currentSize: current.length,
      center,
    }))
    .sort((left, right) => left.impact - right.impact);

  return {
    previousVoc,
    currentVoc,
    delta: currentVoc - previousVoc,
    contributions,
  };
}

function contribution(key, before, after, { previousSize, currentSize, center }) {
  const previousShare = before ? before.weightedCount / previousSize : 0;
  const currentShare = after ? after.weightedCount / currentSize : 0;
  const previousLevel = before ? before.weightedVoc : after.weightedVoc;
  const currentLevel = after ? after.weightedVoc : before.weightedVoc;

  const markEffect = (currentLevel - previousLevel) * ((previousShare + currentShare) / 2);
  const mixEffect =
    (currentShare - previousShare) * ((previousLevel + currentLevel) / 2 - center);

  return {
    key,
    impact: markEffect + mixEffect,
    markEffect,
    mixEffect,
    previousShare,
    currentShare,
    previousLevel: before ? before.weightedVoc : null,
    currentLevel: after ? after.weightedVoc : null,
  };
}

function index(groups) {
  return new Map(groups.map((group) => [group.key, group]));
}
