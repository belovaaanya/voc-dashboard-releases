/*
  «Конверсия опроса» — карточка второй строки шапки за целый месяц, на месте «Дней относительно плана».
  Вид — «тонкий луч» из стратегии VoC: поток сужается от аудитории к оценке с понятной причиной.
  Расчёт — core/conversion.js; здесь только представление (docs/blocks-metrics.md).
*/

import { EMPTY } from '../shell/block.js';
import { emptyValue } from '../components/empty-value.js';
import { element, svgNode } from '../ui/dom.js';
import { formatCount, formatDayRange, formatShare, plural } from '../core/format.js';
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
/*
  Доли ширины колонок ступеней — те же, что `grid-template-columns` у `.conversion` (metrics.css); по ним же стоят
  центры полосы. У неизвестных ступеней только «—» — узкие колонки; у остальных крупное значение с изменением в строку
  («10 459 −76 % ↘» ≈118 px, «6,1 % −0,3 п. п. ↘» ≈120 px) — на 1280 (≈460 px содержимого) колонке нужно ≈121 px
*/
const COLUMNS = [0.45, 0.5, 1.2, 1.2, 1.2];
/*
  Узкая карточка («Для аналитика», ≈280 px): ступени без данных (MAU и опрос — «—») не показываются, три колонки —
  `.conversion--compact` в metrics.css; иначе подписи «MAU · ОПРОС · ОЦЕНКИ» слипались, а дельты соседних ступеней
  пересекались
*/
const COMPACT_COLUMNS = [1.2, 1, 1];

function bandHeights(steps) {
  const rated = steps.find(({ key }) => key === 'rated').count;
  return steps.map(({ key, count }) => {
    if (key in WIDE) return WIDE[key];
    if (!rated) return THREAD;
    return Math.max(THREAD, RATED * Math.sqrt(count / rated));
  });
}

/* Контур полосы: плавные переходы между центрами колонок, после последней — ровный хвост до края */
function columnCenters(columns) {
  const total = columns.reduce((sum, part) => sum + part, 0);
  let start = 0;
  return columns.map((part) => {
    const center = ((start + part / 2) / total) * VIEW.width;
    start += part;
    return center;
  });
}

function bandPath(heights, scale, columns) {
  const mid = VIEW.height / 2;
  const centers = columnCenters(columns);
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
/*
  Прозрачность потока по длине — гладко, без изломов. Над MAU и опросом данных нет: поток там только проявляется
  (без вертикального края у левой границы и у начала оценок), в полную силу — к колонке оценок (центр ≈0,34),
  к хвосту светлеет и истончается
*/
const KEYS = [[0, 0], [0.2, 0.35], [0.36, 0.8], [0.55, 0.7], [0.85, 0.6], [1, 0.3]];
/* Узкая карточка начинается с оценок: поток проявляется у левого края и в полную силу входит к центру их колонки */
const COMPACT_KEYS = [[0, 0], [0.12, 0.8], [0.55, 0.65], [0.85, 0.6], [1, 0.3]];
function streamOpacity(offset, keys) {
  const index = Math.max(1, keys.findIndex(([at]) => at >= offset));
  const [from, a] = keys[index - 1];
  const [to, b] = keys[index];
  const t = to === from ? 1 : (offset - from) / (to - from);
  return a + (b - a) * t * t * (3 - 2 * t);
}
const BLUR = [['near', 6], ['mid', 12], ['far', 22]];

function beamNode(steps, compact) {
  const columns = compact ? COMPACT_COLUMNS : COLUMNS;
  const keys = compact ? COMPACT_KEYS : KEYS;
  const centers = columnCenters(columns);
  const at = (key) => centers[steps.findIndex((step) => step.key === key)];
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
      { offset, 'stop-opacity': streamOpacity(offset, keys) }));
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
    svg.append(svgNode('path', 'conversion__band', { d: bandPath(heights, scale, columns), fill: `url(#${id}-flow)`, 'fill-opacity': opacity, filter: `url(#${id}-${blur})` }));
  }
  svg.append(svgNode('rect', 'conversion__grain', { x: 0, y: -HEADROOM, width: VIEW.width, height: VIEW.height + 2 * HEADROOM, filter: `url(#${id}-grain)` }));
  const mid = VIEW.height / 2;
  /* Светлое ядро вдоль оси — от аудитории к причине, размыто, как сердцевина потока */
  svg.append(svgNode('line', 'conversion__core', { x1: centers[0], x2: VIEW.width, y1: mid, y2: mid, filter: `url(#${id}-near)`, 'vector-effect': 'non-scaling-stroke' }));
  /* Нить — от сниженных к причине и дальше до края: тонкий луч хвоста с мягким ореолом потока */
  svg.append(svgNode('line', 'conversion__thread', { x1: at('negative'), x2: VIEW.width, y1: mid, y2: mid, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

/*
  Изменение доли к прошлому периоду — в строке крупной доли, в п.п., цвет по смыслу роста. У оценок изменения нет:
  их доля — база, всегда 100 %. Доли сравнимы и при неполном периоде — цвет по смыслу и тогда
*/
function changeNode(change, compact) {
  /* В узкой карточке изменение без стрелки: направление несут знак и цвет, словом — для screen reader */
  const arrow = !compact;
  const slot = element('span', 'conversion__change');
  if (!change) {
    slot.setAttribute('aria-hidden', 'true');
    return slot;
  }
  const node = deltaNode(change.value, { shape: DELTA_SHAPES.share, growth: GROWTH[change.growth], arrow });
  if (node) slot.append(node);
  return slot;
}

/*
  Ступень (решение пользователя, исправляет J-299): подпись капсом сверху; ниже крупно доля от оценивших и в той же
  строке её изменение в п.п.; под ними мелко серым — число. Первая известная ступень — «Оценки» — база: «100 %» без
  изменения, мелко — число оценок. Не помещаясь, изменение уходит под долю, а не наезжает на соседнюю ступень.
  Полное название — в доступном имени
*/
function stepNode({ key, label, short, count, share, change }, compact) {
  const item = element('li', `conversion__step conversion__step--${key}`);
  item.title = label;
  const caption = element('span', 'conversion__label', short);
  caption.setAttribute('aria-hidden', 'true');
  const name = element('span', 'visually-hidden', `${label}: `);
  const line = element('span', 'conversion__line');
  const small = element('span', 'conversion__share');
  if (count === null) {
    line.append(emptyValue('нет в выгрузке'));
    small.setAttribute('aria-hidden', 'true');
  } else {
    line.append(share === null ? emptyValue() : element('span', 'conversion__value', formatShare(share)), changeNode(change, compact));
    small.append(formatCount(count), element('span', 'visually-hidden', ` ${plural(count, ['оценка', 'оценки', 'оценок'])}`));
  }
  item.append(caption, name, line, small);
  return item;
}

/* Подпись: за целый месяц — только база долей; за другой период — ещё и сам период, иначе неясно, о чём ступени */
export function conversionNote(period, rows) {
  if (!period?.from || isWholeMonth(period, rows)) return 'от оценивших';
  return `за ${formatDayRange(period.from, period.to)}, от оценивших`;
}

/** `compact` — узкая карточка («Для аналитика»): только ступени с данными, дельты без стрелок. */
export function renderConversion(block, { slice, previousSlice, period, rows, compact = false }) {
  block.setTitle?.(CONVERSION_TITLE);
  block.setHead({ note: conversionNote(period, rows) });
  if (slice.length === 0) {
    block.setState(EMPTY);
    return;
  }
  const all = surveyConversion(slice, previousSlice);
  /* Узкая карточка — без MAU и опроса (их в выгрузке нет); «С ОС» без признака в старой выгрузке остаётся «—»: колонок всегда три */
  const narrow = compact;
  const shown = narrow ? all.filter(({ key }) => !(key in WIDE)) : all;
  const layout = element('div', narrow ? 'conversion conversion--compact' : 'conversion');
  layout.style.setProperty('--beam-headroom', HEADROOM / VIEW.height);
  const list = element('ol', 'conversion__steps');
  list.setAttribute('role', 'list');
  list.append(...shown.map((step) => stepNode(step, narrow)));
  layout.append(beamNode(shown, narrow), list);
  block.setContent(layout);
}
