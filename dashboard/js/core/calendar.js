/** События «Календаря событий» (R-43 – R-45); методика — `docs/calc-core.md`, «События календаря». */

import { ABOVE, BELOW, VOC_METRIC, compareAnomalies, isWorkingDay, workingDays } from './anomalies.js';
import { numberedVersionKey } from './antidrivers.js';
import { earliestDate, shiftDay } from './dates.js';
import { formatCompactDuration, plural } from './format.js';
import { accidentId, incidentSpan, isRetailIncident } from './incident-events.js';
import { COMPLAINT_SUBJECT, CRITICAL, NEGATIVE, NEUTRAL, POSITIVE, anomalySubject } from './insights.js';

export const ANOMALY_EVENT = 'anomaly';
export const ROLLOUT_EVENT = 'rollout';
export const INCIDENT_EVENT = 'incident';
/* Аварии из incidents и расчётные инциденты — разные виды. */
export const SUSTAINED_EVENT = 'sustained-incident';
/* J-138: новый срез — впервые пришли оценки по триггеру или версии приложения */
export const NEW_SLICE_EVENT = 'new-slice';

/* Цвет события — тон точки и тега; красный и зелёный — тоны негатива и позитива каркаса */
export const RED = 'negative';
export const ORANGE = 'orange';
export const YELLOW = 'yellow';
export const PURPLE = 'purple';
export const GREEN = 'positive';

const WORKING_DAY_FORMS = ['рабочий день', 'рабочих дня', 'рабочих дней'];

export function workingDaysCaption(count) {
  return `${count}\u00a0${plural(count, WORKING_DAY_FORMS)}`;
}


/** Тип события по правилу заказчика (R-43, R-51): подпись тега и цвет; у роста числа оценок типа нет — `null`. */
export function eventType(event) {
  if (event.kind === SUSTAINED_EVENT) return { label: `Инцидент ${event.streak}\u00a0дн`, color: RED };
  if (event.kind === INCIDENT_EVENT) {
    const duration = formatCompactDuration(event.duration_seconds);
    return { label: duration ? `Авария ${duration}` : 'Авария', color: 'accident' };
  }
  if (event.kind === ROLLOUT_EVENT) return { label: 'Раскатка', color: 'neutral' };
  if (event.kind === NEW_SLICE_EVENT) return { label: 'Новый срез', color: PURPLE };
  if (event.calendar) {
    const color = { above: 'mint', in: 'yellow', below: RED }[event.planStatus] ?? ORANGE;
    return { label: event.planStatus === 'below' ? 'Снижение VOC ниже плана' : 'Снижение VOC', color };
  }
  if (event.metric === VOC_METRIC) {
    if (event.direction === ABOVE) return { label: 'Рост VOC', color: GREEN };
    if (event.severity !== CRITICAL) return { label: 'Снижение VOC', color: ORANGE };
    const days = event.belowPlanDays ?? 1;
    return { label: days > 1 ? `Снижение ниже плана ${workingDaysCaption(days)}` : 'Снижение VOC ниже плана', color: RED };
  }
  if (anomalySubject(event) === COMPLAINT_SUBJECT) {
    return event.direction === ABOVE ? { label: 'Рост жалоб', color: ORANGE } : { label: 'Снижение жалоб', color: GREEN };
  }
  return event.direction === BELOW ? { label: 'Снижение кол-ва оценок', color: YELLOW } : null;
}

/* Номер рабочего дня от общей точки отсчёта: по нему дни одной серии получают одно начало */
function workingIndexer(dates) {
  const sorted = [...dates].sort();
  if (!sorted.length) return () => 0;
  const days = workingDays(sorted[0], sorted.at(-1));
  const index = new Map(days.map((day, position) => [day, position]));
  return (date) => index.get(date);
}

function workingDaysBack(date, count) {
  const days = [];
  for (let day = date; days.length < count; day = shiftDay(day, -1)) {
    if (isWorkingDay(day)) days.unshift(day);
  }
  return days;
}

/** Серия снижений одной строкой (R-44): узнаётся по началу «дата − (streak − 1)», поэтому скрытый день-копия её не рвёт. */
export function collapseSeries(anomalies, period) {
  const indexOf = workingIndexer(anomalies.map(({ date }) => date));
  const runs = new Map();
  for (const anomaly of anomalies) {
    const start = indexOf(anomaly.date) - anomaly.streak + 1;
    const id = JSON.stringify([anomaly.channel, anomaly.metric, anomaly.dimension, anomaly.key, anomaly.direction, start]);
    if (!runs.has(id)) runs.set(id, []);
    runs.get(id).push(anomaly);
  }

  return [...runs.values()].flatMap((members) => {
    members.sort((left, right) => left.date.localeCompare(right.date));
    const last = members.at(-1);
    if (last.date < period.from) return [];
    const days = workingDaysBack(last.date, last.streak);
    return [{
      ...last,
      kind: ANOMALY_EVENT,
      from: days[0],
      days,
      belowPlanDays: belowPlanRun(members),
      startsBeforePeriod: days[0] < period.from,
    }];
  });
}

/* Дни ниже плана подряд до последнего дня; скрытая копия между днями ниже плана счёт не рвёт */
function belowPlanRun(members) {
  const last = members.at(-1);
  let earliest = null;
  for (let index = members.length - 1; index >= 0 && members[index].severity === CRITICAL; index -= 1) earliest = members[index];
  return earliest ? last.streak - earliest.streak + 1 : 0;
}

/** J-22: раскатки текущего/всех каналов; аварии любых каналов, пересекающие период. */
export function channelEvents(reference, { channel, period }) {
  const inScope = (item) => (item.channel === null || item.channel === channel) && item.date >= period.from && item.date <= period.to;
  const rollouts = (reference?.rollouts ?? []).filter(inScope).map((item) => ({
    kind: ROLLOUT_EVENT, date: item.date, from: item.date, days: [item.date], channel: item.channel,
    users: item.users, feature: item.feature ?? null, tone: NEUTRAL, severity: null,
    app_version: item.app_version ?? null, os: item.os ?? null,
  }));
  const incidents = (reference?.incidents ?? []).flatMap((item) => {
    if (isRetailIncident(item)) return [];
    const span = incidentSpan(item);
    if (!span || span.to < period.from || span.from > period.to) return [];
    return [{
      ...span, kind: INCIDENT_EVENT, id: accidentId(item),
      /* Focus остаётся внутри периода; детализация получает все фактические дни. */
      date: span.to > period.to ? period.to : span.to, channel: item.channel,
      effect: item.effect, description: item.description ?? null, tone: NEGATIVE, severity: CRITICAL,
      product: item.product ?? null,
    }];
  });
  return [...incidents, ...rollouts];
}

/*
  J-138: новый срез — значение триггера или версии приложения (платформа и номер, J-128), которого не было ни в одной
  оценке среза до периода, а в периоде появилось. Дата — первый день с ним. Срез — фильтры шапки по всей истории.
  Если первый день значения — первый день всей истории среза, новым его не назвать: раньше данных просто нет
*/
const NEW_SLICE_CUTS = [
  { dimension: 'trigger', values: (row) => [...new Set(row.operations ?? [])] },
  { dimension: 'app_version', values: (row) => { const key = numberedVersionKey(row); return key ? [key] : []; } },
];

export function detectNewSlices({ rows, period }) {
  const start = earliestDate(rows);
  if (!start) return [];
  const events = [];
  for (const { dimension, values } of NEW_SLICE_CUTS) {
    const seen = new Map();
    for (const row of rows) {
      const date = row.appeal_date;
      if (typeof date !== 'string' || date > period.to) continue;
      for (const key of values(row)) {
        const found = seen.get(key) ?? { first: date, ids: new Set(), sum: 0 };
        if (date < found.first) found.first = date;
        if (date >= period.from && !found.ids.has(row.voc_ccode)) {
          found.ids.add(row.voc_ccode);
          found.sum += row.mark;
        }
        seen.set(key, found);
      }
    }
    for (const [key, { first, ids, sum }] of seen) {
      if (first <= start || first < period.from || !ids.size) continue;
      events.push({
        kind: NEW_SLICE_EVENT, dimension, key, date: first, from: first, days: [first],
        ratings: ids.size, value: sum / ids.size, tone: NEUTRAL, severity: null,
      });
    }
  }
  return events;
}

export function coversDay(event, focus) {
  return event.days.includes(focus);
}

/* «Влияние» (R-45): аварии, ниже плана, негатив, позитив, раскатки, нейтральное */
function influenceRank(event) {
  if (event.kind === INCIDENT_EVENT) return 0;
  if (event.kind === ROLLOUT_EVENT) return 4;
  if (event.kind === NEW_SLICE_EVENT) return 5;
  if (event.severity === CRITICAL) return 1;
  return { [NEGATIVE]: 2, [POSITIVE]: 3, [NEUTRAL]: 5 }[event.tone];
}

function withinRank(left, right) {
  if (left.kind === INCIDENT_EVENT) return right.effect - left.effect;
  if (left.kind === ROLLOUT_EVENT) return right.users - left.users;
  if (left.kind === NEW_SLICE_EVENT) return right.ratings - left.ratings || String(left.key).localeCompare(String(right.key), 'ru');
  return Math.abs(right.deviation ?? 0) - Math.abs(left.deviation ?? 0) || compareAnomalies(left, right);
}

const KIND_ORDER = { [INCIDENT_EVENT]: 0, [ROLLOUT_EVENT]: 1, [ANOMALY_EVENT]: 2, [SUSTAINED_EVENT]: 3, [NEW_SLICE_EVENT]: 4 };

export function sortEvents(events, mode = 'chronology') {
  const copy = [...events];
  if (mode === 'duration') return copy.sort((left, right) =>
    right.streak - left.streak || right.date.localeCompare(left.date) || String(left.key).localeCompare(String(right.key), 'ru'));
  if (mode === 'influence') {
    return copy.sort((left, right) =>
      influenceRank(left) - influenceRank(right) || withinRank(left, right) || right.date.localeCompare(left.date));
  }
  if (mode === 'chronology') {
    return copy.sort((left, right) =>
      right.date.localeCompare(left.date) || KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      (left.kind === INCIDENT_EVENT ? String(right.ended_at ?? '').localeCompare(String(left.ended_at ?? '')) : 0) ||
      (left.kind === ANOMALY_EVENT ? compareAnomalies(left, right) : withinRank(left, right)));
  }
  throw new Error(`Режим сортировки не поддерживается: ${mode}`);
}
