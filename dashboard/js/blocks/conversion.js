/*
  «Конверсия опроса» — карточка второй строки шапки за полный месяц, на месте «Дней относительно плана». Доли — от MAU
  канала или сегмента за месяц (решение руководителей); без MAU, за неполный месяц и при узком фильтре — пустое состояние
  с причиной, ступени не пересчитываются.
  Вид — «тонкий луч» из стратегии VoC: поток сужается от аудитории к оценке с понятной причиной.
  Расчёт — core/conversion.js; здесь только представление (docs/blocks-metrics.md).
*/

import { EMPTY } from '../shell/block.js';
import { emptyValue } from '../components/empty-value.js';
import { element, svgNode } from '../ui/dom.js';
import { formatCount, formatShare, formatShareFine, monthName, plural } from '../core/format.js';
import { SURVEY_STEPS, audienceFor, conversionMonth, conversionScope, isWholeMonth, previousMonth, surveyConversion } from '../core/conversion.js';
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
/** Запас рамки луча долей строки полосы — `--beam-headroom` у контейнера луча. */
export const BEAM_HEADROOM = HEADROOM / VIEW.height;
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

/** Ширина полосы ступени от базы `base` (оценок): по корню доли, не тоньше нити. Её же берёт воронка обзвона. */
export function flowHeight(count, base) {
  if (!base) return THREAD;
  return Math.max(THREAD, RATED * Math.sqrt(count / base));
}

function bandHeights(steps) {
  const rated = steps.find(({ key }) => key === 'rated').count;
  return steps.map(({ key, count }) => (key in WIDE ? WIDE[key] : flowHeight(count, rated)));
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

/**
 * Луч воронки. Параметры по умолчанию — «Конверсия опроса»; воронка обзвона («Для аналитика») передаёт свои колонки,
 * ширины полосы, ступень начала нити и `id` (две карточки с лучом не делят ссылки градиента и фильтров).
 */
export function beamNode(steps, compact, { heights = bandHeights(steps), columns = compact ? COMPACT_COLUMNS : COLUMNS, keys = compact ? COMPACT_KEYS : KEYS, threadFrom = 'negative', id = 'conversion-beam' } = {}) {
  const centers = columnCenters(columns);
  const at = (key) => centers[steps.findIndex((step) => step.key === key)];
  /* Контент карточки перерисовывается целиком: в пределах `id` ссылки градиента и фильтров не пересекаются */
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

  for (const [scale, opacity, blur] of LAYERS) {
    svg.append(svgNode('path', 'conversion__band', { d: bandPath(heights, scale, columns), fill: `url(#${id}-flow)`, 'fill-opacity': opacity, filter: `url(#${id}-${blur})` }));
  }
  svg.append(svgNode('rect', 'conversion__grain', { x: 0, y: -HEADROOM, width: VIEW.width, height: VIEW.height + 2 * HEADROOM, filter: `url(#${id}-grain)` }));
  const mid = VIEW.height / 2;
  /* Светлое ядро вдоль оси — от аудитории к причине, размыто, как сердцевина потока */
  svg.append(svgNode('line', 'conversion__core', { x1: centers[0], x2: VIEW.width, y1: mid, y2: mid, filter: `url(#${id}-near)`, 'vector-effect': 'non-scaling-stroke' }));
  /* Нить — от сниженных к причине и дальше до края: тонкий луч хвоста с мягким ореолом потока */
  svg.append(svgNode('line', 'conversion__thread', { x1: at(threadFrom), x2: VIEW.width, y1: mid, y2: mid, 'vector-effect': 'non-scaling-stroke' }));
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
  /* Малые доли от MAU — два знака и у изменения: иначе «0,0 п. п.» у любой ступени ниже процента */
  const node = deltaNode(change.value, { shape: change.fine ? DELTA_SHAPES.shareFine : DELTA_SHAPES.share, growth: GROWTH[change.growth], arrow });
  if (node) slot.append(node);
  return slot;
}

/*
  Ступень (иерархия J-314, база — MAU): подпись капсом сверху; ниже крупно доля от MAU и в той же строке её изменение в
  п.п.; под ними мелко серым — число. MAU — база: «100 %» без изменения, мелко — число пользователей. Доля меньше 1 % —
  с двумя знаками. Не помещаясь, изменение уходит под долю, а не наезжает на соседнюю ступень. Полное название — в
  доступном имени
*/
const UNITS = { mau: ['пользователь', 'пользователя', 'пользователей'], sent: ['клиент', 'клиента', 'клиентов'] };
const RATINGS = ['оценка', 'оценки', 'оценок'];
const isFine = (share) => share !== null && share < 1;
const shareText = (share) => (isFine(share) ? formatShareFine(share) : formatShare(share));
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
    /* Два знака и у изменения, если доля или само изменение меньше процента: «0,04 п. п.» при доле 1,2 % не станет «0,0» */
    const delta = change && { ...change, fine: isFine(share) || Math.abs(change.value) < 0.1 };
    line.append(share === null ? emptyValue() : element('span', 'conversion__value', shareText(share)), changeNode(delta, compact));
    small.append(formatCount(count), element('span', 'visually-hidden', ` ${plural(count, UNITS[key] ?? RATINGS)}`));
  }
  item.append(caption, name, line, small);
  return item;
}

/* Подпись: база долей и месяц — «от MAU за май»; выбран незаконченный период — явно: «за октябрь — последний полный месяц» */
export function conversionNote(month, shifted = false) {
  if (!month?.from) return 'от MAU';
  return shifted ? `за ${monthName(month.from)} — последний полный месяц, от MAU` : `от MAU за ${monthName(month.from)}`;
}

/*
  Данных MAU и рассылки ещё нет: композиция узкой карточки — луч и подписи ступеней — приглушена, на месте чисел серые
  полосы, поверх — надпись. Ни одного числа: пример легко принять за данные. Без сроков и без «in progress»
*/
export const PENDING = { title: 'Данные в процессе сбора', detail: 'Подключаем MAU и рассылки опроса' };
/* Форма луча условная — та же, что у узкой карточки с данными, но не по чьим-то числам */
const PENDING_HEIGHTS = [0.62, 0.26, 0.14];

function pendingNode() {
  const steps = SURVEY_STEPS.filter(({ key }) => !(key in WIDE));
  const layout = element('div', 'conversion conversion--compact conversion--pending');
  layout.style.setProperty('--beam-headroom', BEAM_HEADROOM);
  /* Каркас декоративный: скринридер читает только надпись */
  const list = element('ol', 'conversion__steps');
  list.setAttribute('aria-hidden', 'true');
  list.append(...steps.map(({ key, short }) => {
    const item = element('li', `conversion__step conversion__step--${key}`);
    const line = element('span', 'conversion__line');
    line.append(element('span', 'conversion__bar'));
    item.append(element('span', 'conversion__label', short), line, element('span', 'conversion__share'));
    return item;
  }));
  /* Надпись — одна строка поверх полосы луча; что подключается — в подсказке и для screen reader */
  const note = element('p', 'conversion__pending', PENDING.title);
  note.setAttribute('role', 'status');
  note.title = PENDING.detail;
  note.append(element('span', 'visually-hidden', `. ${PENDING.detail}`));
  layout.append(beamNode(steps, true, { heights: PENDING_HEIGHTS, id: 'conversion-pending-beam' }), list, note);
  return layout;
}

/* Пустые состояния с причиной: ступени не пересчитываются (решение руководителей — без «у вас не сходится») */
export const CONVERSION_STATES = {
  month: 'В выгрузке нет полного месяца для конверсии',
  filters: 'Конверсия считается для всего канала или одного сегмента — снимите фильтры по триггеру, ОС и другим',
  segments: 'Конверсия считается для всего канала или одного сегмента',
  cashback: 'Конверсия считается по всем оценкам канала — включите «С кэшбеком»',
  audience: 'Нет данных о MAU и рассылке опроса за месяц',
};

/** Почему конверсия не считается для среза за месяц `month` — ключ `CONVERSION_STATES` — или null, если считается. */
export function conversionBlocker({ state, audience }, month) {
  if (!month) return 'month';
  const scope = conversionScope(state?.filters, state);
  if (scope.reason) return scope.reason;
  if (!audienceFor(audience, { channel: state?.channel, segment: scope.segment, month: month.from.slice(0, 7) })) return 'audience';
  return null;
}

/*
  База изменения — прошлый календарный месяц со своим срезом и своей строкой `audience`, и только если выгрузка покрывает
  его целиком: часть сентября против полного сентябрьского MAU показала бы ложный рост
*/
function previousMonthBase({ rows, select, audience, state }, month, segment) {
  const before = previousMonth(month);
  if (!select || !isWholeMonth(before, rows)) return {};
  const previousAudience = audienceFor(audience, { channel: state.channel, segment, month: before.from.slice(0, 7) });
  return previousAudience ? { previous: select({ from: before.from, to: before.to }).rows, previousAudience } : {};
}

/**
 * `compact` — узкая карточка («Для аналитика»): без ступеней MAU и опроса (их доли — в подписи шапки), дельты без стрелок.
 * Незаконченный период — конверсия за последний полный месяц со своим срезом (J-331), а не пустая карточка.
 */
export function renderConversion(block, context) {
  const { slice, period, rows, state, select, audience: sheet, compact = false } = context;
  block.setTitle?.(CONVERSION_TITLE);
  /*
    Листа MAU и рассылки ещё нет совсем — приглушённая композиция с надписью, а не пустое состояние: данные
    подключаются. Надпись зависит только от наличия листа: появится MAU — карточка покажет конверсию без правки вёрстки
  */
  const pending = !context.audience?.length;
  block.element?.classList.toggle('card--conversion-pending', pending);
  if (pending) {
    block.setHead();
    block.setContent(pendingNode());
    return;
  }
  const chosen = conversionMonth(period, rows);
  /* Срез другого месяца берётся тем же селектором с его границами: без селектора считать не по чему */
  const resolved = chosen && (!chosen.shifted || select) ? chosen : null;
  /* Полного месяца нет — подпись без месяца: «от MAU за ноябрь» над «нет полного месяца» противоречила бы себе */
  block.setHead({ note: conversionNote(resolved?.month, resolved?.shifted) });
  const blocker = conversionBlocker(context, resolved?.month);
  if (blocker) {
    block.setState(EMPTY, CONVERSION_STATES[blocker]);
    return;
  }
  const { month, shifted } = resolved;
  const { segment } = conversionScope(state.filters, state);
  const audience = audienceFor(sheet, { channel: state.channel, segment, month: month.from.slice(0, 7) });
  const ratings = shifted ? select({ from: month.from, to: month.to }).rows : slice;
  const all = surveyConversion(ratings, audience, previousMonthBase(context, month, segment));
  /* Узкая карточка — оценки, 1–3 и «с ОС» от MAU: колонок три */
  const narrow = compact;
  const shown = narrow ? all.filter(({ key }) => !(key in WIDE)) : all;
  const layout = element('div', narrow ? 'conversion conversion--compact' : 'conversion');
  layout.style.setProperty('--beam-headroom', BEAM_HEADROOM);
  const list = element('ol', 'conversion__steps');
  list.setAttribute('role', 'list');
  list.append(...shown.map((step) => stepNode(step, narrow)));
  layout.append(beamNode(shown, narrow), list);
  block.setContent(layout);
}
