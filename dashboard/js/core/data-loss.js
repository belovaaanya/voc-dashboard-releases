/*
  J-191: «Провал оценок» (в коде — пропажа данных) календаря. Разрез с регулярным потоком оценок в день получил их в
  разы меньше обычного или не получил совсем: так видно обрыв сбора по триггеру, продукту, сегменту, роли или всему
  срезу. Методика — `docs/calc-core.md`, «Пропажа данных».
  По выходным оценок обычно меньше, поэтому будний день сравнивается с буднями, а выходной и праздник — с выходными.
  Неделя 16–22.11 (реальные данные: срабатывание каждый день) — по образцу «Крит. снижения VOC»: новый уровень
  становится нормой, разрез — от 100 оценок за период, окно — от 30 оценок, поправка на множественные сравнения за
  день и на просадку всего канала; версии приложения не проверяются — их смена видна в «Релизах АБМ»
*/

import { MIN_EVENT_RATINGS } from './anomalies.js';
import { DATA_LOSS_EVENT, DATA_TONE } from './calendar.js';
import { daysBetween, earliestDate, shiftDay } from './dates.js';
import { DIMENSIONS } from './dimensions.js';
import { isRestDay } from './rest-days.js';

/*
  Окно — 10 предыдущих дней того же типа (будни или выходные). Дни идущей серии пропажи в окно не входят, пока серия
  не продержалась всё окно: потом её уровень — новая норма, как у «Крит. снижения VOC» (D-62)
*/
export const DATA_LOSS_WINDOW = 10;
/* Регулярный поток: в среднем не меньше пяти оценок в день и оценки хотя бы в 7 днях окна из 10 */
export const DATA_LOSS_MIN_DAILY = 5;
export const DATA_LOSS_MIN_ACTIVE_DAYS = 7;
/*
  Разрез — не меньше 100 оценок за 30 календарных дней до проверяемого дня (порог «Крит. снижения VOC»): объём до
  обрыва, а не за период — иначе сам обрыв выводил бы разрез из проверки
*/
export const DATA_LOSS_MIN_PERIOD_RATINGS = MIN_EVENT_RATINGS;
export const DATA_LOSS_VOLUME_DAYS = 30;
/* Резкое падение — в три раза и сильнее; ноль оценок — полная пропажа */
export const DATA_LOSS_RATIO = 1 / 3;
/*
  И при обычном потоке так мало оценок случайно почти не бывает: вероятность по Пуассону меньше 1 % с поправкой
  Бенджамини — Хохберга на все разрезы, проверенные в этот день (доля ложных среди отмеченных — не больше 1 %)
*/
export const DATA_LOSS_ALPHA = 0.01;

const cut = (key) => DIMENSIONS.find((dimension) => dimension.key === key);

/* Канал — весь срез шапки; остальные разрезы — как в фильтрах */
const CUTS = [
  { dimension: 'channel', values: (row) => [row.channel] },
  ...['os', 'segment', 'product', 'trigger', 'role'].map((key) => ({ dimension: key, channels: cut(key).channels, values: cut(key).values })),
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

/* Предыдущие дни ряда для окна: дни идущей серии пропажи (`skip`) пропускаются; короче окна — `null` */
function recentDays(counts, index, skip) {
  const recent = [];
  for (let day = index - 1; day >= 0 && recent.length < DATA_LOSS_WINDOW; day -= 1) {
    if (!skip?.[day]) recent.push(counts[day]);
  }
  return recent.length < DATA_LOSS_WINDOW ? null : recent;
}

/**
 * Обычный поток на день `index` ряда одного типа: средняя окна (без дней `skip`); `null` — окна нет или поток
 * нерегулярный: в среднем меньше 5 оценок или оценки меньше чем в 7 днях из 10.
 */
export function regularFlow(counts, index, skip = null) {
  const recent = recentDays(counts, index, skip);
  if (!recent) return null;
  const mean = recent.reduce((sum, count) => sum + count, 0) / DATA_LOSS_WINDOW;
  const active = recent.filter((count) => count > 0).length;
  return mean < DATA_LOSS_MIN_DAILY || active < DATA_LOSS_MIN_ACTIVE_DAYS ? null : mean;
}

/**
 * Проверка дня `index` ряда одного типа: обычный поток, ожидание с поправкой на канал (`scale` ≤ 1), падение в 3 раза
 * и p по Пуассону. `null` — потока нет. Значимость решает поправка на все разрезы дня (`benjaminiHochberg`).
 */
export function lossTest(counts, index, scale = 1, skip = null) {
  const mean = regularFlow(counts, index, skip);
  if (mean === null) return null;
  const expected = mean * scale;
  const count = counts[index];
  return { mean, expected, deep: count <= expected * DATA_LOSS_RATIO, p: poissonAtMost(count, expected) };
}

/** Порог Бенджамини — Хохберга: наибольшее p_(k) ≤ k/m · α среди `m` проверенных; `-1` — значимых нет. */
export function benjaminiHochberg(pValues, alpha = DATA_LOSS_ALPHA) {
  const sorted = [...pValues].sort((left, right) => left - right);
  let threshold = -1;
  sorted.forEach((p, rank) => { if (p <= ((rank + 1) / sorted.length) * alpha) threshold = p; });
  return threshold;
}

/** Отдельный день без поправок (тесты и пояснение): пропажа, если поток регулярный, падение в 3 раза и p < α. */
export function lossVerdict(counts, index, scale = 1, skip = null) {
  const test = lossTest(counts, index, scale, skip);
  return test && test.deep && test.p < DATA_LOSS_ALPHA ? { mean: test.mean } : null;
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

const LOSS = 'loss';
const CLEAR = 'clear';
/*
  Оценить день нельзя (окна нет, поток нерегулярный — например, по выходным у разреза почти нет оценок) или оценок
  втрое меньше обычного, но это ещё может быть случайно: серию не рвёт и в неё не входит
*/
const SKIP = 'skip';

/* Пропажа всего среза в тот же день объясняет пропажу любого другого разреза */
const covers = (parent, child) => parent.dimension === 'channel' && child.dimension !== 'channel';

/**
 * Пропажи данных среза за период: дни пропажи подряд — одна строка с реальным началом, в том числе до периода.
 * День сравнивается с днями своего типа: будний с буднями, выходной и праздник с выходными. День, который оценить
 * нельзя (нет окна или регулярного потока этого типа), серию не рвёт и в неё не входит. Пропажа, которую объясняет
 * пропажа всего среза в тот же день, — копия и не показывается;
 * разрез с теми же оценками за всю историю — копия, остаётся первый по порядку `CUTS`.
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
  const kindOf = new Array(days.length);
  for (const positions of [work, rest]) positions.forEach((position, order) => { kindOf[position] = { positions, order }; });

  /* Разрез с теми же оценками за всю историю — копия (продукт из одного триггера): остаётся первый по `CUTS` */
  const histories = new Set();
  const series = dailyCounts(rows, reference, channel, index, days.length).filter(({ counts, print }) => {
    const history = `${print}|${counts.join(',')}`;
    if (histories.has(history)) return false;
    histories.add(history);
    return true;
  }).map((item) => {
    /* Накопленные суммы: объём разреза за 30 дней до дня — без самого дня и того, что после */
    const prefix = [0];
    for (const count of item.counts) prefix.push(prefix.at(-1) + count);
    return {
      ...item,
      volumeBefore: (position) => prefix[position] - prefix[Math.max(0, position - DATA_LOSS_VOLUME_DAYS)],
      sub: [work, rest].map((positions) => positions.map((position) => item.counts[position])),
      /* По ряду типа: дни, отмеченные пропажей, и сколько их в идущей серии (с последнего обычного дня) */
      marks: [work, rest].map((positions) => new Array(positions.length).fill(false)),
      run: [0, 0],
    };
  });
  const whole = series.find(({ dimension }) => dimension === 'channel');
  const windowMean = (counts, order) => (order < DATA_LOSS_WINDOW ? null
    : counts.slice(order - DATA_LOSS_WINDOW, order).reduce((sum, count) => sum + count, 0) / DATA_LOSS_WINDOW);

  /*
    День за днём: у каждого разреза — проверка своего ряда; ожидание разреза уменьшено на просадку остального канала
    в этот день; поправка Бенджамини — Хохберга по всем проверенным в день разрезам. Дни идущей серии в окно не
    входят, пока серия короче окна: после этого её уровень — новая норма
  */
  const states = series.map(() => new Array(days.length).fill(SKIP));
  const means = series.map(() => new Array(days.length).fill(null));
  for (let position = 0; position < days.length; position += 1) {
    const { positions, order } = kindOf[position];
    const kind = positions === work ? 0 : 1;
    const wholeBase = whole ? windowMean(whole.sub[kind], order) : null;
    const tests = series.map((item) => {
      if (item.volumeBefore(position) < DATA_LOSS_MIN_PERIOD_RATINGS) return null;
      /*
        Просадка канала — по каналу без самого разреза: иначе пропажа крупного разреза тянула бы канал вниз и сама
        себя «объясняла». Канал без разреза с потоком меньше 5 в день поправки не даёт
      */
      let scale = 1;
      const own = windowMean(item.sub[kind], order);
      if (item !== whole && wholeBase !== null && own !== null) {
        const restBase = wholeBase - own;
        if (restBase >= DATA_LOSS_MIN_DAILY) scale = Math.min(1, Math.max(0, whole.counts[position] - item.counts[position]) / restBase);
      }
      const skip = item.run[kind] > 0 && item.run[kind] < DATA_LOSS_WINDOW ? item.marks[kind] : null;
      return lossTest(item.sub[kind], order, scale, skip);
    });
    const threshold = benjaminiHochberg(tests.filter(Boolean).map(({ p }) => p));
    tests.forEach((test, at) => {
      const item = series[at];
      if (!test) return;
      means[at][position] = test.mean;
      const lost = test.deep && threshold >= 0 && test.p <= threshold;
      states[at][position] = lost ? LOSS : test.deep ? SKIP : CLEAR;
      if (lost) {
        item.marks[kind][order] = true;
        item.run[kind] += 1;
      } else if (!test.deep && item.run[kind] > 0) {
        /* Обычный день закрывает серию: её дни больше не исключаются из окна следующей */
        item.run[kind] = 0;
        item.marks[kind].fill(false);
      }
    });
  }
  const flagged = states.map((row) => row.map((state) => state === LOSS));
  const explained = (at, position) => series.some((other, index2) => index2 !== at && flagged[index2][position] && covers(other, series[at]));

  const events = [];
  const exportEnds = !dataEnd || dataEnd <= period.to;
  series.forEach((item, at) => {
    const row = states[at];
    for (let day = 0; day < days.length; day += 1) {
      if (row[day] !== LOSS) continue;
      const lost = [day];
      let next = day + 1;
      while (next < days.length && row[next] !== CLEAR) {
        if (row[next] === LOSS) lost.push(next);
        next += 1;
      }
      day = lost.at(-1);
      if (days[day] < period.from) continue;
      if (lost.every((position) => explained(at, position))) continue;
      const run = lost.map((position) => days[position]);
      const counts = lost.map((position) => item.counts[position]);
      events.push({
        kind: DATA_LOSS_EVENT, dimension: item.dimension, key: item.key, channel,
        /* Длительность — календарные дни от первого до последнего дня пропажи, с выходными внутри */
        from: run[0], date: run.at(-1), days: run, streak: daysBetween(run[0], run.at(-1)) + 1,
        before: means[at][lost[0]], after: counts.reduce((sum, count) => sum + count, 0) / counts.length,
        ratings: counts.at(-1), full: counts.every((count) => count === 0),
        /* После последнего дня пропажи до конца выгрузки нет ни одного обычного дня */
        /* Продолжается — до конца выгрузки нет обычного дня, и в последний день оценок всё ещё втрое меньше обычного */
        ongoing: exportEnds && next >= days.length
          && item.counts[kindOf[day].positions.at(-1)] <= means[at][lost[0]] * DATA_LOSS_RATIO,
        startsBeforePeriod: run[0] < period.from,
        tone: DATA_TONE, severity: null,
      });
    }
  });
  return events;
}
