/** События «Календаря событий» (R-43 – R-45); методика — `docs/calc-core.md`, «События календаря». */

import { ABOVE, BELOW, VOC_METRIC, compareAnomalies, isWorkingDay, workingDays } from './anomalies.js';
import { numberedVersionKey, splitVersionKey, versionKey } from './antidrivers.js';
import { earliestDate, daysBetween, shiftDay } from './dates.js';
import { UNLABELLED } from './breakdown.js';
import { DIMENSIONS, osName } from './dimensions.js';
import { formatCompactDuration, plural } from './format.js';
import { accidentId, incidentSpan, isRetailIncident } from './incident-events.js';
import { COMPLAINT_SUBJECT, CRITICAL, NEGATIVE, NEUTRAL, POSITIVE, anomalySubject } from './insights.js';

export const ANOMALY_EVENT = 'anomaly';
export const ROLLOUT_EVENT = 'rollout';
export const INCIDENT_EVENT = 'incident';
/* Аварии из incidents и расчётные инциденты — разные виды. */
export const SUSTAINED_EVENT = 'sustained-incident';
/* J-138: новый срез — впервые пришли оценки по триггеру, роли, сегменту или продукту; версии с J-191 — у релизов */
export const NEW_SLICE_EVENT = 'new-slice';
/* J-191: релиз версии АБМ — дата релиза из листа раскаток против даты первых оценок по версии */
export const RELEASE_EVENT = 'release';
/* J-191: пропажа данных — разрез с регулярным потоком оценок перестал их получать или получает в разы меньше */
export const DATA_LOSS_EVENT = 'data-loss';
/* Через сколько дней после релиза отсутствие оценок по версии — уже не «ещё не дошли», а сигнал */
export const RELEASE_LAG_DAYS = 3;

/* Цвет события — тон точки и тега; красный и зелёный — тоны негатива и позитива каркаса */
export const RED = 'negative';
export const ORANGE = 'orange';
export const YELLOW = 'yellow';
export const PURPLE = 'purple';
export const GREEN = 'positive';
/* J-191: проблема со сбором оценок — пропажа данных и релиз без оценок или с задержкой */
export const DATA_TONE = 'data-loss';

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
  if (event.kind === ROLLOUT_EVENT) {
    const channel = event.channel ?? event.shownChannel;
    return { label: channel ? `Раскатка ${channel}` : 'Раскатка', color: 'neutral' };
  }
  if (event.kind === NEW_SLICE_EVENT) return { label: 'Новый срез', color: PURPLE };
  if (event.kind === DATA_LOSS_EVENT) return { label: event.streak > 1 ? `Провал оценок ${event.streak}\u00a0дн` : 'Провал оценок', color: DATA_TONE };
  if (event.kind === RELEASE_EVENT) {
    if (event.status === 'missing') return { label: 'Релиз без оценок', color: DATA_TONE };
    if (event.status === 'late') return { label: `Релиз: оценки через ${event.lag}\u00a0дн`, color: DATA_TONE };
    return { label: 'Релиз АБМ', color: 'neutral' };
  }
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

/** Номер версии покомпонентно: «16.2» новее «13.15.3», суффикс сборки («16.2.0 (1234)») не мешает; без числа в начале — `null`. */
export function versionParts(version) {
  const match = String(version ?? '').trim().match(/^\d+(\.\d+)*/);
  return match ? match[0].split('.').map(Number) : null;
}

/* Версия, с которой сравнивают: хотя бы столько оценок за всю историю или строка релиза — случайная оценка бета-сборки «99.0» не прячет релизы ОС */
export const RELEASE_BASELINE_RATINGS = 5;

export function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/*
  J-191: версия без строки релиза — релиз, только если она новее всех версий своей ОС, у которых оценки были раньше.
  Старая версия, впервые давшая оценку (у кого-то ещё стоит сборка 2023 года), — не релиз; нечисловой номер — тоже
*/
function newerThanSeen(key, first, versions, baseline) {
  const { os, version } = splitVersionKey(key);
  const parts = versionParts(version);
  if (!parts) return false;
  for (const [other, { first: otherFirst }] of versions) {
    if (other === key || otherFirst >= first || !baseline.has(other)) continue;
    const seen = splitVersionKey(other);
    const seenParts = seen.os === os ? versionParts(seen.version) : null;
    if (seenParts && compareVersions(parts, seenParts) <= 0) return false;
  }
  return true;
}

/* ОС ключа версии «iOS 15.1.1»: подписи ОС — одно слово (iOS, Android) */
const versionOs = (key) => splitVersionKey(key).os;

const isRelease = (item) => Boolean(String(item.app_version ?? '').trim());

/** J-22: раскатки текущего/всех каналов; аварии любых каналов, пересекающие период. Раскатка с версией — релиз (J-191). */
export function channelEvents(reference, { channel, period }) {
  const inScope = (item) => (item.channel === null || item.channel === channel) && item.date >= period.from && item.date <= period.to;
  const rollouts = (reference?.rollouts ?? []).filter((item) => inScope(item) && !isRelease(item)).map((item) => ({
    /* `shownChannel` — канал ленты: раскатка «на все каналы» подписана им, как чип («Раскатка НИБ») */
    kind: ROLLOUT_EVENT, date: item.date, from: item.date, days: [item.date], channel: item.channel, shownChannel: channel ?? null,
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
  Первый день и оценки с ним до конца периода: по ним «Релиз АБМ» видит, когда версия появилась.
  Первый день ищется по всей переданной истории, в том числе после периода: релиз, оценки по которому пришли после
  конца периода, — не «без оценок»
*/
function firstSeen(rows, values, period) {
  const seen = new Map();
  for (const row of rows) {
    const date = row.appeal_date;
    if (typeof date !== 'string') continue;
    for (const key of new Set(values(row))) {
      if (!key) continue;
      const found = seen.get(key) ?? { first: date, ids: new Set(), sum: 0 };
      if (date < found.first) found.first = date;
      if (date >= period.from && date <= period.to && !found.ids.has(row.voc_ccode)) {
        found.ids.add(row.voc_ccode);
        found.sum += row.mark;
      }
      seen.set(key, found);
    }
  }
  return seen;
}

/* J-138: новый срез — триггер, роль, сегмент или продукт; версии приложения с J-191 — в «Релизах АБМ» */
const NEW_SLICE_CUTS = ['trigger', 'role', 'segment', 'product'].map((key) => DIMENSIONS.find((dimension) => dimension.key === key));

/* Новый срез — когда по новому значению пошёл поток: в один день от стольких уникальных оценок (порог предложила заказчик) */
export const NEW_SLICE_MIN_DAILY = 5;

/* Служебные значения-заглушки разреза — не новые срезы: так подписаны оценки без сопоставления, сегмента, разметки */
const PLACEHOLDERS = new Set([UNLABELLED, 'Без сопоставления', 'Без сегмента']);

/*
  Значение, которого раньше не было, считается новым срезом, когда по нему пошёл поток: первый день с
  `NEW_SLICE_MIN_DAILY` уникальными оценками и больше, а до него — меньше этого числа оценок в сумме. Единичные
  оценки нового значения событием не считаются. Значение из первого дня всей истории среза — не новое: раньше
  данных просто нет. Оценки и VOC в строке — с дня потока до конца периода
*/
export function detectNewSlices({ rows, reference, period }) {
  const start = earliestDate(rows);
  if (!start) return [];
  const events = [];
  for (const { key: dimension, values } of NEW_SLICE_CUTS) {
    const byKey = new Map();
    for (const row of rows) {
      const date = row.appeal_date;
      if (typeof date !== 'string' || date > period.to) continue;
      for (const key of new Set(values(row, reference))) {
        if (!key || PLACEHOLDERS.has(key)) continue;
        if (!byKey.has(key)) byKey.set(key, new Map());
        const days = byKey.get(key);
        if (!days.has(date)) days.set(date, new Map());
        if (!days.get(date).has(row.voc_ccode)) days.get(date).set(row.voc_ccode, row.mark);
      }
    }
    for (const [key, days] of byKey) {
      const dates = [...days.keys()].sort();
      if (dates[0] <= start) continue;
      let before = 0;
      const flow = dates.find((date) => {
        if (days.get(date).size >= NEW_SLICE_MIN_DAILY) return true;
        before += days.get(date).size;
        return false;
      });
      if (!flow || flow < period.from || before >= NEW_SLICE_MIN_DAILY) continue;
      const marks = new Map();
      for (const date of dates) if (date >= flow) for (const [code, mark] of days.get(date)) marks.set(code, mark);
      const total = [...marks.values()].reduce((sum, mark) => sum + mark, 0);
      events.push({
        kind: NEW_SLICE_EVENT, dimension, key, date: flow, from: flow, days: [flow], first: dates[0],
        ratings: marks.size, dayRatings: days.get(flow).size, value: total / marks.size, tone: NEUTRAL, severity: null,
      });
    }
  }
  return events;
}

/* Ключ версии из листа раскаток — как у строки тепловой карты (J-128): «iOS 15.1.1»; без ОС — только номер */
function releaseVersion(item) {
  const os = osName(item.os);
  const version = versionKey(item.app_version);
  return { os, version, key: os ? `${os} ${version}` : version };
}

/*
  J-191: «Релизы АБМ». Релиз — строка листа раскаток с версией приложения (и ОС). Рядом — первый день оценок по
  этой версии в канале: по нему видно релиз, по которому оценки не пришли или пришли с задержкой. Версия, по
  которой оценки появились в периоде, а строки релиза нет, — тоже релиз, без даты релиза.
  Оценки — все оценки канала без фильтров шапки: сбор оценок по версии от сегмента или триггера не зависит.
  Фильтр ОС шапки оставляет релизы своей ОС
*/
export function detectReleases({ allRows = [], reference, period, channel, filters = {}, dataEnd }) {
  const rows = allRows.filter((row) => !channel || row.channel === channel);
  const start = earliestDate(rows);
  const versions = firstSeen(rows, (row) => [numberedVersionKey(row)], period);
  const osFilter = filters.os?.length ? new Set(filters.os) : null;
  const shown = (os) => !osFilter || !os || osFilter.has(os);
  const inPeriod = (date) => Boolean(date) && date >= period.from && date <= period.to;
  const matched = new Set();
  const events = [];
  /* Повтор строки одной версии (поэтапная раскатка, строка на каждый канал) — один релиз с самой ранней датой */
  const releases = new Map();
  for (const item of reference?.rollouts ?? []) {
    if (!isRelease(item) || (item.channel !== null && item.channel !== channel)) continue;
    const version = releaseVersion(item);
    const known = releases.get(version.key);
    if (!known) releases.set(version.key, { ...version, item, features: new Set(item.feature ? [item.feature] : []) });
    else {
      if (item.feature) known.features.add(item.feature);
      if (item.date < known.item.date) known.item = { ...item, users: item.users ?? known.item.users };
    }
  }
  for (const { os, version, key, item, features } of releases.values()) {
    /* Без ОС в строке — версия обеих платформ; фильтр ОС шапки оставляет свою */
    const keys = os ? [key] : [...versions.keys()].filter((candidate) => candidate.endsWith(` ${version}`) && shown(versionOs(candidate)));
    keys.forEach((candidate) => matched.add(candidate));
    const found = keys.map((candidate) => versions.get(candidate)).filter(Boolean);
    const first = found.length ? found.reduce((min, { first: date }) => (date < min ? date : min), found[0].first) : null;
    if (!shown(os) || !(inPeriod(item.date) || inPeriod(first))) continue;
    const ids = new Set(found.flatMap(({ ids: codes }) => [...codes]));
    const sum = found.reduce((total, { sum: marks }) => total + marks, 0);
    events.push(releaseEvent({
      key, os, app_version: item.app_version, feature: features.size ? [...features].join(', ') : null, users: item.users ?? null, channel: item.channel,
      releaseDate: item.date, first, fromHistoryStart: Boolean(first) && first <= start, ratings: ids.size, sum, dataEnd,
    }));
  }
  /* С чем сравнивать новую версию: версии с релизом в листе и версии с заметным числом оценок за всю историю */
  const totals = new Map();
  for (const row of rows) {
    const key = numberedVersionKey(row);
    if (key) (totals.get(key) ?? totals.set(key, new Set()).get(key)).add(row.voc_ccode);
  }
  const baseline = new Set([...matched, ...[...totals].filter(([, codes]) => codes.size >= RELEASE_BASELINE_RATINGS).map(([key]) => key)]);
  for (const [key, { first, ids, sum }] of versions) {
    const os = versionOs(key);
    if (matched.has(key) || first <= start || !inPeriod(first) || !ids.size || !shown(os) || !newerThanSeen(key, first, versions, baseline)) continue;
    events.push(releaseEvent({ key, os, app_version: splitVersionKey(key).version, channel, releaseDate: null, first, ratings: ids.size, sum, dataEnd }));
  }
  return events;
}

function releaseEvent({ releaseDate, first, ratings, sum, dataEnd, fromHistoryStart = false, ...item }) {
  const lag = releaseDate && first && !fromHistoryStart ? daysBetween(releaseDate, first) : null;
  const waited = releaseDate && dataEnd ? daysBetween(releaseDate, dataEnd) : 0;
  const status = !releaseDate ? 'no-date'
    : !first ? (waited >= RELEASE_LAG_DAYS ? 'missing' : 'pending')
      : fromHistoryStart ? 'ok'
        : lag > RELEASE_LAG_DAYS ? 'late' : lag < 0 ? 'early' : 'ok';
  const date = releaseDate ?? first;
  const days = [...new Set([releaseDate, first].filter(Boolean))].sort();
  return {
    ...item, kind: RELEASE_EVENT, dimension: 'app_version', date, from: date, days, releaseDate, firstDate: first,
    fromHistoryStart, lag, waited, status, ratings, value: ratings ? sum / ratings : null,
    tone: status === 'missing' || status === 'late' ? NEGATIVE : NEUTRAL, severity: null,
  };
}

export function coversDay(event, focus) {
  return event.days.includes(focus);
}

/* «Влияние» (R-45): аварии, ниже плана, негатив, позитив, раскатки, нейтральное */
function influenceRank(event) {
  if (event.kind === INCIDENT_EVENT) return 0;
  if (event.kind === ROLLOUT_EVENT) return 4;
  if (event.kind === NEW_SLICE_EVENT) return 5;
  if (event.kind === RELEASE_EVENT) return 4;
  if (event.kind === DATA_LOSS_EVENT) return 1;
  if (event.severity === CRITICAL) return 1;
  return { [NEGATIVE]: 2, [POSITIVE]: 3, [NEUTRAL]: 5 }[event.tone];
}

function withinRank(left, right) {
  /* В одном ранге бывают разные виды (релиз и раскатка, пропажа и снижение): правило вида сравнивает только свой вид */
  if (left.kind !== right.kind && [RELEASE_EVENT, ROLLOUT_EVENT, DATA_LOSS_EVENT].some((kind) => kind === left.kind || kind === right.kind)) {
    return KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  }
  if (left.kind === INCIDENT_EVENT) return right.effect - left.effect;
  if (left.kind === ROLLOUT_EVENT) return right.users - left.users;
  if (left.kind === RELEASE_EVENT) return String(left.key).localeCompare(String(right.key), 'ru');
  if (left.kind === DATA_LOSS_EVENT) return right.before - left.before || String(left.key).localeCompare(String(right.key), 'ru');
  if (left.kind === NEW_SLICE_EVENT) return right.ratings - left.ratings || String(left.key).localeCompare(String(right.key), 'ru');
  return Math.abs(right.deviation ?? 0) - Math.abs(left.deviation ?? 0) || compareAnomalies(left, right);
}

const KIND_ORDER = { [INCIDENT_EVENT]: 0, [RELEASE_EVENT]: 1, [ROLLOUT_EVENT]: 2, [DATA_LOSS_EVENT]: 3, [ANOMALY_EVENT]: 4, [SUSTAINED_EVENT]: 5, [NEW_SLICE_EVENT]: 6 };

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
