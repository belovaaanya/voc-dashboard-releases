/*
  Общие части карточки метрики: дельта со стрелкой, точка тренда, бейдж плана,
  подпись коридора, объём и пометка недостаточной выборки.

  J-65: порядок чтения — название, число, дельта рядом с числом, одна строка
  подписи. База сравнения общая для всех карточек и стоит в шапке страницы.

  Здесь только представление. Ни одного расчёта: значения приходят из
  metrics.js, plan.js и sufficiency.js, строки — из format.js (D-20).
*/

import { badge } from '../components/badge.js';
import { delta } from '../components/delta.js';
import { valueDelta } from '../components/value-delta.js';
import { EMPTY_MARK, emptyValue } from '../components/empty-value.js';
import { sparkline } from '../components/sparkline.js';
import { hoverTooltip } from '../components/hover-tooltip.js';
import { statusDot } from '../components/status-dot.js';
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  formatCount,
  formatDelta,
  formatDeltaCount,
  formatDeltaShare,
  formatPeriodDative,
  formatVoc,
} from '../core/format.js';
import { ratingsForecast } from '../core/forecast.js';
import { clampToDomain } from '../core/segment-trend.js';
import { trendOf } from '../core/metrics.js';
import { ABOVE_PLAN, BELOW_PLAN, GLOW_ABOVE_STRONG, GLOW_BELOW_STRONG, IN_PLAN, planGlow, planStatus } from '../core/plan.js';
import { roundCount, roundDelta, roundShare } from '../core/round.js';
import { sampleSufficiency } from '../core/sufficiency.js';

/*
  Округление и формат дельты ходят парой: направление стрелки выводится из того
  же числа, которое напечатано рядом. Разъехавшись, они дадут стрелку роста
  рядом с подписью «+0,0» — то, от чего защищает D-22
*/
export const DELTA_SHAPES = {
  voc: { round: roundDelta, format: formatDelta },
  count: { round: roundCount, format: formatDeltaCount },
  share: { round: roundShare, format: formatDeltaShare },
};

/* Тон дельты — по смыслу роста: рост низких оценок плох, спад числа оценок плох, а его рост ни хорош, ни плох (D-49) */
export const GROWTH = {
  good: { up: 'positive', down: 'negative', flat: 'neutral' },
  bad: { up: 'negative', down: 'positive', flat: 'neutral' },
  volume: { up: 'neutral', down: 'negative', flat: 'neutral' },
  /* Незаконченный период против целого прошлого: изменение без смысла, третьим серым */
  unfinished: { up: 'faint', down: 'faint', flat: 'faint' },
};

/* Объём оценок в шапке: рост — вторым серым текста, а не --color-neutral (четвёртый серый карточки) */
const HEADER_VOLUME = { up: 'quiet', down: 'negative', flat: 'quiet' };
/* Незаконченный период: часть месяца против целого прошлого — дельта не хороша и не плоха, третьим серым */
const UNFINISHED_VOLUME = GROWTH.unfinished;
const FORECAST_END = { month: 'к концу месяца', quarter: 'к концу квартала' };

const TREND_CAPTION = {
  up: 'рост к предыдущему периоду',
  down: 'падение к предыдущему периоду',
  flat: 'без изменений к предыдущему периоду',
};

/* «В плане» — нейтральный: в коридоре нечему радоваться или тревожиться; цвет — у отклонений, слово называет любое состояние (D-26) */
const PLAN_BADGE = {
  [IN_PLAN]: { caption: 'В плане', tone: 'quiet' },
  [ABOVE_PLAN]: { caption: 'Выше плана', tone: 'positive' },
  [BELOW_PLAN]: { caption: 'Ниже плана', tone: 'negative' },
};

/** Нет значения (`null` или прочерк форматтера) — общий `emptyValue` в месте числа. */
export function valueNode(text, modifier) {
  const empty = text === null || text === undefined || text === EMPTY_MARK;
  const node = element('span', modifier ? `metric__value ${modifier}` : 'metric__value', empty ? null : text);
  if (empty) node.append(emptyValue());
  return node;
}

/** Направление берётся из знака дельты, а не задаётся отдельно (V-15). */
export function deltaNode(value, { shape = DELTA_SHAPES.voc, growth = GROWTH.good, className, large, arrow = true } = {}) {
  const shown = shape.round(value);
  const direction = trendOf(shown);
  if (!direction) return null;
  return delta({ text: shape.format(shown), direction, tone: growth[direction], caption: TREND_CAPTION[direction], className, large, arrow });
}

/** Дельта стоит рядом с числом; без сравнения слот пуст и скрыт — карточка не меняет высоту (B-07). */
export function leadNode(value, { shape = DELTA_SHAPES.voc, growth = GROWTH.good, large = false } = {}) {
  const node = deltaNode(value, { shape, growth, className: 'metric__lead', large });
  if (node) return node;
  const empty = delta({ text: '\u00a0', direction: 'flat', large, className: 'metric__lead metric__lead--empty' });
  empty.setAttribute('aria-hidden', 'true');
  return empty;
}

/** Число и дельта карточки — общий `valueDelta`; `wrap` — не помещаясь, дельта уходит под число (J-65). */
export function pairNode(valueText, lead, modifier, { wrap = false } = {}) {
  return valueDelta(valueNode(valueText, modifier), lead, { className: 'metric__pair', wrap });
}

/* Шаг мини-тренда словом — для подсказки и доступного имени */
const TREND_STEP = { month: 'по месяцам', quarter: 'по кварталам', week: 'по неделям' };

/**
 * Мини-тренд VOC сегмента: три точки по шагу периода (`core/segment-trend.js`), справа от числа в строке значения.
 * Подписи — только у крайних точек: VOC над точкой, шаг под линией («сен … ноя»); средняя точка без подписи —
 * три подписи в остаток строки не помещаются. В узкой карточке подписи гаснут (metrics.css). Все шаги и значения —
 * в подсказке и доступном имени. Шаг без оценок — разрыв; меньше двух точек с оценками — тренда нет.
 */
export function trendNode(values, steps, step, { direction = null, tone = null, level = null, domain = null } = {}) {
  if (values.filter((value) => value !== null).length < 2) return null;
  const trend = element('span', 'metric__trend');
  const caption = `VOC ${TREND_STEP[step] ?? ''}: ${steps.map(({ label }, index) => `${label} ${values[index] === null ? 'нет оценок' : formatVoc(values[index])}`).join(', ')}`;
  trend.title = caption;
  trend.setAttribute('role', 'img');
  trend.setAttribute('aria-label', caption);
  const end = (index) => index === 0 || index === steps.length - 1;
  /* Цвет — `trendTone`: направление, мало оценок — серый; без `tone` — направление */
  /* Общая шкала сегментов (`domain`): точки за её краем прижаты к краю, подписи — настоящие значения */
  trend.append(sparkline(clampToDomain(values, domain), {
    tone: tone ?? GROWTH.good[direction] ?? 'neutral', wide: true, fill: true, halo: true, endRule: true, level,
    ...(domain ? { domain } : {}),
    label: (_value, index) => (end(index) ? formatVoc(values[index]) : null),
    axis: steps.map(({ label }, index) => (end(index) ? label : '')),
  }));
  return trend;
}

/** J-65: одна строка подписи под числом — объём, коридор, пометка выборки; пустые части пропускаются. */
export function metaRowNode(...parts) {
  const shown = parts.filter(Boolean);
  if (shown.length === 0) return null;
  const row = element('span', 'metric__caption');
  row.append(...shown);
  return row;
}

/** Точка тренда в шапке — из макета (`V-24`), только у карточки с дельтой того же направления. */
export function trendDotNode(value, { shape = DELTA_SHAPES.voc, growth = GROWTH.good, size } = {}) {
  const direction = trendOf(shape.round(value));
  return direction ? statusDot(growth[direction], size) : null;
}

/** Бейдж плана: состояние называет текст, а не цвет (D-26); сила отклонения — в подсказке и доступном имени (J-67). */
export function badgeNode(value, plan) {
  const status = planStatus(value, plan);
  if (!status) return null;
  const node = badge(PLAN_BADGE[status].caption, PLAN_BADGE[status].tone);
  const strong = STRONG_CAPTION[planGlow(value, plan)];
  if (strong) {
    node.title = strong;
    node.setAttribute('aria-label', strong);
  }
  return node;
}

/**
 * Цвет мини-тренда сегмента (решение пользователя): только направление динамики — вверх зелёный, вниз красный,
 * меньше 0,01 — серый; план показывают бейдж и свечение. Мало оценок — серый, как и карточка без свечения.
 * Линия, заливка и вертикаль последней точки — одного тона.
 */
export function trendTone(ratings, direction) {
  if (!sampleSufficiency(ratings).sufficient) return 'neutral';
  return GROWTH.good[direction] ?? 'neutral';
}

/**
 * Уровень свечения по плану (`plan.planGlow`) — только при достаточной выборке (D-25): 12 оценок КИБ не светятся так же,
 * как 4 207 СБ. Бейдж плана и пометка «Мало оценок» остаются; карточка — нейтральная, без статуса.
 */
export function statusGlow(value, plan, ratings) {
  return sampleSufficiency(ratings).sufficient ? planGlow(value, plan) : null;
}

/** Стекло по статусу плана (J-67) — атрибут карточки, стили в metrics.css; без плана или данных атрибута нет (D-04). */
export function setPlanGlow(block, glow) {
  const card = block.element;
  if (!card?.dataset) return;
  if (glow) card.dataset.planGlow = glow;
  else delete card.dataset.planGlow;
}

/* J-67: сила отклонения — словом, а не только плотностью свечения (D-26) */
const STRONG_CAPTION = {
  [GLOW_BELOW_STRONG]: 'Сильно ниже плана',
  [GLOW_ABOVE_STRONG]: 'Сильно выше плана',
};

/** J-14: кольцо сегмента показывает выполнение плана, дельта остаётся отдельным сигналом. */
export function planDotNode(value, plan) {
  const status = planStatus(value, plan);
  if (!status) return null;
  const caption = STRONG_CAPTION[planGlow(value, plan)] ?? PLAN_BADGE[status].caption;
  /* Точка дайджеста — прежнего тона: «В плане» нейтрален только у бейджа шапки */
  const dot = statusDot(status === IN_PLAN ? 'positive' : PLAN_BADGE[status].tone);
  dot.title = caption;
  dot.removeAttribute('aria-hidden');
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', caption);
  return dot;
}

/** Коридор плана; `corner` — справа сверху большой карточки, под бейджем плана (в строке подписи дайджеста — без него). */
export function planCaptionNode(plan, { corner = false } = {}) {
  if (!plan) return null;
  return element('span', corner ? 'metric__meta metric__plan' : 'metric__meta', `План: ${formatVoc(plan.min)}–${formatVoc(plan.max)}`);
}

export function countNode(count) {
  return element('span', 'metric__meta', `${formatCount(count)} ${pluralRatings(count)}`);
}

/**
 * Дельта числа оценок — сразу после «N оценок»; без предыдущего периода её нет. Рост объёма нейтрален, спад — тревога (D-49).
 * Незаконченный месяц или квартал (`forecast`) сравнивается с прошлым целиком (J-85): дельта третьим серым, без смысла роста.
 */
export function countDeltaNode(count, previousCount, forecast = null, { arrow = true } = {}) {
  if (!previousCount) return null;
  return deltaNode(count - previousCount, { shape: DELTA_SHAPES.count, growth: forecast ? UNFINISHED_VOLUME : HEADER_VOLUME, className: 'metric__count-delta', arrow });
}

/** «N оценок» с дельтой — пара общего `valueDelta`: у карточки канала и сегментов одна анатомия, «+557» не уходит на строку ниже. */
export function countGroupNode(count, previousCount, period = null) {
  const forecast = ratingsForecast(count, period, previousCount);
  return valueDelta(countNode(count), countDeltaNode(count, previousCount, forecast), { className: 'metric__count' });
}

/*
  Прогноз двумя строками: подсказка не переносит строки и не шире 440 px, а «к концу квартала … к III кварталу»
  одной строкой в неё не помещается
*/
function forecastLines(count, previousCount, period) {
  const forecast = ratingsForecast(count, period, previousCount);
  if (!forecast) return null;
  const total = roundCount(forecast.forecast);
  const change = forecast.change === null ? '' : ` (${formatDeltaCount(roundCount(forecast.change))} к ${formatPeriodDative(forecast.previous.from, forecast.unit)})`;
  return [`Если темп сохранится, ${FORECAST_END[forecast.unit]}`, `будет ≈${formatCount(total)} ${pluralRatings(total)}${change}`];
}

/** Текст прогноза: «Если темп сохранится, к концу месяца будет ≈N оценок (+M к октябрю)»; null — периода, который идёт, нет. */
export function forecastText(count, previousCount, period) {
  return forecastLines(count, previousCount, period)?.join(' ') ?? null;
}

/**
 * «?» после дельты оценок незаконченного периода: прогноз по темпу — в подсказке (J-94: как у пометки выборки).
 * Внутри кнопки карточки знак не получает фокус: кнопка называет прогноз в доступном имени.
 */
export function forecastNode(count, previousCount, period, { focusable = false } = {}) {
  const lines = forecastLines(count, previousCount, period);
  if (!lines) return null;
  const hint = element('span', 'metric__forecast', '?');
  hint.dataset.forecast = lines.join(' ');
  hint.setAttribute('role', 'img');
  hint.setAttribute('aria-label', 'Период не закончен');
  if (focusable) hint.setAttribute('tabindex', '0');
  hoverTooltip(hint, ['Период не закончен', ...lines]);
  return hint;
}

/**
 * Пометка недостаточной выборки (D-25): серая иконка, слова и порог — в подсказке (J-94).
 * Внутри кнопки карточки иконка не получает фокус: кнопка сама называет пометку в доступном имени.
 */
export function sufficiencyNode(ratings, { focusable = false } = {}) {
  const sample = sampleSufficiency(ratings);
  if (sample.n === 0 || sample.sufficient) return null;

  const threshold = `Меньше ${formatCount(sample.minimumRatings)} оценок за период`;
  const warning = element('span', 'metric__warning');
  warning.dataset.threshold = threshold;
  warning.setAttribute('role', 'img');
  warning.setAttribute('aria-label', 'Мало оценок');
  if (focusable) warning.setAttribute('tabindex', '0');
  warning.append(icon('alert', 'metric__warning-icon'));
  hoverTooltip(warning, ['Мало оценок', threshold]);
  return warning;
}

/* Согласование числительного: «1 оценка», «2 оценки», «5 оценок» */
function pluralRatings(count) {
  const tail = Math.abs(count) % 100;
  if (tail >= 11 && tail <= 14) return 'оценок';
  switch (tail % 10) {
    case 1:
      return 'оценка';
    case 2:
    case 3:
    case 4:
      return 'оценки';
    default:
      return 'оценок';
  }
}
