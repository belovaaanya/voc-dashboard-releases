/** Вход LLM «Главного вывода» (`R-46`): только агрегаты и подписи справочника, без комментариев клиентов и текста агента. */

import { elementDamage } from './antidrivers.js';
import { periodFactors } from './conclusions.js';
import { DIMENSIONS, DIMENSION_CAPTION } from './dimensions.js';
import { sortInsights } from './insights.js';
import { roundImpact } from './round.js';

const ANOMALY_LIMIT = 20;
const ANTIDRIVER_LIMIT = 5;
const DRIVER_LIMIT = 3;
/* Лимиты повторяют проверку тела в `tools/local_server.py`: длиннее — 400 и расчётный вывод */
const FILTER_VALUE_LIMIT = 50;

const TRIGGER = DIMENSIONS.find(({ key }) => key === 'trigger');
const factorsBySlice = new WeakMap();
const NO_PREVIOUS = Object.freeze([]);

/** Факторы J-12 по триггерам: один расчёт на пару срезов для LLM-payload и расчётного вывода. */
export function conclusionFactors({ slice, previousSlice, reference, label }) {
  const previous = previousSlice ?? NO_PREVIOUS;
  if (!factorsBySlice.has(slice)) factorsBySlice.set(slice, new WeakMap());
  const byPrevious = factorsBySlice.get(slice);
  const saved = byPrevious.get(previous);
  if (saved?.reference === reference && saved.label === label) return saved.factors;
  const factors = periodFactors(previous, slice, (row) => TRIGGER.values(row, reference), label);
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
function antidriverOf({ name, impact, voc, ratings }, sliceSize) {
  return {
    name,
    damage: voc === null ? null : roundImpact(elementDamage({ mentions: ratings, voc }, sliceSize)),
    contribution: roundImpact(impact),
    voc: roundImpact(voc),
    ratings,
  };
}

const driverOf = ({ name, impact, voc, previousVoc }) =>
  ({ name, contribution: roundImpact(impact), voc: roundImpact(voc), previousVoc: roundImpact(previousVoc) });

/** `anomalies` — события среза (`state/event-analysis`): ядро не знает, как их собирает экран. */
export function conclusionPayload(context, anomalies) {
  const { slice, period, state, label } = context;
  const decomposition = conclusionFactors(context);
  return {
    channel: state.channel ?? null,
    period: { from: period.from, to: period.to },
    filters: filtersOf(context),
    voc: { current: roundImpact(decomposition.currentVoc), previous: roundImpact(decomposition.previousVoc), ratings: slice.length },
    anomalies: sortInsights(anomalies, 'influence').slice(0, ANOMALY_LIMIT).map((event) => anomalyForLlm(event, label)),
    antidrivers: decomposition.negative.slice(0, ANTIDRIVER_LIMIT).map((factor) => antidriverOf(factor, slice.length)),
    drivers: decomposition.positive.slice(0, DRIVER_LIMIT).map(driverOf),
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
