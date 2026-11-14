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
import { DELTA_SHAPES, GROWTH, deltaNode } from './metric-card.js';

export const CONVERSION_TITLE = 'Конверсия опроса';

/* Ширина полосы на ступени — доля высоты луча. Неизвестных ступеней в выгрузке нет: их ширина условная,
   поток лишь показывает, что аудитория шире оценивших. Известные — по корню доли, иначе 2 % сниженных
   с причиной не видно; не тоньше нити */
const WIDE = { mau: 1.5, sent: 1.05 };
const RATED = 0.62;
const THREAD = 0.03;
const VIEW = { width: 500, height: 100 };
/* Запас рамки над и под полосой в единицах VIEW: в нём размытые слои гаснут, а не срезаются краем рамки */
export const HEADROOM = 160;
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

/*
  Поток — как в стратегии VoC (обе темы одной структурой, различается только оттенок токенов): три слоя размытия
  крупными радиусами, жёсткого контура нет — форма растворяется в фоне; левый край проявляется, к хвосту поток
  истончается до светлого ядра вдоль оси, на хвосте — тонкий светящийся луч
*/
const LAYERS = [[1.6, 0.28, 'far'], [1.25, 0.42, 'mid'], [1, 0.7, 'near']];
const GRADIENT_STOPS = 24;
const CORE_FROM = 0.75;
/* Прозрачность потока по длине: проявляется слева, держится, к хвосту светлеет и истончается — гладко, без изломов */
const KEYS = [[0, 0], [0.12, 0.8], [0.55, 0.65], [0.85, 0.6], [1, 0.3]];
function streamOpacity(offset) {
  const index = Math.max(1, KEYS.findIndex(([at]) => at >= offset));
  const [from, a] = KEYS[index - 1];
  const [to, b] = KEYS[index];
  const t = to === from ? 1 : (offset - from) / (to - from);
  return a + (b - a) * t * t * (3 - 2 * t);
}
const BLUR = [['near', 6], ['mid', 12], ['far', 22]];

function beamNode(steps) {
  /* Карточка одна на странице, контент перерисовывается целиком: ссылки градиента и фильтров не пересекаются */
  const id = 'conversion-beam';
  const svg = svgNode('svg', 'conversion__beam', { viewBox: `0 ${-HEADROOM} ${VIEW.width} ${VIEW.height + 2 * HEADROOM}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  const defs = svgNode('defs');
  const gradient = svgNode('linearGradient', null, { id: `${id}-flow`, x1: 0, y1: 0, x2: 1, y2: 0 });
  /* Поток — оттенок `--funnel-stream`; к хвосту светлеет к ядру `--funnel-core`; левый край проявляется из фона */
  /* Частые точки по сглаженной кривой прозрачности: длинный полупрозрачный градиент на двух-трёх точках
     давал видимые ступени (banding) на 8-битном цвете */
  for (let step = 0; step <= GRADIENT_STOPS; step += 1) {
    const offset = step / GRADIENT_STOPS;
    gradient.append(svgNode('stop', `conversion__stop conversion__stop--${offset < CORE_FROM ? 'stream' : 'core'}`,
      { offset, 'stop-opacity': streamOpacity(offset) }));
  }
  defs.append(gradient);
  for (const [name, deviation] of BLUR) {
    const filter = svgNode('filter', null, { id: `${id}-${name}`, x: '-20%', y: '-200%', width: '140%', height: '500%' });
    filter.append(svgNode('feGaussianBlur', null, { stdDeviation: deviation }));
    defs.append(filter);
  }
  /* Едва заметный шум поверх потока (дизеринг): гасит остаточные ступени градиента на любом экране */
  const grain = svgNode('filter', null, { id: `${id}-grain`, x: 0, y: 0, width: '100%', height: '100%' });
  grain.append(svgNode('feTurbulence', null, { type: 'fractalNoise', baseFrequency: 0.9, numOctaves: 2, stitchTiles: 'stitch', result: 'noise' }),
    svgNode('feColorMatrix', null, { in: 'noise', type: 'matrix', values: '0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.06 0' }));
  defs.append(grain);
  svg.append(defs);

  const heights = bandHeights(steps);
  for (const [scale, opacity, blur] of LAYERS) {
    svg.append(svgNode('path', 'conversion__band', { d: bandPath(heights, scale), fill: `url(#${id}-flow)`, 'fill-opacity': opacity, filter: `url(#${id}-${blur})` }));
  }
  svg.append(svgNode('rect', 'conversion__grain', { x: 0, y: -HEADROOM, width: VIEW.width, height: VIEW.height + 2 * HEADROOM, filter: `url(#${id}-grain)` }));
  const mid = VIEW.height / 2;
  /* Светлое ядро вдоль оси — от аудитории к причине, размыто, как сердцевина потока */
  svg.append(svgNode('line', 'conversion__core', { x1: columnCenters()[0], x2: VIEW.width, y1: mid, y2: mid, filter: `url(#${id}-near)`, 'vector-effect': 'non-scaling-stroke' }));
  /* Нить — от сниженных к причине и дальше до края: тонкий луч хвоста с мягким ореолом потока */
  svg.append(svgNode('line', 'conversion__thread', { x1: columnCenters()[3], x2: VIEW.width, y1: mid, y2: mid, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

/* Дельта к прошлому периоду под числом: у оценок — число, у 1–3 и «с ОС» — доля в п.п.; цвет — по смыслу роста */
function changeNode(change) {
  const slot = element('span', 'conversion__change');
  if (!change) {
    slot.setAttribute('aria-hidden', 'true');
    return slot;
  }
  const node = deltaNode(change.value, { shape: change.kind === 'count' ? DELTA_SHAPES.count : DELTA_SHAPES.share, growth: GROWTH[change.growth] });
  if (node) slot.append(node);
  return slot;
}

/* Ступень: подпись капсом сверху, значение и доля снизу; полное название — в доступном имени и подсказке */
function stepNode({ key, label, short, count, share, change }) {
  const item = element('li', `conversion__step conversion__step--${key}`);
  item.title = label;
  const caption = element('span', 'conversion__label', short);
  caption.setAttribute('aria-hidden', 'true');
  const name = element('span', 'visually-hidden', `${label}: `);
  const value = count === null ? emptyValue('нет в выгрузке') : element('span', 'conversion__value', formatCount(count));
  const part = element('span', 'conversion__share', share === null ? '' : formatShare(share));
  if (share === null) part.setAttribute('aria-hidden', 'true');
  /* Доля и дельта — одной строкой под числом: строка луча остаётся выше в карточке фиксированной высоты */
  const row = element('span', 'conversion__share-row');
  row.append(part, changeNode(change));
  item.append(caption, name, value, row);
  return item;
}

/* Подпись: за целый месяц — только база долей; за другой период — ещё и сам период, иначе неясно, о чём ступени */
export function conversionNote(period, rows) {
  if (!period?.from || isWholeMonth(period, rows)) return 'от оценивших';
  return `за ${formatDayRange(period.from, period.to)}, от оценивших`;
}

export function renderConversion(block, { slice, previousSlice, period, rows }) {
  block.setTitle?.(CONVERSION_TITLE);
  block.setHead({ note: conversionNote(period, rows) });
  if (slice.length === 0) {
    block.setState(EMPTY);
    return;
  }
  const steps = surveyConversion(slice, previousSlice);
  const layout = element('div', 'conversion');
  layout.style.setProperty('--beam-headroom', HEADROOM / VIEW.height);
  const list = element('ol', 'conversion__steps');
  list.setAttribute('role', 'list');
  list.append(...steps.map(stepNode));
  layout.append(beamNode(steps), list);
  block.setContent(layout);
}
