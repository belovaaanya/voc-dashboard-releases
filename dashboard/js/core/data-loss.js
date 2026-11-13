/*
  J-191: «Пропажа данных» календаря. Разрез с регулярным потоком оценок в день получил их в разы меньше
  обычного или не получил совсем: так видно обрыв сбора по триггеру, версии, сегменту или всему срезу, о котором
  иначе узнают через недели. Методика — `docs/calc-core.md`, «Пропажа данных».
  По выходным оценок обычно меньше, поэтому будний день сравнивается с буднями, а выходной и праздник — с выходными
*/

import { numberedVersionKey, splitVersionKey } from './antidrivers.js';
import { DATA_LOSS_EVENT, DATA_TONE } from './calendar.js';
import { daysBetween, earliestDate, shiftDay } from './dates.js';
import { DIMENSIONS } from './dimensions.js';
import { isRestDay } from './rest-days.js';

/* Окно — предыдущие дни того же типа (будни или выходные); дни уже идущей пропажи в него не входят */
export const DATA_LOSS_WINDOW = 10;
/* Регулярный поток: в среднем не меньше пяти оценок в день и оценки хотя бы в 7 днях окна из 10 */
export const DATA_LOSS_MIN_DAILY = 5;
export const DATA_LOSS_MIN_ACTIVE_DAYS = 7;
/* Резкое падение — в три раза и сильнее; ноль оценок — полная пропажа */
export const DATA_LOSS_RATIO = 1 / 3;
/* И при обычном потоке так мало оценок случайно почти не бывает: вероятность по Пуассону меньше 1 % */
export const DATA_LOSS_ALPHA = 0.01;

const cut = (key) => DIMENSIONS.find((dimension) => dimension.key === key);

/* Канал — весь срез шапки; остальные разрезы — как в фильтрах; версия — платформа и номер (J-128) */
const CUTS = [
  { dimension: 'channel', values: (row) => [row.channel] },
  ...['os', 'segment', 'product', 'trigger', 'role'].map((key) => ({ dimension: key, channels: cut(key).channels, values: cut(key).values })),
  { dimension: 'app_version', values: (row) => [numberedVersionKey(row)] },
];

/** P(X ≤ k) для Пуассона со средним `mean`: сумма в логарифмах, без переполнения на больших средних. */
export function poissonAtMost(k, mean) {
  if (mean <= 0) return 1;
  let term = -mean;
  let total = Math.exp(term);
  for (let i = 1; i <= k; i += 1) {
    term += Math.log(mean) - Math.log(i);
    total += Math.exp(term);
  }
  return Math.min(1, total);
}

/* Дни отдыха — общее правило с таблицей аномалий (`rest-days.js`); экспорт оставлен для прежних импортов */
export { isRestDay };

function calendarDays(from, to) {
  const days = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/* Предыдущие дни ряда без пропажи; короче окна — `null`. Ряд — дни одного типа подряд */
function recentDays(counts, flagged, index) {
  const recent = [];
  for (let day = index - 1; day >= 0 && recent.length < DATA_LOSS_WINDOW; day -= 1) {
    if (!flagged[day]) recent.push(counts[day]);
  }
  return recent.length < DATA_LOSS_WINDOW ? null : recent;
}

/** Обычный поток на день `index` ряда одного типа: средняя окна; `null` — окна нет или поток нерегулярный. */
export function regularFlow(counts, flagged, index) {
  const recent = recentDays(counts, flagged, index);
  if (!recent) return null;
  const mean = recent.reduce((sum, count) => sum + count, 0) / DATA_LOSS_WINDOW;
  const active = recent.filter((count) => count > 0).length;
  return mean < DATA_LOSS_MIN_DAILY || active < DATA_LOSS_MIN_ACTIVE_DAYS ? null : mean;
}

/** Пропажа в день `index` ряда одного типа: окно — предыдущие дни ряда без пропажи; `null` — потока нет или день обычный. */
export function lossVerdict(counts, flagged, index) {
  const mean = regularFlow(counts, flagged, index);
  if (mean === null) return null;
  const count = counts[index];
  if (count > mean * DATA_LOSS_RATIO || poissonAtMost(count, mean) >= DATA_LOSS_ALPHA) return null;
  return { mean };
}

/* Хэш кода оценки (FNV-1a): отпечаток разреза складывается из хэшей его оценок и не зависит от их порядка */
function codeHash(code) {
  const text = String(code);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/*
  Уникальные оценки разреза по рабочим дням; повтор `voc_ccode` за день — одна оценка. День строки ищется один раз.
  `print` — отпечаток набора оценок по дням: у копии (продукт из одного триггера) он тот же, у разреза с
  совпавшими числами, но другими оценками, — другой
*/
function dailyCounts(rows, reference, channel, index, size) {
  const cuts = CUTS.filter(({ channels }) => !channels || !channel || channels.includes(channel))
    .map((cut) => ({ ...cut, byKey: new Map() }));
  for (const row of rows) {
    const day = index.get(row.appeal_date);
    if (day === undefined) continue;
    const hash = codeHash(row.voc_ccode);
    for (const { values, byKey } of cuts) {
      for (const key of values(row, reference)) {
        if (!key) continue;
        let item = byKey.get(key);
        if (!item) byKey.set(key, (item = { codes: new Array(size).fill(null), print: 0 }));
        const codes = (item.codes[day] ??= new Set());
        if (codes.has(row.voc_ccode)) continue;
        codes.add(row.voc_ccode);
        item.print = (item.print + Math.imul(hash, day + 1)) >>> 0;
      }
    }
  }
  return cuts.flatMap(({ dimension, byKey }) => [...byKey].map(([key, { codes, print }]) => ({
    dimension, key, print, counts: codes.map((set) => set?.size ?? 0),
  })));
}

/*
  Переход на новую версию — не пропажа: оценки старой версии уходят к новой, а ОС их не теряет. Версия считается
  пропавшей, только если её ОС в тот же день недосчиталась хотя бы половины оценок, которых не хватает версии
*/
export const VERSION_SHARE_OF_OS_LOSS = 0.5;

function osLost(series, item, day) {
  const os = series.find((other) => other.dimension === 'os' && other.key === splitVersionKey(item.key).os);
  const expected = os?.means[day] ?? null;
  if (expected === null) return true;
  return expected - os.counts[day] >= VERSION_SHARE_OF_OS_LOSS * (item.means[day] - item.counts[day]);
}

const LOSS = 'loss';
const CLEAR = 'clear';
/*
  Оценить день нельзя (окна нет, поток нерегулярный — например, по выходным у разреза почти нет оценок) или оценок
  втрое меньше обычного, но при малом потоке это ещё может быть случайно: серию не рвёт и в неё не входит
*/
const SKIP = 'skip';

/*
  Вердикт каждого дня — по ряду дней своего типа: будни с буднями, выходные и праздники с выходными. `means` —
  обычный поток этого типа на день (база окна), он же ожидание для ОС у пропажи версии
*/
function assess(counts, kinds) {
  const states = new Array(counts.length).fill(SKIP);
  const means = new Array(counts.length).fill(null);
  for (const positions of kinds) {
    const sub = positions.map((position) => counts[position]);
    const flagged = new Array(sub.length).fill(false);
    sub.forEach((count, index) => {
      const mean = regularFlow(sub, flagged, index);
      if (mean === null) return;
      means[positions[index]] = mean;
      flagged[index] = Boolean(lossVerdict(sub, flagged, index));
      states[positions[index]] = flagged[index] ? LOSS : count <= mean * DATA_LOSS_RATIO ? SKIP : CLEAR;
    });
  }
  return { states, means };
}

/* Какой разрез объясняет пропажу другого: весь срез — любую, ОС — версии своей ОС */
function covers(parent, child) {
  if (parent.dimension === 'channel') return child.dimension !== 'channel';
  return parent.dimension === 'os' && child.dimension === 'app_version' && splitVersionKey(child.key).os === parent.key;
}

/**
 * Пропажи данных среза за период: дни пропажи подряд — одна строка с реальным началом, в том числе до периода.
 * День сравнивается с днями своего типа: будний с буднями, выходной и праздник с выходными. День, который оценить
 * нельзя (нет окна или регулярного потока этого типа), серию не рвёт и в неё не входит. Пропажа, которую объясняет
 * пропажа всего среза или ОС в тот же день, — копия и не показывается; версия, оценки которой перешли к другой
 * версии той же ОС, — не пропажа; разрез с теми же оценками за всю историю — копия, остаётся первый по порядку `CUTS`.
 */
export function detectDataLoss({ rows, reference, period, channel, dataEnd }) {
  const start = earliestDate(rows);
  if (!start) return [];
  const end = dataEnd && dataEnd < period.to ? dataEnd : period.to;
  if (end < period.from || end < start) return [];
  const days = calendarDays(start, end);
  const index = new Map(days.map((day, position) => [day, position]));
  const rest = days.flatMap((day, position) => (isRestDay(day) ? [position] : []));
  const work = days.flatMap((day, position) => (isRestDay(day) ? [] : [position]));
  const series = dailyCounts(rows, reference, channel, index, days.length).map((item) => {
    const { states, means } = assess(item.counts, [work, rest]);
    return { ...item, states, means, flagged: states.map((state) => state === LOSS) };
  });

  /* Разрез с теми же оценками за всю историю — копия (продукт из одного триггера): остаётся первый по `CUTS` */
  const histories = new Set();
  const distinct = series.filter(({ counts, print }) => {
    const history = `${print}|${counts.join(',')}`;
    if (histories.has(history)) return false;
    histories.add(history);
    return true;
  });
  /*
    Сначала дни складываются в серии, потом серия скрывается целиком — если в каждый её день она копия чужой пропажи
    или (у версии) переход оценок на другую версию. Иначе одна пропажа разрезалась бы на куски вокруг чужого дня
  */
  const explained = (item, day) => distinct.some((other) => other !== item && other.flagged[day] && covers(other, item))
    || (item.dimension === 'app_version' && !osLost(series, item, day));

  const events = [];
  const exportEnds = !dataEnd || dataEnd <= period.to;
  distinct.forEach((item) => {
    const { states } = item;
    for (let day = 0; day < days.length; day += 1) {
      if (states[day] !== LOSS) continue;
      const lost = [day];
      let next = day + 1;
      while (next < days.length && states[next] !== CLEAR) {
        if (states[next] === LOSS) lost.push(next);
        next += 1;
      }
      day = lost.at(-1);
      if (days[day] < period.from) continue;
      if (lost.every((at) => explained(item, at))) continue;
      const run = lost.map((at) => days[at]);
      const counts = lost.map((at) => item.counts[at]);
      events.push({
        kind: DATA_LOSS_EVENT, dimension: item.dimension, key: item.key, channel,
        /* Длительность — календарные дни от первого до последнего дня пропажи, с выходными внутри */
        from: run[0], date: run.at(-1), days: run, streak: daysBetween(run[0], run.at(-1)) + 1,
        before: item.means[lost[0]], after: counts.reduce((sum, count) => sum + count, 0) / counts.length,
        ratings: counts.at(-1), full: counts.every((count) => count === 0),
        /* После последнего дня пропажи до конца выгрузки нет ни одного обычного дня */
        ongoing: exportEnds && next >= days.length, startsBeforePeriod: run[0] < period.from,
        tone: DATA_TONE, severity: null,
      });
    }
  });
  return events;
}
