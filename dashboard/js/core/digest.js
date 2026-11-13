/*
  J-151: VOC-дайджест — месяц канала одним экраном: VOC с поправкой на кэшбек и без неё, оценки, сегменты, антидрайверы
  ДКО, стабильность и детализация темы месяца. Только расчёт; отрисовка — `blocks/digest.js`. Методика —
  docs/blocks-digest.md. Чисел здесь не округляет никто, кроме отрисовки.
*/
import { complaintValues } from './analytical-causes.js';
import { CATEGORY_CUT } from './antidrivers.js';
import { dashboardRows } from './cashback.js';
import { latestDate, shiftDay, weekdayOf } from './dates.js';
import { metricSegments } from './dimensions.js';
import { normalizeLabel } from './labels.js';
import { voc } from './metrics.js';
import { calendarRange } from './period.js';
import { planFor } from './plan.js';
import { damageOf, negativeBase, negativeShare } from './verbatim.js';
import { buildTimeSeries } from './timeseries.js';

/* Перекрёстная группа ДКО «Сбои / тех. проблемы» — урон стабильности (`categorygroup_cross_name`) */
const STABILITY_CROSS = 'сбои / тех. проблемы';
/* Динамика — полгода, таблицы — квартал до выбранного месяца включительно */
const TREND_MONTHS = 6;
const TABLE_MONTHS = 3;
/* Вывод сегмента называет категории, доля негатива которых сдвинулась хотя бы на 1 п. п. */
const NOTE_SHIFT = 0.01;
const TOPIC_MIN_COMPLAINTS = 5;
/* J-153: в группе ДКО — до трёх самых частых категорий; группа «Прочее» не показывается */
const GROUP_CATEGORIES = 3;
const HIDDEN_GROUPS = new Set(['прочее']);

const MONTH_RE = /^\d{4}-\d{2}$/;

export function shiftMonth(month, delta) {
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + number - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const monthRange = (month) => calendarRange('month', `${month}-01`);

/** Месяцы, в которых есть оценки канала, по возрастанию. */
export function monthsOf(rows) {
  const months = new Set();
  for (const { appeal_date: date } of rows) if (typeof date === 'string') months.add(date.slice(0, 7));
  return [...months].filter((month) => MONTH_RE.test(month)).sort();
}

/** Месяц по умолчанию — последний полный: у текущего неполного месяца выводы сравнивали бы часть с целым. */
export function defaultMonth(rows) {
  const months = monthsOf(rows);
  if (!months.length) return null;
  const last = months.at(-1);
  return latestDate(rows) >= monthRange(last).to || months.length === 1 ? last : months.at(-2);
}

const inMonth = (rows, month) => {
  const { from, to } = monthRange(month);
  return rows.filter(({ appeal_date: date }) => date >= from && date <= to);
};

const dkoValues = (reference) => (row) => CATEGORY_CUT.values(row, reference);
const segmentOf = (row) => row.segment || null;

function vocPair(rows, reference) {
  return { voc: voc(dashboardRows(rows, { includeCashback: false }, reference)), raw: voc(rows), count: rows.length };
}

/** Доли негатива категорий ДКО месяца (J-129): часть потерь размеченных оценок 1–4. */
function categoryShares(rows, reference) {
  const values = dkoValues(reference);
  const base = negativeBase(rows, values);
  const byCategory = new Map();
  const byGroup = new Map();
  for (const row of rows) {
    const found = values(row);
    for (const category of found) {
      if (!byCategory.has(category)) byCategory.set(category, { rows: [], group: row.category_group ?? null });
      byCategory.get(category).rows.push(row);
    }
    if (found.length && row.category_group) {
      if (!byGroup.has(row.category_group)) byGroup.set(row.category_group, []);
      byGroup.get(row.category_group).push(row);
    }
  }
  const share = (list) => negativeShare(list, base) ?? 0;
  return {
    base,
    gap: base.gap,
    categories: new Map([...byCategory].map(([name, { rows: list, group }]) => [name, { share: share(list), count: list.length, group }])),
    groups: new Map([...byGroup].map(([name, list]) => [name, share(list)])),
  };
}

/* Вывод сегмента по данным: категории ДКО, чья доля негатива к прошлому месяцу снизилась или выросла хотя бы на 1 п. п. */
function segmentNote(current, previous) {
  const shifts = [...current.categories].map(([name, { share }]) => [name, share - (previous.categories.get(name)?.share ?? 0)]);
  for (const [name, { share }] of previous.categories) if (!current.categories.has(name)) shifts.push([name, -share]);
  const fell = shifts.filter(([, shift]) => shift <= -NOTE_SHIFT).sort((left, right) => left[1] - right[1]).slice(0, 3).map(([name]) => name);
  const rose = shifts.filter(([, shift]) => shift >= NOTE_SHIFT).sort((left, right) => right[1] - left[1]).slice(0, 2).map(([name]) => name);
  const parts = [];
  if (fell.length) parts.push(`Снизился негатив: ${fell.join(', ')}`);
  if (rose.length) parts.push(`Вырос негатив: ${rose.join(', ')}`);
  return parts.length ? `${parts.join('. ')}.` : 'Заметных сдвигов негатива нет.';
}

/* Границы недель — из общей нарезки временных рядов, оценки по неделям раскладываются здесь */
function weekBucketsOf(rows, weeks) {
  const inWeeks = rows.filter(({ appeal_date: date }) => date >= weeks.from && date <= weeks.to);
  return buildTimeSeries([], weeks, 'week').map(({ from: weekFrom, to: weekTo }) => ({
    from: weekFrom, to: weekTo, ratings: inWeeks.filter(({ appeal_date: date }) => date >= weekFrom && date <= weekTo),
  }));
}

/* J-153: недели, целиком покрывающие месяц: с понедельника не позже 1-го до воскресенья не раньше последнего дня */
export function monthWeeks(month) {
  const { from, to } = monthRange(month);
  return { from: shiftDay(from, -((weekdayOf(from) + 6) % 7)), to: shiftDay(to, (7 - weekdayOf(to)) % 7) };
}

/** Урон перекрёстной группы «Сбои / тех. проблемы» по формуле ДКО: её доля потерь размеченного негатива × (5 − VOC). */
export function stabilityDamage(rows, reference) {
  const base = negativeBase(rows, dkoValues(reference));
  const share = negativeShare(rows.filter((row) => normalizeLabel(row.category_cross) === STABILITY_CROSS), base);
  const damage = damageOf(share, base);
  return damage === null ? null : -damage;
}

/**
 * Дайджест месяца канала. `rows` — оценки канала до переключателя кэшбека: дайджест показывает VOC и с поправкой, и без.
 */
export function buildDigest({ rows, month, reference, channel }) {
  const trendMonths = Array.from({ length: TREND_MONTHS }, (_, index) => shiftMonth(month, index - TREND_MONTHS + 1));
  const tableMonths = trendMonths.slice(-TABLE_MONTHS);
  const byMonth = new Map(trendMonths.concat(shiftMonth(month, -TREND_MONTHS)).map((key) => [key, inMonth(rows, key)]));
  const current = byMonth.get(month);
  const previous = byMonth.get(shiftMonth(month, -1));
  const now = vocPair(current, reference);
  const before = vocPair(previous, reference);
  const { from, to } = monthRange(month);

  const weeks = monthWeeks(month);
  const segments = digestSegments({ rows, weeks, current, previous, byMonth, trendMonths, reference });
  const sharesBy = new Map(tableMonths.map((key) => [key, categoryShares(byMonth.get(key), reference)]));
  const nowShares = sharesBy.get(month);
  const topics = digestTopics(nowShares, categoryShares(previous, reference));

  return {
    channel,
    month,
    months: { trend: trendMonths, table: tableMonths },
    voc: { ...now, delta: now.voc === null || before.voc === null ? null : now.voc - before.voc,
      plan: planFor(reference?.plan, { channel, from, to }) ?? null },
    weeks,
    trend: trendMonths.map((key) => ({ month: key, ...vocPair(byMonth.get(key), reference) })),
    count: { value: now.count, delta: now.count - before.count, months: tableMonths.map((key) => ({ month: key, count: byMonth.get(key).length })) },
    segments,
    groups: digestGroups(nowShares, sharesBy, tableMonths),
    stability: trendMonths.map((key) => ({ month: key, damage: stabilityDamage(byMonth.get(key), reference) })),
    topics: topics.map(({ name }) => name),
    defaultTopic: topics[0]?.name ?? null,
  };
}

/* J-153: линия сегмента — по неделям, целиком покрывающим месяц (5–6 точек), с коридором плана канала на месяц */
function digestSegments({ rows, weeks, current, previous, byMonth, trendMonths, reference }) {
  const weekBuckets = weekBucketsOf(rows, weeks);
  return metricSegments().map((code) => {
    const pick = (list) => list.filter((row) => segmentOf(row) === code);
    const weekly = weekBuckets.map(({ from: weekFrom, to: weekTo, ratings }) => ({ from: weekFrom, to: weekTo, ...vocPair(pick(ratings), reference) }));
    const mine = vocPair(pick(current), reference);
    const was = vocPair(pick(previous), reference);
    return {
      code,
      ...mine,
      delta: mine.voc === null || was.voc === null ? null : mine.voc - was.voc,
      countDelta: mine.count - was.count,
      trend: trendMonths.map((key) => ({ month: key, ...vocPair(pick(byMonth.get(key)), reference) })),
      weekly,
      note: mine.count ? segmentNote(categoryShares(pick(current), reference), categoryShares(pick(previous), reference)) : null,
    };
  });
}

/*
  J-153: все группы негатива месяца, кроме «Прочего», по доле негатива; в группе — до трёх самых частых категорий
  (по числу жалоб), у каждой — доля и урон по трём месяцам: урон = доля × (5 − VOC месяца)
*/
function digestGroups(nowShares, sharesBy, tableMonths) {
  return [...nowShares.groups].filter(([name]) => !HIDDEN_GROUPS.has(normalizeLabel(name)))
    .sort((left, right) => right[1] - left[1]).map(([name, share]) => ({
      name,
      share,
      damage: -damageOf(share, nowShares),
      categories: [...nowShares.categories].filter(([, item]) => item.group === name)
        .sort((left, right) => right[1].count - left[1].count || right[1].share - left[1].share).slice(0, GROUP_CATEGORIES)
        .map(([category]) => {
          const values = tableMonths.map((key) => {
            const found = sharesBy.get(key).categories.get(category);
            return found ? { share: found.share, damage: -damageOf(found.share, sharesBy.get(key)) } : null;
          });
          return { name: category, shares: values.map((value) => value?.share ?? null), damages: values.map((value) => value?.damage ?? null) };
        }),
    }));
}

/* Тема детализации — кастомная аналитика месяца: по умолчанию категория с самым сильным ростом доли негатива */
function digestTopics(nowShares, previousShares) {
  return [...nowShares.categories].filter(([, item]) => item.count >= TOPIC_MIN_COMPLAINTS)
    .map(([name, item]) => ({ name, growth: item.share - (previousShares.categories.get(name)?.share ?? 0), count: item.count }))
    .sort((left, right) => right.growth - left.growth || right.count - left.count);
}

/** Детализация темы: доля негатива категории по полугоду и её проблемы по кварталу с числом жалоб. */
export function buildTopic({ rows, month, reference, topic }) {
  const trendMonths = Array.from({ length: TREND_MONTHS }, (_, index) => shiftMonth(month, index - TREND_MONTHS + 1));
  const tableMonths = trendMonths.slice(-TABLE_MONTHS);
  const values = dkoValues(reference);
  const mentions = (list) => list.filter((row) => values(row).includes(topic));
  const shares = trendMonths.map((key) => {
    const list = inMonth(rows, key);
    return { month: key, share: negativeShare(mentions(list), negativeBase(list, values)) };
  });
  const problems = new Map();
  const totals = tableMonths.map((key) => {
    const list = mentions(inMonth(rows, key));
    for (const row of list) {
      for (const problem of complaintValues(row, 'problem', reference)) {
        if (!problems.has(problem)) problems.set(problem, tableMonths.map(() => 0));
        problems.get(problem)[tableMonths.indexOf(key)] += 1;
      }
    }
    return list.length;
  });
  return {
    topic,
    shares,
    months: tableMonths,
    problems: [...problems].map(([name, counts]) => ({ name, counts }))
      .sort((left, right) => right.counts.reduce((a, b) => a + b, 0) - left.counts.reduce((a, b) => a + b, 0) || left.name.localeCompare(right.name, 'ru'))
      .slice(0, 8),
    totals,
  };
}

/*
  J-161, J-162: VOC ролей — карточка-строка на роль клиента в канале шапки за месяц: VOC с поправкой на кэшбек и
  дельтой к прошлому месяцу, оценки с дельтой, линия по неделям месяца с коридором плана канала и топ проблем
  (`problem`) по числу жалоб. Порядок ролей — как в макете заказчика, роли вне списка — следом по числу оценок;
  оценки без роли не показываются
*/
export const ROLE_ORDER = ['Предприниматель', 'Альфа-Босс', 'Бухгалтер', 'Фин.эксперт'];
export const ROLE_SLOTS = 6;
const ROLE_PROBLEMS = 5;

export function buildRoles({ rows, month, reference, channel }) {
  const previousMonth = shiftMonth(month, -1);
  const current = inMonth(rows, month);
  const previous = inMonth(rows, previousMonth);
  const weeks = monthWeeks(month);
  const weekBuckets = weekBucketsOf(rows, weeks);
  const counts = new Map();
  for (const row of rows) if (row.role) counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
  const roles = [...ROLE_ORDER.filter((role) => counts.has(role)),
    ...[...counts.keys()].filter((role) => !ROLE_ORDER.includes(role)).sort((left, right) => counts.get(right) - counts.get(left))];
  const { from, to } = monthRange(month);
  const problemCounts = (list) => {
    const found = new Map();
    /* Жалоба — сниженная оценка 1–4 с размеченной проблемой */
    for (const row of list.filter(({ mark }) => mark <= 4)) for (const problem of complaintValues(row, 'problem', reference)) found.set(problem, (found.get(problem) ?? 0) + 1);
    return found;
  };
  return {
    channel,
    month,
    weeks,
    plan: planFor(reference?.plan, { channel, from, to }) ?? null,
    roles: roles.map((role) => {
      const pick = (list) => list.filter((row) => row.role === role);
      const now = vocPair(pick(current), reference);
      const was = vocPair(pick(previous), reference);
      const problemsNow = problemCounts(pick(current));
      const problemsBefore = problemCounts(pick(previous));
      return {
        role,
        ...now,
        delta: now.voc === null || was.voc === null ? null : now.voc - was.voc,
        /* J-172: прошлый месяц без оценок — дельты нет, а не «+всё» от нуля */
        countDelta: was.count ? now.count - was.count : null,
        weekly: weekBuckets.map(({ from: weekFrom, to: weekTo, ratings }) => ({ from: weekFrom, to: weekTo, ...vocPair(pick(ratings), reference) })),
        problems: [...problemsNow].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru')).slice(0, ROLE_PROBLEMS)
          .map(([name, count]) => ({ name, count, delta: was.count ? count - (problemsBefore.get(name) ?? 0) : null })),
      };
    }),
  };
}
