/**
 * «Главный вывод» — один пул кандидатов разных типов и одна главная причина по знаку ΔVOC (решение пользователя 14.11).
 *
 * Каждый тип — тот же итоговый вклад в ΔVOC (D-10, `decomposeVocChange` через `periodFactors`): триггер, сегмент,
 * ОС и версия приложения (только АБМ), проблематика — новая или с ростом жалоб. Шкала у всех одна — вклад в изменение
 * VOC среза, поэтому кандидаты сравнимы напрямую. Малые срезы не побеждают: у кандидата не меньше
 * `MIN_CANDIDATE_RATINGS` оценок за текущий период. «Без разметки», «Без версии», исключённые причины — не кандидаты.
 * Методика — `docs/blocks-conclusion.md`.
 */

import { complaintValues } from './analytical-causes.js';
import { MOBILE_CHANNEL, DIMENSIONS, metricSegments, osName } from './dimensions.js';
import { UNLABELLED } from './breakdown.js';
import { NO_VERSION, numberedVersionKey } from './antidrivers.js';
import { periodFactors } from './conclusions.js';
import { ABOVE, BELOW } from './anomalies.js';
import { ANOMALY_EVENT, INCIDENT_EVENT, ROLLOUT_EVENT, SUSTAINED_EVENT, sortEvents } from './calendar.js';
import { compareKeys } from './metrics.js';
import { roundDelta } from './round.js';

/** Порог кандидата: меньше оценок за текущий период — шум одного дня, а не причина изменения VOC среза. */
export const MIN_CANDIDATE_RATINGS = 30;

export const UP = 'up';
export const DOWN = 'down';
export const FLAT = 'flat';

const TRIGGER = DIMENSIONS.find(({ key }) => key === 'trigger');
const SEGMENTS = new Set(metricSegments());

/* Типы кандидатов: подпись типа — мелко над причиной на карточке и `type` в payload LLM */
export const CANDIDATE_TYPES = [
  { type: 'trigger', caption: 'Триггер', project: (row, reference) => TRIGGER.values(row, reference) },
  /* Сегмент и ОС — только контекст второй строки: у разреза из двух-трёх значений каждое забирает большую долю ΔVOC
     (вклады одного разреза в сумме — весь ΔVOC), и широкий ответ «ММБ» вытеснял бы конкретный триггер (решение A, 14.11) */
  { type: 'segment', caption: 'Сегмент', context: true, project: (row) => (SEGMENTS.has(row.segment) ? [row.segment] : []) },
  { type: 'os', caption: 'ОС', context: true, mobile: true, project: (row) => [osName(row.device_os)].filter(Boolean) },
  { type: 'app_version', caption: 'Версия', mobile: true, project: (row) => [numberedVersionKey(row)].filter(Boolean) },
  { type: 'problem', caption: 'Проблема', growing: true, project: (row, reference) => complaintValues(row, 'problem', reference) },
];

const NOT_CAUSES = new Set([UNLABELLED, NO_VERSION]);

/* Разрез, у которого в обоих периодах одно значение (выбран фильтром), всё ΔVOC берёт на себя — это не причина */
function keysOf(rows, project, reference) {
  const keys = new Set();
  for (const row of rows) for (const key of project(row, reference) ?? []) if (key !== null && key !== undefined && key !== '') keys.add(key);
  return keys;
}

/*
  Значение, которое есть в каждой оценке обоих периодов, — сам срез: у многозначного разреза (триггеры, проблемы)
  выбранный фильтром триггер соседствует с другими, разрез не «одно значение», но выбранный всё равно весь ΔVOC
*/
function sliceKeys(previous, current, project, reference) {
  const rows = [...previous, ...current];
  if (!rows.length) return new Set();
  let common = null;
  for (const row of rows) {
    const keys = new Set(project(row, reference) ?? []);
    common = common === null ? keys : new Set([...common].filter((key) => keys.has(key)));
    if (!common.size) break;
  }
  return common;
}

const strongest = (left, right) => Math.abs(right.impact) - Math.abs(left.impact) || compareKeys(left.name, right.name);

/**
 * Пул кандидатов среза: `{ previousVoc, currentVoc, delta, candidates, positive, negative }`, кандидаты отсортированы
 * по модулю вклада. Поля кандидата — как у фактора `periodFactors` и `type`, `caption`.
 */
export function candidatePool(previous, current, { reference = null, label = (_dimension, key) => key } = {}) {
  const mobile = current.some((row) => row.channel === MOBILE_CHANNEL);
  let base = null;
  const candidates = [];
  for (const source of CANDIDATE_TYPES) {
    if (source.mobile && !mobile) continue;
    const project = (row) => source.project(row, reference);
    const result = periodFactors(previous, current, project, label, source.type);
    base ??= result;
    const keys = new Set([...keysOf(previous, source.project, reference), ...keysOf(current, source.project, reference)]);
    if (keys.size < 2) continue;
    const everywhere = sliceKeys(previous, current, source.project, reference);
    for (const factor of [...result.positive, ...result.negative]) {
      if (NOT_CAUSES.has(factor.key) || NOT_CAUSES.has(factor.name) || everywhere.has(factor.key)) continue;
      if (factor.ratings < MIN_CANDIDATE_RATINGS) continue;
      if (source.growing && !(factor.ratings > factor.previousRatings)) continue;
      candidates.push({ ...factor, type: source.type, caption: source.caption, context: Boolean(source.context) });
    }
  }
  const { previousVoc = null, currentVoc = null, delta = null } = base ?? periodFactors(previous, current, () => [], label);
  candidates.sort(strongest);
  /* Одна подпись — одна причина: триггер и сегмент с одинаковым именем показываются один раз — конкретным типом,
     иначе контекст вытеснил бы из главных причин саму причину; среди одного рода — сильнейшим */
  const kept = new Map();
  for (const candidate of candidates) {
    const held = kept.get(candidate.name);
    if (!held || (held.context && !candidate.context)) kept.set(candidate.name, candidate);
  }
  const unique = candidates.filter((candidate) => kept.get(candidate.name) === candidate);
  candidates.length = 0;
  candidates.push(...unique);
  return {
    previousVoc,
    currentVoc,
    delta,
    candidates,
    positive: candidates.filter(({ impact }) => impact > 0),
    negative: candidates.filter(({ impact }) => impact < 0),
  };
}

/** Направление вывода — по знаку ΔVOC, округлённой как на карточках: «0,00» — без изменений (D-22). */
export function directionOf(delta) {
  if (delta === null || !Number.isFinite(delta)) return null;
  const shown = roundDelta(delta);
  return shown > 0 ? UP : shown < 0 ? DOWN : FLAT;
}

const concrete = (candidates) => candidates.filter(({ context }) => !context);

/**
 * Кандидаты главной причины по направлению — только конкретные типы (триггер, версия, проблема): рост — драйверы,
 * снижение — антидрайверы, без изменений — знак сильнейшего из конкретных.
 */
export function directionCandidates(pool) {
  const direction = directionOf(pool.delta);
  if (direction === UP) return concrete(pool.positive);
  if (direction === DOWN) return concrete(pool.negative);
  if (direction === FLAT) {
    const [first] = concrete(pool.candidates);
    return first ? concrete(first.impact > 0 ? pool.positive : pool.negative) : [];
  }
  return [];
}

/**
 * Вывод: одна главная причина из конкретных типов и вторая строка — контекст: сильнейший сегмент или ОС того же
 * знака, а без них — следующий конкретный кандидат другого типа. `main` — `null`, если причин нет (все ниже порога,
 * вклад нулевой или нет прошлого периода).
 */
export function mainConclusion(pool) {
  const direction = directionOf(pool.delta);
  const ranked = directionCandidates(pool);
  const main = ranked[0] ?? null;
  if (!main) return { direction, delta: pool.delta, main: null, second: null };
  const sameSign = main.impact > 0 ? pool.positive : pool.negative;
  const second = sameSign.find(({ context }) => context) ?? ranked.find((candidate) => candidate.type !== main.type) ?? null;
  return { direction, delta: pool.delta, main, second };
}

/* События календаря, которые объясняют изменение в своём направлении: авария, инцидент, раскатка, снижение или рост VOC */
const EVENT_FITS = {
  [DOWN]: (event) => [INCIDENT_EVENT, SUSTAINED_EVENT, ROLLOUT_EVENT].includes(event.kind) || (event.kind === ANOMALY_EVENT && event.direction === BELOW),
  [UP]: (event) => event.kind === ROLLOUT_EVENT || (event.kind === ANOMALY_EVENT && event.direction === ABOVE),
  [FLAT]: (event) => [INCIDENT_EVENT, SUSTAINED_EVENT, ROLLOUT_EVENT].includes(event.kind),
};

/** Событие календаря периода для второй строки: сильнейшее по влиянию из подходящих направлению, иначе `null`. */
export function contextEvent(events, period, direction) {
  const fits = EVENT_FITS[direction];
  if (!fits || !period) return null;
  const inPeriod = (events ?? []).filter((event) => event?.date >= period.from && event.date <= period.to && fits(event));
  return inPeriod.length ? sortEvents(inPeriod, 'influence')[0] : null;
}
