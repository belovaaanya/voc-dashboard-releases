/** J-20: календарный поток отделён от таблицы аномалий и входа LLM. */
import {
  ANOMALY_TRACKS, BELOW, VOC_METRIC, MIN_EVENT_RATINGS,
  detectAnomalies, distinctAnomalies, isWorkingDay, measureEvents, sampledSeries, workingDays,
} from './anomalies.js';
import { earliestDate, latestDate } from './dates.js';
import { ignoredCauseKey } from './analytical-causes.js';
import { breakdown, UNLABELLED } from './breakdown.js';
import { ANOMALY_EVENT, SUSTAINED_EVENT, collapseSeries, sortEvents } from './calendar.js';
import { CRITICAL_DROP_MIN_WINDOW_RATINGS, dropVerdicts, hasDropWindow } from './critical-drop.js';
import { CRITICAL, NEGATIVE, describeAnomaly } from './insights.js';
import { createLabels } from './labels.js';
import { planFor, BELOW_PLAN } from './plan.js';

const VOC_TRACKS = ANOMALY_TRACKS.filter(({ metric }) => metric === VOC_METRIC);
export const INCIDENT_MIN_DAYS = 3;
export const INCIDENT_PLAN_GAP = 0.05;
export const INCIDENT_TOP_TRIGGERS = 15;
/*
  Объём (J-286, неделя 16–22.11): VOC дня из двух-трёх оценок — разброс, а не сбой. День входит в серию от 5 оценок
  триггера; серия — инцидент от 30 оценок за все её дни, как минимум окна у «Крит. снижения VOC»
*/
export const INCIDENT_MIN_DAY_RATINGS = 5;
export const INCIDENT_MIN_RATINGS = CRITICAL_DROP_MIN_WINDOW_RATINGS;

/** Будни сравниваются с рабочими датами, выходные — с календарными; пропуски не расширяют окно. */
export function calendarAnomalies({ rows, reference, period, channel, filters = {}, dataEnd = latestDate(rows), minimumRatings = MIN_EVENT_RATINGS }) {
  if (!rows.length) return [];
  const historyPeriod = { from: earliestDate(rows), to: period.to };
  const detect = (includeWeekends) => measureEvents({
    anomalies: distinctAnomalies(detectAnomalies({
      rows, reference, period: historyPeriod, channel, filters, dataEnd, tracks: VOC_TRACKS, includeWeekends, verdictsOf: dropVerdicts,
    })).filter(({ date, direction }) => direction === BELOW && isWorkingDay(date) !== includeWeekends),
    rows, period, reference, minimumRatings,
  }).map((anomaly) => ({ ...describeAnomaly(anomaly), calendar: true, windowKind: includeWeekends ? 'calendar' : 'working' }));
  const weekdays = collapseSeries(detect(false), period);
  // У выходного другое окно; не соединяем его с серией по рабочим окнам.
  const weekends = detect(true).filter(({ date }) => date >= period.from).map((anomaly) => ({
    ...anomaly, kind: ANOMALY_EVENT, from: anomaly.date, days: [anomaly.date], streak: 1,
    belowPlanDays: anomaly.planStatus === BELOW_PLAN ? 1 : 0, startsBeforePeriod: false,
  }));
  return sortEvents([...weekdays, ...weekends]);
}

/**
 * Оценил ли календарь хоть один разрез хоть в один день периода: окно своё у каждого разреза, поэтому
 * весь срез за него не отвечает. Будни и выходные — каждый в своём окне, как в `calendarAnomalies`.
 * `day` сужает проверку до дня, а конец истории остаётся от периода: тот же кэш, что у календаря.
 */
export function hasEvaluatedSlice({ rows, reference, period, day = null, dataEnd = latestDate(rows) }) {
  if (!rows.length) return false;
  const end = dataEnd < period.to ? dataEnd : period.to;
  return [false, true].some((includeWeekends) => {
    const { days, series } = sampledSeries({ rows, reference, end, tracks: VOC_TRACKS, includeWeekends });
    const inPeriod = days.flatMap((date, index) => (date >= period.from && (day === null || date === day) && isWorkingDay(date) !== includeWeekends ? [index] : []));
    return series.some((samples) => inPeriod.some((index) => hasDropWindow(samples, index)));
  });
}

/**
 * Топ-15 триггеров зафиксирован: по всей выгрузке канала, без фильтров шапки и без периода — список не меняется
 * при смене периода, дней или фильтров. Серии VOC ниже плана ищутся по оценкам среза (`rows`).
 */
/* Топ зависит только от выгрузки, канала и справочника: смена периода и фильтров его не пересчитывает */
const topCache = new WeakMap();

function topTriggers(allRows, channel, reference) {
  if (!topCache.has(allRows)) topCache.set(allRows, new Map());
  const byChannel = topCache.get(allRows);
  const cached = byChannel.get(channel ?? null);
  if (cached?.reference === reference) return cached.ranked;
  const label = createLabels(reference);
  const ranked = breakdown(allRows.filter((row) => !channel || row.channel === channel), (row) => row.operations ?? [])
    .filter(({ key }) => key !== UNLABELLED && !ignoredCauseKey('trigger', key, label))
    .sort((a, b) => b.mentions - a.mentions || String(a.key).localeCompare(String(b.key), 'ru'))
    .slice(0, INCIDENT_TOP_TRIGGERS);
  byChannel.set(channel ?? null, { reference, ranked });
  return ranked;
}

/** `minDayRatings` и `minRatings` — объём дня и серии; тесты других правил снимают их нулём, как `minimumRatings` у снижений. */
export function detectIncidents({
  rows, allRows = rows, reference, period, channel, dataEnd = latestDate(rows),
  minDayRatings = INCIDENT_MIN_DAY_RATINGS, minRatings = INCIDENT_MIN_RATINGS,
}) {
  if (!rows.length) return [];
  const project = (row) => row.operations ?? [];
  const ranked = topTriggers(allRows, channel, reference);
  const end = dataEnd < period.to ? dataEnd : period.to;
  const days = workingDays(earliestDate(rows), end);
  const byDay = new Map(days.map((date) => [date, []]));
  for (const row of rows) byDay.get(row.appeal_date)?.push(row);
  const groups = new Map(days.map((date) => [date, new Map(breakdown(byDay.get(date), project).map((group) => [group.key, group]))]));
  const plans = new Map(days.map((date) => [date, planFor(reference?.plan, { channel, from: date, to: date })]));
  const events = [];
  for (const { key, mentions: totalRatings } of ranked) {
    let run = [];
    const flush = () => {
      const seriesRatings = run.reduce((sum, { group }) => sum + group.mentions, 0);
      if (run.length >= INCIDENT_MIN_DAYS && seriesRatings >= minRatings && run.at(-1).date >= period.from) {
        const last = run.at(-1);
        /* Серия целиком: VOC и отрыв от нижней границы плана — по всем её оценкам, а не по последнему дню */
        const weighted = (value) => run.reduce((sum, item) => sum + value(item) * item.group.mentions, 0) / seriesRatings;
        events.push({
          kind: SUSTAINED_EVENT, channel, dimension: 'trigger', key, metric: VOC_METRIC, direction: BELOW,
          from: run[0].date, date: last.date, days: run.map(({ date }) => date), streak: run.length,
          startsBeforePeriod: run[0].date < period.from, totalRatings,
          value: last.group.voc, dayVoc: last.group.voc, ratings: last.group.mentions,
          plan: last.plan, planStatus: BELOW_PLAN, planGap: last.plan.min - last.group.voc,
          seriesRatings, seriesVoc: weighted(({ group }) => group.voc),
          seriesGap: weighted(({ group, plan }) => plan.min - group.voc),
          /* По дням — для вклада в VOC канала за дни, видимые на графике (серия может начаться до периода) */
          seriesByDay: run.map(({ date, group, plan }) => ({ date, ratings: group.mentions, voc: group.voc, gap: plan.min - group.voc })),
          tone: NEGATIVE, severity: CRITICAL,
        });
      }
      run = [];
    };
    for (const date of days) {
      const group = groups.get(date).get(key);
      const plan = plans.get(date);
      if (group && plan && group.mentions >= minDayRatings && plan.min - group.voc > INCIDENT_PLAN_GAP + 1e-9) run.push({ date, group, plan });
      else flush();
    }
    flush();
  }
  return sortEvents(events, 'duration');
}
