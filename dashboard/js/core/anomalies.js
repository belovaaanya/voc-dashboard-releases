/**
 * Дневные аномалии (`D-47`): значение рабочего дня вне коридора «среднее ±
 * стандартное отклонение» предыдущих рабочих дней. Методика — `docs/calc-core.md`.
 */

import { breakdown, UNLABELLED } from './breakdown.js';
import { earliestDate, latestDate, shiftDay, weekdayOf } from './dates.js';
import { complaintValues, categoryValues, ignoredCauseKey } from './analytical-causes.js';
import { createLabels } from './labels.js';
import { DIMENSIONS, osName } from './dimensions.js';
import { MARKS } from './metrics.js';
import { planFor, planStatus } from './plan.js';
import { roundVoc } from './round.js';
import { recentSources } from './recent.js';
import { buildTimeSeries } from './timeseries.js';
import { isRestDay } from './rest-days.js';

export const ANOMALY_WINDOW_DAYS = 10;
/** Ширина коридора в σ: «± корень квадратный» заказчика прочитан как √2 (`D-47`). */
export const ANOMALY_BAND_WIDTH = Math.SQRT2;
export const ANOMALY_MIN_WINDOW_VALUES = 2;

export const VOC_METRIC = 'voc';
const FREQUENCY_METRIC = 'frequency';
export const BELOW = 'below';
export const ABOVE = 'above';

/** Ровная история с хвостами плавающей точки не должна давать аномалию. */
const EPSILON = 1e-9;

const VOC_RANGE = { floor: MARKS[0], ceiling: MARKS.at(-1) };
const FREQUENCY_RANGE = { floor: 0, ceiling: Infinity };

const productOf = DIMENSIONS.find(({ key }) => key === 'product').values;

/** Частотность этих разрезов — упоминания проблемы, а не объём оценок. */
export const COMPLAINT_DIMENSIONS = new Set(['problem_type', 'problem', 'category']);

/* ОС — подписью, как в фильтре шапки (R-40): ключ строки совпадает со значением фильтра */
const SLICES = [
  { dimension: 'channel', project: (row) => [row.channel] },
  { dimension: 'segment', project: (row) => [row.segment] },
  { dimension: 'trigger', project: (row) => row.operations ?? [] },
  { dimension: 'product', project: productOf },
  { dimension: 'os', project: (row) => [osName(row.device_os)] },
];

export const ANOMALY_TRACKS = [
  ...SLICES.map((slice) => ({ ...slice, metric: VOC_METRIC, range: VOC_RANGE })),
  ...SLICES.map((slice) => ({ ...slice, metric: FREQUENCY_METRIC, range: FREQUENCY_RANGE })),
  { metric: FREQUENCY_METRIC, dimension: 'problem_type', project: (row, reference) => complaintValues(row, 'problem_type', reference), range: FREQUENCY_RANGE },
  { metric: FREQUENCY_METRIC, dimension: 'problem', project: (row, reference) => complaintValues(row, 'problem', reference), range: FREQUENCY_RANGE },
  { metric: FREQUENCY_METRIC, dimension: 'category', project: categoryValues, range: FREQUENCY_RANGE },
];

/** Будний день по дню недели; праздники здесь не учитываются — их убирает `holidaysAsRest` таблицы аномалий. */
export function isWorkingDay(isoDate) {
  const weekday = weekdayOf(isoDate);
  return weekday >= 1 && weekday <= 5;
}

export function workingDays(from, to) {
  if (from > to) return [];
  return buildTimeSeries([], { from, to }, 'day')
    .map(({ from: day }) => day)
    .filter(isWorkingDay);
}

/** Рабочие дни окна, с которым сравнивается день: те же, что у коридора `D-47`. */
export function anomalyWindow(date, window = ANOMALY_WINDOW_DAYS) {
  const days = [];
  for (let day = shiftDay(date, -1); days.length < window; day = shiftDay(day, -1)) {
    if (isWorkingDay(day)) days.unshift(day);
  }
  return { from: days[0], to: days.at(-1) };
}

/**
 * `values` — значения подряд идущих рабочих дней, `null` — данных нет.
 * Вердикт на каждый день; `null`, если у дня нет значения или окно короче минимума.
 */
export function bandVerdicts(
  values,
  { window = ANOMALY_WINDOW_DAYS, width = ANOMALY_BAND_WIDTH, floor = -Infinity, ceiling = Infinity } = {},
) {
  const verdicts = [];

  values.forEach((value, index) => {
    const history = values.slice(Math.max(0, index - window), index).filter((item) => item !== null);
    if (value === null || history.length < ANOMALY_MIN_WINDOW_VALUES) {
      verdicts.push(null);
      return;
    }

    const mean = history.reduce((sum, item) => sum + item, 0) / history.length;
    const std = Math.sqrt(history.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (history.length - 1));
    const low = Math.max(floor, mean - width * std);
    const high = Math.min(ceiling, mean + width * std);
    const direction = value < low - EPSILON ? BELOW : value > high + EPSILON ? ABOVE : null;
    const previous = verdicts[index - 1];
    const streak = direction ? (previous?.direction === direction ? previous.streak + 1 : 1) : 0;
    const delta = value - mean;

    verdicts.push({
      value,
      mean,
      std,
      low,
      high,
      delta,
      deviation: std > EPSILON ? delta / std : null,
      direction,
      streak,
      windowValues: history.length,
    });
  });

  return verdicts;
}

/**
 * `rows` — оценки канала без обрезки по датам: окно первых дней лежит до периода.
 * `dataEnd` — последний день всей выгрузки: после него нули частотности выдуманы.
 * `verdictsOf` — другое правило по оценкам дней вместо коридора (`D-62`, только календарь).
 * `holidaysAsRest` — праздник в будний день считается выходным (`isRestDay`): его нет ни в окне, ни среди оцениваемых
 * дней, поэтому он не даёт провала частотности и не расширяет коридор. Только таблица аномалий главного вывода;
 * календарь делит дни на будни и выходные по дню недели и опцию не передаёт.
 */
export function detectAnomalies({
  rows,
  reference = null,
  period,
  channel,
  dataEnd = latestDate(rows),
  tracks = ANOMALY_TRACKS,
  window,
  includeWeekends = false,
  verdictsOf = null,
  holidaysAsRest = false,
}) {
  const end = dataEnd < period.to ? dataEnd : period.to;
  if (end < period.from) return [];
  const history = dailyHistory(rows, end, includeWeekends, reference, holidaysAsRest && !includeWeekends);
  if (history.days === null) return [];
  const { days, rowsByDay } = history;
  const span = window ?? ANOMALY_WINDOW_DAYS;

  const anomalies = [];
  const label = createLabels(reference);
  for (const track of tracks) {
    const { groupsByDay, membersByDay, keys: allKeys } = dailyGroups(history, track.project, reference);
    const samplesByDay = verdictsOf ? dailySamples(history, track.project, reference) : null;

    for (const key of evaluatedKeys(track, allKeys, label)) {
      const verdicts = verdictsOf
        ? verdictsOf(samplesByDay.map((samples) => samples.get(key) ?? null), { window })
        : bandVerdicts(groupsByDay.map((groups) => valueOf(track.metric, groups.get(key))), { window, ...track.range });

      days.forEach((date, index) => {
        const verdict = verdicts[index];
        if (date < period.from || !verdict?.direction) return;
        anomalies.push({
          date,
          channel,
          metric: track.metric,
          dimension: track.dimension,
          key,
          ...verdict,
          ratings: track.metric === VOC_METRIC ? groupsByDay[index].get(key).mentions : rowsByDay.get(date).length,
          ...planOf(reference, { track, channel, key, date }, verdict.value),
          members: membersByDay.slice(Math.max(0, index - span), index + 1).map((members) => members.get(key) ?? NO_MEMBERS),
        });
      });
    }
  }

  return markDuplicates(anomalies).sort(compareAnomalies);
}

/* Ключи, которым считается вердикт: без пустой разметки и без причин, исключённых из анализа */
function evaluatedKeys({ dimension }, allKeys, label) {
  return [...allKeys].filter((key) => key !== UNLABELLED && !ignoredCauseKey(dimension, key, label));
}

/**
 * Оценки дней по каждому ключу каждого разреза — ровно то, что получает `verdictsOf`:
 * по ним тексты блока объясняют пустой календарь теми же числами, что и вердикт (`D-62`).
 */
export function sampledSeries({ rows, reference = null, end, tracks, includeWeekends = false }) {
  const history = dailyHistory(rows, end, includeWeekends, reference);
  if (history.days === null) return { days: [], series: [] };
  const label = createLabels(reference);
  const series = tracks.flatMap((track) => {
    const { keys } = dailyGroups(history, track.project, reference);
    const samplesByDay = dailySamples(history, track.project, reference);
    return evaluatedKeys(track, keys, label).map((key) => samplesByDay.map((samples) => samples.get(key) ?? null));
  });
  return { days: history.days, series };
}

/*
  Дневные группы зависят только от истории, последнего дня, набора дней и проекции: VOC и частотность
  одного разреза, таблица аномалий и календарь на той же истории считают их один раз
*/
const HISTORY_LIMIT = 4;
const histories = recentSources(HISTORY_LIMIT);

function dailyHistory(rows, end, includeWeekends, reference, holidaysAsRest = false) {
  return histories(rows, `days|${end}|${includeWeekends}|${holidaysAsRest}`, () => {
    const dated = rows.filter(({ appeal_date: date }) => date <= end);
    if (dated.length === 0) return { reference, days: null };
    /* J-20: opt-in только для выходных календаря; таблица агента сохраняет рабочие дни, без праздников в будни. */
    const days = includeWeekends
      ? buildTimeSeries([], { from: earliestDate(dated), to: end }, 'day').map(({ from }) => from)
      : workingDays(earliestDate(dated), end).filter((day) => !holidaysAsRest || !isRestDay(day));
    const rowsByDay = new Map(days.map((day) => [day, []]));
    for (const row of dated) rowsByDay.get(row.appeal_date)?.push(row);
    return { reference, days, rowsByDay, rowIndex: new Map(dated.map((row, index) => [row, index])), byProject: new Map(), samplesByProject: new Map() };
  }, (cached) => cached.reference === reference);
}

function dailyGroups({ days, rowsByDay, rowIndex, byProject }, trackProject, reference) {
  if (!byProject.has(trackProject)) {
    const project = (row) => trackProject(row, reference);
    const groupsByDay = days.map((day) => new Map(breakdown(rowsByDay.get(day), project).map((group) => [group.key, group])));
    byProject.set(trackProject, {
      groupsByDay,
      membersByDay: days.map((day) => membersOf(rowsByDay.get(day), project, rowIndex)),
      keys: new Set(groupsByDay.flatMap((groups) => [...groups.keys()])),
    });
  }
  return byProject.get(trackProject);
}

/* Оценки разреза по дням для правила `D-62`: одна оценка на разрез, как в `breakdown`; первая запись кода побеждает */
function dailySamples({ days, rowsByDay, samplesByProject }, trackProject, reference) {
  if (!samplesByProject.has(trackProject)) {
    samplesByProject.set(trackProject, days.map((day) => {
      const marks = new Map();
      for (const row of rowsByDay.get(day)) {
        for (const key of new Set(trackProject(row, reference) ?? [])) {
          if (!marks.has(key)) marks.set(key, new Map());
          const codes = marks.get(key);
          if (!codes.has(row.voc_ccode)) codes.set(row.voc_ccode, row.mark);
        }
      }
      return new Map([...marks].map(([key, codes]) => [key, markSample(codes.values())]));
    }));
  }
  return samplesByProject.get(trackProject);
}

/** Оценки дня: сколько каких, сколько всего и VOC (`D-62`). */
export function markSample(marks) {
  const counts = Object.fromEntries(MARKS.map((mark) => [mark, 0]));
  let sum = 0;
  let n = 0;
  for (const mark of marks) {
    counts[mark] += 1;
    sum += mark;
    n += 1;
  }
  return { counts, n, mean: n === 0 ? null : sum / n };
}

/** Событие на разрезе, где за период меньше стольких оценок, не показывается (R-25). */
export const MIN_EVENT_RATINGS = 100;

function daySlices(rows, project, reference) {
  const slices = new Map();
  for (const row of rows) {
    for (const key of new Set(project(row, reference))) {
      if (!slices.has(key)) slices.set(key, new Map());
      const days = slices.get(key);
      if (!days.has(row.appeal_date)) days.set(row.appeal_date, []);
      days.get(row.appeal_date).push(row);
    }
  }
  return new Map([...slices].map(([key, days]) => [key, { days, dates: [...days.keys()].sort(), vocByDay: new Map() }]));
}

function periodRatingsIn({ days, dates }, period) {
  const codes = new Set();
  for (const date of dates) {
    if (date < period.from || date > period.to) continue;
    for (const { voc_ccode: code } of days.get(date)) codes.add(code);
  }
  return codes.size;
}

/**
 * Разрез события за период и за его день (R-25, R-27): оценок разреза за период, VOC разреза в день
 * события и в предыдущий рабочий день, когда у разреза были оценки. События малых разрезов отбрасываются.
 */
/** `holidaysAsRest` — как у `detectAnomalies`: прошлый рабочий день для дельты VOC — не праздник. */
export function measureEvents({ anomalies, rows, period, reference = null, minimumRatings = MIN_EVENT_RATINGS, holidaysAsRest = false }) {
  const workday = holidaysAsRest ? (date) => !isRestDay(date) : isWorkingDay;
  /* Один проход по оценкам на разрез, а не на каждый ключ: событий много, оценок — десятки тысяч */
  const slicesByDimension = histories(rows, 'slices', () => ({ reference, byDimension: new Map() }),
    (cached) => cached.reference === reference).byDimension;
  const slicesOf = (dimension) => {
    if (!slicesByDimension.has(dimension)) {
      const { project } = ANOMALY_TRACKS.find((track) => track.dimension === dimension);
      slicesByDimension.set(dimension, daySlices(rows, project, reference));
    }
    return slicesByDimension.get(dimension);
  };
  const daysOf = ({ dimension, key }) => slicesOf(dimension).get(key) ?? { days: new Map(), dates: [], vocByDay: new Map() };
  /* Повтор `VOC_CCODE` считается одной оценкой, первая запись побеждает: те же числа, что у `value` и `ratings` события */
  const dayVocOf = ({ days, vocByDay }, key, date) => {
    if (!vocByDay.has(date)) vocByDay.set(date, breakdown(days.get(date), () => [key])[0].voc);
    return vocByDay.get(date);
  };
  /* Событий одного разреза много, оценок — десятки тысяч: разрез за период считается один раз */
  const periodRatingsByKey = new Map();
  const periodRatingsOf = ({ dimension, key }, slice) => {
    const id = `${dimension}\u0000${key}`;
    if (!periodRatingsByKey.has(id)) periodRatingsByKey.set(id, periodRatingsIn(slice, period));
    return periodRatingsByKey.get(id);
  };

  return anomalies.flatMap((anomaly) => {
    const slice = daysOf(anomaly);
    const { days, dates } = slice;
    const periodRatings = periodRatingsOf(anomaly, slice);
    if (periodRatings < minimumRatings) return [];
    const previousDay = dates.filter((date) => date < anomaly.date && workday(date)).at(-1) ?? null;
    const dayVoc = days.has(anomaly.date) ? dayVocOf(slice, anomaly.key, anomaly.date) : null;
    const previousVoc = previousDay ? dayVocOf(slice, anomaly.key, previousDay) : null;
    return [{
      ...anomaly,
      periodRatings,
      dayVoc,
      previousDay,
      vocDelta: dayVoc !== null && previousVoc !== null ? dayVoc - previousVoc : null,
    }];
  });
}

const NO_MEMBERS = Object.freeze({ indexes: Object.freeze([]), hash: '' });

/**
 * Номера оценок каждого ключа за день: по ним строки разных разрезов сравниваются как наборы оценок.
 * Хэш — только поиск кандидата в `markDuplicates`, совпадение подтверждается номерами.
 */
function membersOf(rows, project, rowIndex) {
  const members = new Map();
  for (const row of rows) {
    const index = rowIndex.get(row);
    for (const key of new Set(project(row))) {
      let entry = members.get(key);
      if (!entry) members.set(key, (entry = { indexes: [], first: 0x811c9dc5, second: 7 }));
      entry.indexes.push(index);
      entry.first = Math.imul(entry.first ^ index, 0x01000193);
      entry.second = (Math.imul(entry.second, 31) + index) | 0;
    }
  }
  return new Map([...members].map(([key, { indexes, first, second }]) => [key, { indexes, hash: `${indexes.length}.${first >>> 0}.${second >>> 0}` }]));
}

function sameMembers(left, right) {
  return left.length === right.length && left.every((day, index) => day === right[index]
    || (day.indexes.length === right[index].indexes.length && day.indexes.every((value, at) => value === right[index].indexes[at])));
}

/* При равных наборах оценок остаётся разрез левее: канал, затем более узкий из пары */
const KEEP_ORDER = ['channel', 'segment', 'trigger', 'product', 'os', 'problem', 'problem_type', 'category'];

/**
 * Строка, у которой в день аномалии и во всех днях окна те же оценки, что у разреза
 * левее в `KEEP_ORDER`, повторяет его числа: `duplicateOf` называет оставшуюся строку (`D-49`).
 * Упоминания проблемы и объём оценок — разные выводы; строка со своим вердиктом плана тоже остаётся.
 */
function markDuplicates(anomalies) {
  const kept = new Map();
  const rank = ({ dimension }) => KEEP_ORDER.indexOf(dimension);
  const signature = ({ date, metric, dimension, streak, members }) =>
    `${date}|${metric}|${COMPLAINT_DIMENSIONS.has(dimension)}|${streak}|${members.map(({ hash }) => hash).join('|')}`;
  for (const anomaly of [...anomalies].sort((left, right) => rank(left) - rank(right))) {
    const id = signature(anomaly);
    if (!kept.has(id)) kept.set(id, []);
    const candidates = kept.get(id);
    const original = candidates.find((candidate) => sameMembers(candidate.members, anomaly.members));
    if (!original) candidates.push(anomaly);
    const repeats = original && original.dimension !== anomaly.dimension &&
      (anomaly.planStatus === null || anomaly.planStatus === original.planStatus);
    anomaly.duplicateOf = repeats ? { dimension: original.dimension, key: original.key } : null;
  }
  return anomalies.map(({ members, ...anomaly }) => anomaly);
}

/** Строки, которые видят блок и агент: без копий и без пропаж разрезов в день пропажи всего среза (`D-49`, `D-51`). */
export function distinctAnomalies(anomalies) {
  const outages = new Set(
    anomalies.filter(({ metric, dimension, value }) => metric !== VOC_METRIC && dimension === 'channel' && value === 0).map(({ date }) => date),
  );
  return anomalies.filter(({ metric, dimension, ratings, date, duplicateOf }) =>
    !duplicateOf && !(metric !== VOC_METRIC && dimension !== 'channel' && ratings === 0 && outages.has(date)));
}

/**
 * Сколько рабочих дней периода оценено и сколько из них имели окно: без этого
 * пустой список не отличить от периода из выходных или от начала выгрузки.
 */
export function anomalyCoverage({ rows, period, dataEnd = latestDate(rows) }) {
  const end = dataEnd < period.to ? dataEnd : period.to;
  const start = earliestDate(rows);
  const days = start ? workingDays(start, end) : [];
  return {
    workingDays: days.filter((day) => day >= period.from).length,
    evaluatedDays: days.filter((day, index) => day >= period.from && index >= ANOMALY_MIN_WINDOW_VALUES).length,
  };
}

/** Значение строки таблицы аномалий: VOC — как на дашборде (`D-21`), частотность — целое число оценок. */
export function tableValue({ metric, value }) {
  return metric === VOC_METRIC ? roundVoc(value) : value;
}

/** Рабочий день без оценок разреза: для VOC значения нет, для частотности это ноль — «оценки пропали». */
function valueOf(metric, group) {
  if (metric === VOC_METRIC) return group?.voc ?? null;
  return group?.mentions ?? 0;
}

/**
 * J-14: единый план канала применяется к VOC всех разрезов, но не к частотности.
 * У разреза «канал» канал — сам ключ (`D-42`).
 */
function planOf(reference, { track, channel, key, date }, value) {
  if (track.metric !== VOC_METRIC) return { plan: null, planStatus: null };
  const plan = planFor(reference?.plan, { channel: track.dimension === 'channel' ? key : channel, from: date, to: date });
  return { plan, planStatus: plan ? planStatus(value, plan) : null };
}

const trackIndex = ({ metric, dimension }) =>
  ANOMALY_TRACKS.findIndex((track) => track.metric === metric && track.dimension === dimension);

/** Свежие дни первыми; внутри дня — по силе в σ, нулевой разброс окна — после измеримых. */
export function compareAnomalies(left, right) {
  return (
    right.date.localeCompare(left.date) ||
    Number(left.deviation === null) - Number(right.deviation === null) ||
    Math.abs(right.deviation ?? 0) - Math.abs(left.deviation ?? 0) ||
    String(left.channel ?? '').localeCompare(String(right.channel ?? ''), 'ru') ||
    trackIndex(left) - trackIndex(right) ||
    String(left.key).localeCompare(String(right.key), 'ru')
  );
}
