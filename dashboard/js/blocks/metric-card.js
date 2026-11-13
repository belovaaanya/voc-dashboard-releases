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
import { hoverTooltip } from '../components/hover-tooltip.js';
import { statusDot } from '../components/status-dot.js';
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  formatCount,
  formatDelta,
  formatDeltaCount,
  formatDeltaShare,
  formatVoc,
} from '../core/format.js';
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
};

const TREND_CAPTION = {
  up: 'рост к предыдущему периоду',
  down: 'падение к предыдущему периоду',
  flat: 'без изменений к предыдущему периоду',
};

/* «В плане» — нейтральный: в коридоре нечему радоваться или тревожиться; цвет — у отклонений, слово называет любое состояние (D-26) */
const PLAN_BADGE = {
  [IN_PLAN]: { caption: 'В плане', tone: 'neutral' },
  [ABOVE_PLAN]: { caption: 'Выше плана', tone: 'positive' },
  [BELOW_PLAN]: { caption: 'Ниже плана', tone: 'negative' },
};

export function valueNode(text, modifier) {
  return element('span', modifier ? `metric__value ${modifier}` : 'metric__value', text);
}

/** Направление берётся из знака дельты, а не задаётся отдельно (V-15). */
export function deltaNode(value, { shape = DELTA_SHAPES.voc, growth = GROWTH.good, className, large } = {}) {
  const shown = shape.round(value);
  const direction = trendOf(shown);
  if (!direction) return null;
  return delta({ text: shape.format(shown), direction, tone: growth[direction], caption: TREND_CAPTION[direction], className, large });
}

/** Дельта стоит рядом с числом; без сравнения слот пуст и скрыт — карточка не меняет высоту (B-07). */
export function leadNode(value, { shape = DELTA_SHAPES.voc, growth = GROWTH.good, large = false } = {}) {
  const node = deltaNode(value, { shape, growth, className: 'metric__lead', large });
  if (node) return node;
  const empty = delta({ text: '\u00a0', direction: 'flat', large, className: 'metric__lead metric__lead--empty' });
  empty.setAttribute('aria-hidden', 'true');
  return empty;
}

/** J-65: число и его дельта — одна строка; не помещаясь, дельта переходит под число. */
export function figureNode(valueText, lead, modifier) {
  const figure = element('span', 'metric__figure');
  figure.append(valueNode(valueText, modifier), lead);
  return figure;
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

export function planCaptionNode(plan) {
  if (!plan) return null;
  return element('span', 'metric__meta', `План: ${formatVoc(plan.min)}–${formatVoc(plan.max)}`);
}

export function countNode(count) {
  return element('span', 'metric__meta', `${formatCount(count)} ${pluralRatings(count)}`);
}

/** Дельта числа оценок — сразу после «N оценок»; без предыдущего периода её нет. Рост объёма нейтрален, спад — тревога (D-49). */
export function countDeltaNode(count, previousCount) {
  if (!previousCount) return null;
  return deltaNode(count - previousCount, { shape: DELTA_SHAPES.count, growth: GROWTH.volume, className: 'metric__count-delta' });
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
