/** Вход LLM «Главного вывода» (`R-46`): только агрегаты и подписи справочника, без комментариев клиентов и текста агента. */

import { elementDamage } from './antidrivers.js';
import { candidatePool, directionCandidates } from './conclusion-pool.js';
import { DIMENSIONS, DIMENSION_CAPTION } from './dimensions.js';
import { sortInsights } from './insights.js';
import { roundImpact } from './round.js';

const ANOMALY_LIMIT = 20;
const ANTIDRIVER_LIMIT = 5;
const DRIVER_LIMIT = 5;
/* Лимиты повторяют проверку тела в `tools/local_server.py`: длиннее — 400 и расчётный вывод */
const FILTER_VALUE_LIMIT = 50;

const factorsBySlice = new WeakMap();
const NO_PREVIOUS = Object.freeze([]);

/** Пул кандидатов вывода (`conclusion-pool.js`): один расчёт на пару срезов для LLM-payload и расчётного вывода. */
export function conclusionFactors({ slice, previousSlice, reference, label }) {
  const previous = previousSlice ?? NO_PREVIOUS;
  if (!factorsBySlice.has(slice)) factorsBySlice.set(slice, new WeakMap());
  const byPrevious = factorsBySlice.get(slice);
  const saved = byPrevious.get(previous);
  if (saved?.reference === reference && saved.label === label) return saved.factors;
  const factors = candidatePool(previous, slice, { reference, label });
  byPrevious.set(previous, { reference, label, factors });
  return factors;
}

const textOrNull = (value) => (typeof value === 'string' && value ? value : null);

/**
 * Единственное место, знающее форму события календаря: она меняется параллельно,
 * поэтому каждое поле необязательно. Список полей закрытый — `comment` агента сюда не попадает.
 */
export function anomalyForLlm(event, label) {
  const dimension = event?.dimension ?? null;
  const channelWide = dimension === 'channel';
  return {
    date: textOrNull(event?.date),
    direction: textOrNull(event?.direction),
    tone: textOrNull(event?.tone),
    subject: textOrNull(event?.subject),
    severity: textOrNull(event?.severity),
    metric: textOrNull(event?.metric),
    dimension: channelWide ? 'Весь срез' : textOrNull(DIMENSION_CAPTION[dimension] ?? dimension),
    item: channelWide || event?.key === undefined ? null : textOrNull(label(dimension, event.key)),
    value: roundImpact(event?.value),
    delta: roundImpact(event?.delta),
    streak: Number.isInteger(event?.streak) ? event.streak : null,
    dayVoc: roundImpact(event?.dayVoc),
    ratings: Number.isInteger(event?.ratings) ? event.ratings : null,
    planStatus: textOrNull(event?.planStatus),
  };
}

function filtersOf({ state, label }) {
  return Object.entries(state.filters ?? {})
    .filter(([, values]) => values?.length)
    .map(([dimension, values]) => ({
      dimension: DIMENSIONS.find(({ key }) => key === dimension)?.title ?? dimension,
      values: values.slice(0, FILTER_VALUE_LIMIT).map((value) => label(dimension, value)),
    }));
}

/** Факторы уже несут VOC и оценки по подписи триггера в обоих периодах: второго разреза среза не нужно. */
function antidriverOf({ name, caption, impact, voc, ratings }, sliceSize) {
  return {
    name,
    type: caption,
    damage: voc === null ? null : roundImpact(elementDamage({ mentions: ratings, voc }, sliceSize)),
    contribution: roundImpact(impact),
    voc: roundImpact(voc),
    ratings,
  };
}

const driverOf = ({ name, caption, impact, voc, previousVoc }) =>
  ({ name, type: caption, contribution: roundImpact(impact), voc: roundImpact(voc), previousVoc: roundImpact(previousVoc) });

/** `anomalies` — события среза (`state/event-analysis`): ядро не знает, как их собирает экран. */
export function conclusionPayload(context, anomalies) {
  const { slice, period, state, label } = context;
  const decomposition = conclusionFactors(context);
  const ranked = directionCandidates(decomposition);
  return {
    channel: state.channel ?? null,
    period: { from: period.from, to: period.to },
    filters: filtersOf(context),
    voc: { current: roundImpact(decomposition.currentVoc), previous: roundImpact(decomposition.previousVoc), ratings: slice.length },
    anomalies: sortInsights(anomalies, 'influence').slice(0, ANOMALY_LIMIT).map((event) => anomalyForLlm(event, label)),
    /* Пул по направлению ΔVOC: заполнен один список — LLM называет одну главную причину из него, второй — null */
    antidrivers: ranked[0]?.impact < 0 ? ranked.slice(0, ANTIDRIVER_LIMIT).map((factor) => antidriverOf(factor, slice.length)) : [],
    drivers: ranked[0]?.impact > 0 ? ranked.slice(0, DRIVER_LIMIT).map(driverOf) : [],
  };
}

const isFactor = (value) => typeof value?.name === 'string' && value.name.trim() !== '' && typeof value?.why === 'string';

export function isConclusion(answer, payload) {
  if (!answer || !['antidriver', 'driver'].every(key => answer[key] === null || isFactor(answer[key]))
    || typeof answer.summary !== 'string') return false;
  if (answer.antidriver && answer.driver && answer.antidriver.name === answer.driver.name) return false;
  if (payload?.antidrivers && payload?.drivers) {
    return [['antidriver', 'antidrivers'], ['driver', 'drivers']].every(([key, input]) =>
      payload[input].length ? answer[key] !== null && payload[input].some(factor => factor.name === answer[key].name)
        : answer[key] === null);
  }
  return true;
}

export const conclusionKey = (payload) => JSON.stringify(payload);
