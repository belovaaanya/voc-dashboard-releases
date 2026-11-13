/*
  «Конверсия опроса» — карточка второй строки шапки за целый месяц, на месте «Дней относительно плана».
  Вид — «тонкий луч» из стратегии VoC: поток сужается от аудитории к оценке с понятной причиной.
  Расчёт — core/conversion.js; здесь только представление (docs/blocks-metrics.md).
*/

import { EMPTY } from '../shell/block.js';
import { emptyValue } from '../components/empty-value.js';
import { element, svgNode } from '../ui/dom.js';
import { formatCount, formatDayRange, formatShare } from '../core/format.js';
import { isWholeMonth, surveyConversion } from '../core/conversion.js';

export const CONVERSION_TITLE = 'Конверсия опроса';

/* Ширина полосы на ступени — доля высоты луча. Неизвестных ступеней в выгрузке нет: их ширина условная,
   поток лишь показывает, что аудитория шире оценивших. Известные — по корню доли, иначе 2 % сниженных
   с причиной не видно; не тоньше нити */
const WIDE = { mau: 1, sent: 0.72 };
const RATED = 0.46;
const THREAD = 0.03;
const VIEW = { width: 500, height: 100 };
/* Доли ширины колонок ступеней — те же, что `grid-template-columns` у `.conversion` (metrics.css): у неизвестных
   ступеней только «—», «10 459» оценок шире; по ним же стоят центры полосы */
const COLUMNS = [0.7, 0.9, 1.4, 1, 1];

function bandHeights(steps) {
  const rated = steps.find(({ key }) => key === 'rated').count;
  return steps.map(({ key, count }) => {
    if (key in WIDE) return WIDE[key];
    if (!rated) return THREAD;
    return Math.max(THREAD, RATED * Math.sqrt(count / rated));
  });
}

/* Контур полосы: плавные переходы между центрами колонок, после последней — ровный хвост до края */
function columnCenters() {
  const total = COLUMNS.reduce((sum, part) => sum + part, 0);
  let start = 0;
  return COLUMNS.map((part) => {
    const center = ((start + part / 2) / total) * VIEW.width;
    start += part;
    return center;
  });
}

function bandPath(heights, scale) {
  const mid = VIEW.height / 2;
  const centers = columnCenters();
  const points = heights.map((height, index) => [centers[index], (height * VIEW.height * scale) / 2]);
  const [firstX, firstH] = points[0];
  const [lastX, lastH] = points.at(-1);
  let path = `M0 ${mid - firstH} L${firstX} ${mid - firstH}`;
  for (let index = 1; index < points.length; index += 1) {
    const [x0, h0] = points[index - 1];
    const [x1, h1] = points[index];
    const cx = (x0 + x1) / 2;
    path += ` C${cx} ${mid - h0} ${cx} ${mid - h1} ${x1} ${mid - h1}`;
  }
  path += ` L${VIEW.width} ${mid - lastH} L${VIEW.width} ${mid + lastH} L${lastX} ${mid + lastH}`;
  for (let index = points.length - 1; index > 0; index -= 1) {
    const [x0, h0] = points[index];
    const [x1, h1] = points[index - 1];
    const cx = (x0 + x1) / 2;
    path += ` C${cx} ${mid + h0} ${cx} ${mid + h1} ${x1} ${mid + h1}`;
  }
  return `${path} L0 ${mid + firstH} Z`;
}

/* Три слоя размытия под полосой (8/18/34 в стратегии, здесь в масштабе карточки) и светящаяся нить хвоста */
function beamNode(steps) {
  /* Карточка одна на странице, контент перерисовывается целиком: ссылки градиента и фильтров не пересекаются */
  const id = 'conversion-beam';
  const svg = svgNode('svg', 'conversion__beam', { viewBox: `0 0 ${VIEW.width} ${VIEW.height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  const defs = svgNode('defs');
  const gradient = svgNode('linearGradient', null, { id: `${id}-flow`, x1: 0, y1: 0, x2: 1, y2: 0 });
  /* Нейтральный серый луч, как в тёмной теме стратегии: от тусклого края аудитории к светлому хвосту причины */
  for (const [offset, tone, opacity] of [[0, 'dim', 0.2], [0.4, 'mid', 0.45], [0.75, 'core', 0.8], [1, 'core', 1]]) {
    gradient.append(svgNode('stop', `conversion__stop conversion__stop--${tone}`, { offset, 'stop-opacity': opacity }));
  }
  defs.append(gradient);
  for (const [name, deviation] of [['near', 2], ['mid', 5], ['far', 9]]) {
    const filter = svgNode('filter', null, { id: `${id}-${name}`, x: '-10%', y: '-100%', width: '120%', height: '300%' });
    filter.append(svgNode('feGaussianBlur', null, { stdDeviation: deviation }));
    defs.append(filter);
  }
  svg.append(defs);

  const heights = bandHeights(steps);
  for (const [scale, opacity, blur] of [[1.6, 0.12, 'far'], [1.25, 0.18, 'mid'], [1, 0.55, 'near']]) {
    svg.append(svgNode('path', 'conversion__band', { d: bandPath(heights, scale), fill: `url(#${id}-flow)`, 'fill-opacity': opacity, filter: `url(#${id}-${blur})` }));
  }
  svg.append(svgNode('path', 'conversion__band', { d: bandPath(heights, 1), fill: `url(#${id}-flow)`, 'fill-opacity': 0.5 }));
  /* Нить — от сниженных к причине и дальше до края: тонкий луч хвоста */
  svg.append(svgNode('line', 'conversion__thread', { x1: columnCenters()[3], x2: VIEW.width, y1: VIEW.height / 2, y2: VIEW.height / 2, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

/* Ступень: подпись капсом сверху, значение и доля снизу; полное название — в доступном имени и подсказке */
function stepNode({ key, label, short, count, share }) {
  const item = element('li', `conversion__step conversion__step--${key}`);
  item.title = label;
  const caption = element('span', 'conversion__label', short);
  caption.setAttribute('aria-hidden', 'true');
  const name = element('span', 'visually-hidden', `${label}: `);
  const value = count === null ? emptyValue('нет в выгрузке') : element('span', 'conversion__value', formatCount(count));
  const part = element('span', 'conversion__share', share === null ? '' : formatShare(share));
  if (share === null) part.setAttribute('aria-hidden', 'true');
  item.append(caption, name, value, part);
  return item;
}

/* Подпись: за целый месяц — только база долей; за другой период — ещё и сам период, иначе неясно, о чём ступени */
export function conversionNote(period, rows) {
  if (!period?.from || isWholeMonth(period, rows)) return 'от оценивших';
  return `за ${formatDayRange(period.from, period.to)}, от оценивших`;
}

export function renderConversion(block, { slice, period, rows }) {
  block.setTitle?.(CONVERSION_TITLE);
  block.setHead({ note: conversionNote(period, rows) });
  if (slice.length === 0) {
    block.setState(EMPTY);
    return;
  }
  const steps = surveyConversion(slice);
  const layout = element('div', 'conversion');
  const list = element('ol', 'conversion__steps');
  list.setAttribute('role', 'list');
  list.append(...steps.map(stepNode));
  layout.append(beamNode(steps), list);
  block.setContent(layout);
}
