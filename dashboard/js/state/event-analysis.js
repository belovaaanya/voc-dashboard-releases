/* События среза для «Календаря событий», «Главного вывода» и LLM: расчёт ядром поверх контекста и кэш (J-178) */
import { MIN_EVENT_RATINGS, detectAnomalies, distinctAnomalies, measureEvents } from '../core/anomalies.js';
import { earliestDate, latestDate } from '../core/dates.js';
import { calendarAnomalies, detectIncidents } from '../core/calendar-analysis.js';
import { channelEvents, detectNewSlices, detectReleases } from '../core/calendar.js';
import { detectDataLoss } from '../core/data-loss.js';
import { selectionDays } from './chart-selection.js';
import { attachAgentAnswers, describeAnomaly } from '../core/insights.js';
import { recentCache } from '../core/recent.js';

const analysisCache = recentCache();
const calendarCache = recentCache();

export const hasFilters = (filters) => Object.values(filters ?? {}).some((values) => values?.length);

/* Окно первых дней периода лежит до его начала, поэтому срез берётся по всей истории (`D-47`) */
export function historyOf(context) {
  const from = earliestDate(context.rows);
  if (!from || from > context.period.to) return [];
  return context.select({ from, to: context.period.to }).rows;
}

/* Порог малого разреза приходит в контексте только из тестов: фикстуры там меньше ста оценок */
const minimumOf = (context) => context.minimumEventRatings ?? MIN_EVENT_RATINGS;
const sameReference = (reference) => (cached) => cached.reference === reference;

function analysisKey({ state, period, ...context }) {
  return JSON.stringify([state.channel, state.filters ?? {}, period.from, period.to, minimumOf(context)]);
}

function calendarKey({ state, period, ...context }) {
  const rankingPeriod = context.rankingPeriod ?? period;
  return JSON.stringify([state.channel, state.filters ?? {}, period.from, period.to, rankingPeriod.from, rankingPeriod.to, minimumOf(context)]);
}

/** Аномалии среза уже посчитаны или не нужны (пустой срез): «Главный вывод» нарисуется без долгого расчёта. */
export function conclusionReady(context) {
  return !context.slice.length || analysisCache.has(context.rows, analysisKey(context), sameReference(context.reference));
}

/** События календаря среза уже посчитаны или не нужны: календарь нарисуется без долгого расчёта. */
export function calendarReady(context) {
  if (!context.rows.length) return true;
  const calendar = eventSelectionContext(context);
  return calendarCache.has(calendar.rows, calendarKey(calendar), sameReference(calendar.reference));
}

function analysisOf(context) {
  const { rows, state, period, reference } = context;
  const minimumRatings = minimumOf(context);
  return analysisCache(rows, analysisKey(context), () => {
    const history = historyOf(context);
    const dataEnd = latestDate(rows);
    /* События малых разрезов не показываются, у остальных — VOC дня и дельта к прошлому рабочему дню (R-25, R-27) */
    const insights = measureEvents({
      anomalies: distinctAnomalies(detectAnomalies({ rows: history, reference, period, channel: state.channel, dataEnd })),
      rows: history,
      period,
      reference,
      minimumRatings,
    }).map(describeAnomaly);
    return {
      reference,
      /* Агент отвечал на таблицу без фильтров: под фильтром те же ключи несут другие числа (`D-51`) */
      insights: hasFilters(state.filters) ? insights : attachAgentAnswers(insights, reference?.insights, context.label),
    };
  }, sameReference(reference));
}

/** Аномалии периода по дню на строку — вход «Главного вывода» и таблицы агента; с ответами агента без фильтров (`D-51`). */
export function insightsOf(context) {
  return analysisOf(context).insights;
}

/** События календаря (R-43 – R-45): серии аномалий одной строкой, раскатки, релизы и аварии канала, пропажи данных. */
export function calendarEventsOf(context) {
  const { rows, state, period, reference } = context;
  const rankingPeriod = context.rankingPeriod ?? period;
  const minimumRatings = minimumOf(context);
  return calendarCache(rows, calendarKey(context), () => {
    const history = rows.length ? historyOf(context) : [];
    /* Релизы сверяют версии по всем оценкам канала: сбор оценок по версии от фильтров шапки не зависит (J-191) */
    const params = { rows: history, allRows: rows, reference, period, rankingPeriod, channel: state.channel, filters: state.filters, dataEnd: latestDate(rows), minimumRatings };
    return { reference, events: [...calendarAnomalies(params), ...channelEvents(reference, params), ...detectReleases(params),
      ...detectDataLoss(params), ...detectIncidents(params), ...detectNewSlices(params)] };
  }, sameReference(reference)).events;
}

/* Выбор в local period графика может лежать вне общего периода. */
export function eventSelectionContext(context) {
  const days = selectionDays(context.state);
  if (!days.length) return context;
  const from = days[0] < context.period.from ? days[0] : context.period.from;
  const to = days.at(-1) > context.period.to ? days.at(-1) : context.period.to;
  if (from === context.period.from && to === context.period.to) return context;
  const selected = context.select({ from, to });
  return { ...context, period: selected.period, rankingPeriod: context.rankingPeriod ?? context.period, slice: selected.rows };
}
