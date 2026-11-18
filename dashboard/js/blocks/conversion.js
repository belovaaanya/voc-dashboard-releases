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

/*
  Луч строится по числам ступеней (просьба пользователя 17.11: «чтобы по реальным данным строился»). Толщина ступени —
  корень её доли от первой известной ступени (MAU, а без листа MAU — оценки): `TOP * √(n / база)`, не тоньше нити
  `THREAD`. Корень, а не прямая доля: оценок ≈10 % MAU, сниженных — доли процента, в прямой шкале всё правее MAU
  было бы нитью; логарифм сплющил бы перепад MAU → оценки, который и есть смысл воронки. Ступени без числа луч не
  выдумывает: до первой известной ступени луча нет, пропуск внутри — среднее геометрическое соседей
*/
const TOP = 1.5;
const THREAD = 0.03;
/** Ступени из листа `audience` — в узкой карточке их нет: их доли в подписи шапки. */
const AUDIENCE_STEPS = new Set(['mau', 'sent']);
const VIEW = { width: 500, height: 100 };
/* Запас рамки над и под полосой в единицах VIEW: в нём размытые слои гаснут, а не срезаются краем рамки */
export const HEADROOM = 160;
/** Запас рамки луча долей строки полосы — `--beam-headroom` у контейнера луча. */
export const BEAM_HEADROOM = HEADROOM / VIEW.height;
/*
  Доли ширины колонок ступеней — те же, что `grid-template-columns` у `.conversion` (metrics.css); по ним же стоят
  центры полосы. Колонки равные: у MAU и опроса теперь свои доли («100,0 %», «37,5 % ↗» ≈65–85 px), прежние узкие
  колонки под «—» (0,45 и 0,5) сводили их вплотную. Рядом с долей только стрелка — на 1280 колонке ≈89 px хватает
*/
const COLUMNS = [1, 1, 1, 1, 1];
/*
  Узкая карточка («Для аналитика», ≈280 px): ступени без данных (MAU и опрос — «—») не показываются, три колонки —
  `.conversion--compact` в metrics.css; иначе подписи «MAU · ОПРОС · ОЦЕНКИ» слипались, а дельты соседних ступеней
  пересекались
*/
const COMPACT_COLUMNS = [1.2, 1, 1];

/** Толщина ступени: `TOP * √(n / base)`, не тоньше нити; числа нет — null (луч там не рисуется). */
export function flowHeight(count, base) {
  if (!Number.isFinite(count) || !base) return null;
  return Math.max(THREAD, TOP * Math.sqrt(count / base));
}

/* База — первая известная ступень (`base` задаёт узкая карточка: её ступени — от MAU широкой) */
export function beamHeights(steps, base = steps.find(({ count }) => Number.isFinite(count) && count > 0)?.count) {
  const heights = steps.map(({ count }) => flowHeight(count, base));
  /* Пропуск внутри известных — среднее геометрическое соседей; после последней известной — её толщина */
  const first = heights.findIndex((height) => height !== null);
  if (first < 0) return heights;
  for (let index = first + 1; index < heights.length; index += 1) {
    if (heights[index] !== null) continue;
    const next = heights.slice(index + 1).find((height) => height !== null);
    heights[index] = next ? Math.sqrt(heights[index - 1] * next) : heights[index - 1];
  }
  return heights;
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

/* Контур: от `startX` ровно до центра первой известной ступени, плавные переходы между центрами, хвост до края */
function bandPath(heights, columns) {
  const mid = VIEW.height / 2;
  const centers = columnCenters(columns);
  const first = heights.findIndex((height) => height !== null);
  const points = heights.slice(first).map((height, index) => [centers[first + index], (height * VIEW.height) / 2]);
  const startX = beamStart(first, columns);
  const [firstX, firstH] = points[0];
  const [lastX, lastH] = points.at(-1);
  let path = `M${startX} ${mid - firstH} L${firstX} ${mid - firstH}`;
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
  return `${path} L${startX} ${mid + firstH} Z`;
}

/* Луч начинается у левого края колонки первой известной ступени: левее данных нет */
function beamStart(first, columns) {
  const total = columns.reduce((sum, part) => sum + part, 0);
  return (columns.slice(0, first).reduce((sum, part) => sum + part, 0) / total) * VIEW.width;
}

/*
  Вид — макет «Конверсии опроса» (Figma `5362:4052` тёмная, `5366:8560` светлая, «поток · тело»): один контур серого
  тона, радиальный градиент от прозрачного у начала луча через светло-серый к серому (`--funnel-gray-*`, как у
  воронки обзвона), без светящейся нити и цветного ядра. Размытие прогрессивное — слой 10 над MAU и опросом, к колонке
  оценок спадает до 2: размытая и чёткая копии контура под дополняющими масками с плавной кривой, шва нет. `FOCUS` —
  начало и конец перехода в ширинах колонки от середины колонки оценок. Радиусы — по X и по Y отдельно: рамка луча
  растянута (`preserveAspectRatio: none`), единица по Y на экране меньше
*/
const BLUR = { soft: '5 8', sharp: '1 1.6' };
const FOCUS = [-0.5, 0.35];
const MASK_STOPS = 8;

/* Маска перехода: `soft` — видно слева и гаснет к `to`, `crisp` — наоборот; кривая гладкая (smoothstep) */
function focusMask(id, name, [from, to]) {
  const ramp = svgNode('linearGradient', null, { id: `${id}-${name}-ramp`, gradientUnits: 'userSpaceOnUse', x1: from, x2: to, y1: 0, y2: 0 });
  for (let step = 0; step <= MASK_STOPS; step += 1) {
    const t = step / MASK_STOPS;
    const eased = t * t * (3 - 2 * t);
    ramp.append(svgNode('stop', null, { offset: t, 'stop-color': 'white', 'stop-opacity': name === 'soft' ? 1 - eased : eased }));
  }
  const region = { x: -VIEW.width, y: -HEADROOM * 2, width: VIEW.width * 3, height: VIEW.height + HEADROOM * 4 };
  const mask = svgNode('mask', null, { id: `${id}-${name}`, maskUnits: 'userSpaceOnUse', ...region });
  mask.append(svgNode('rect', null, { ...region, fill: `url(#${id}-${name}-ramp)` }));
  return [ramp, mask];
}

/* Где луч становится чётким: от `FOCUS[0]` до `FOCUS[1]` ширины колонки вокруг середины оценок; нет оценок — середина */
function focusRange(steps, columns) {
  const centers = columnCenters(columns);
  const index = steps.findIndex(({ key }) => key === 'rated');
  const total = columns.reduce((sum, part) => sum + part, 0);
  const at = index < 0 ? VIEW.width / 2 : centers[index];
  const width = ((index < 0 ? 1 : columns[index]) / total) * VIEW.width;
  return FOCUS.map((share) => Math.max(0, Math.min(VIEW.width, at + share * width)));
}

/**
 * Луч воронки по числам ступеней `steps` (`count`; null — числа нет). `base` — число, от которого толщина (узкая
 * карточка передаёт MAU широкой); `id` разводит ссылки градиента и фильтров двух карточек с лучом.
 */
export function beamNode(steps, compact, { base, columns = compact ? COMPACT_COLUMNS : COLUMNS, id = 'conversion-beam' } = {}) {
  const svg = svgNode('svg', 'conversion__beam', { viewBox: `0 ${-HEADROOM} ${VIEW.width} ${VIEW.height + 2 * HEADROOM}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  const heights = beamHeights(steps, ...(base ? [base] : []));
  const first = heights.findIndex((height) => height !== null);
  /* Ни одного числа — луча нет: рисовать нечего */
  if (first < 0) return svg;
  const startX = beamStart(first, columns);
  const mid = VIEW.height / 2;
  const defs = svgNode('defs');
  /* Градиент макета: прозрачный у начала луча → светло-серый к 43 % радиуса → серый; центр — начало луча */
  const gradient = svgNode('radialGradient', null, {
    id: `${id}-flow`, cx: 0, cy: 0, r: 1, gradientUnits: 'userSpaceOnUse',
    gradientTransform: `translate(${startX} ${mid}) scale(${(VIEW.width - startX) * 0.625} ${VIEW.height * 2})`,
  });
  gradient.append(svgNode('stop', 'conversion__flow-stop conversion__flow-stop--clear', { offset: 0 }),
    svgNode('stop', 'conversion__flow-stop conversion__flow-stop--mid', { offset: 0.43 }),
    svgNode('stop', 'conversion__flow-stop', { offset: 1 }));
  defs.append(gradient);
  for (const [name, deviation] of Object.entries(BLUR)) {
    const filter = svgNode('filter', null, { id: `${id}-blur-${name}`, x: '-20%', y: '-200%', width: '140%', height: '500%' });
    filter.append(svgNode('feGaussianBlur', null, { stdDeviation: deviation }));
    defs.append(filter);
  }
  const focus = focusRange(steps, columns);
  defs.append(...focusMask(id, 'soft', focus), ...focusMask(id, 'crisp', focus));
  /* Едва заметный шум поверх потока (дизеринг): гасит ступени полупрозрачного градиента на 8-битном цвете */
  const grain = svgNode('filter', null, { id: `${id}-grain`, x: 0, y: 0, width: '100%', height: '100%' });
  grain.append(svgNode('feTurbulence', null, { type: 'fractalNoise', baseFrequency: 0.9, numOctaves: 2, stitchTiles: 'stitch', result: 'noise' }),
    svgNode('feColorMatrix', null, { in: 'noise', type: 'matrix', values: '0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.06 0' }));
  defs.append(grain);
  svg.append(defs);
  /* Маска — на группе, фильтр — на контуре внутри: маска режет уже размытый слой, иначе края перехода тоже размылись бы */
  const d = bandPath(heights, columns);
  for (const [blur, mask] of [['soft', 'soft'], ['sharp', 'crisp']]) {
    const group = svgNode('g', null, { mask: `url(#${id}-${mask})` });
    group.append(svgNode('path', 'conversion__band', { d, fill: `url(#${id}-flow)`, filter: `url(#${id}-blur-${blur})` }));
    svg.append(group);
  }
  svg.append(svgNode('rect', 'conversion__grain', { x: 0, y: -HEADROOM, width: VIEW.width, height: VIEW.height + 2 * HEADROOM, filter: `url(#${id}-grain)` }));
  return svg;
}

/*
  Изменение доли к прошлому месяцу — рядом с крупной долей только стрелкой в цвете по смыслу роста (решение после
  созвона с дизайнером 17.11: процент, дельта и число подряд — непонятно, куда смотреть). Сама дельта в п. п. и база —
  в подсказке ступени (`changeHint`) и для screen reader. У оценок изменения нет: их доля — база
*/
const changeShape = (change) => (change.fine ? DELTA_SHAPES.shareFine : DELTA_SHAPES.share);
function changeNode(change) {
  const slot = element('span', 'conversion__change');
  if (!change) {
    slot.setAttribute('aria-hidden', 'true');
    return slot;
  }
  const node = deltaNode(change.value, { shape: changeShape(change), growth: GROWTH[change.growth], arrowOnly: true });
  if (node) slot.append(node);
  return slot;
}

/* Подсказка ступени: полное название и изменение доли в п. п. с базой — «к прошлому месяцу, доля от MAU» */
function changeHint(label, change) {
  if (!change) return label;
  const shape = changeShape(change);
  return `${label}\nК прошлому месяцу: ${shape.format(shape.round(change.value))}, доля от MAU`;
}

/*
  Ступень (база — MAU): подпись капсом сверху; ниже крупно доля от MAU и рядом стрелка изменения; под ними мелко
  серым — число. Дельта в п. п. — в подсказке. MAU — база: «100 %» без изменения, мелко — число пользователей. Доля меньше 1 % —
  с двумя знаками. Не помещаясь, изменение уходит под долю, а не наезжает на соседнюю ступень. Полное название — в
  доступном имени
*/
const UNITS = { mau: ['пользователь', 'пользователя', 'пользователей'], sent: ['клиент', 'клиента', 'клиентов'] };
const RATINGS = ['оценка', 'оценки', 'оценок'];
const isFine = (share) => share !== null && share < 1;
const shareText = (share) => (isFine(share) ? formatShareFine(share) : formatShare(share));
function stepNode({ key, label, short, count, share, change }) {
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
    item.title = changeHint(label, share === null ? null : delta);
    line.append(share === null ? emptyValue() : element('span', 'conversion__value', shareText(share)), changeNode(delta));
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
  Данных MAU и рассылки ещё нет: композиция карточки (широкой — пять ступеней, узкой — три) — луч и подписи
  ступеней — приглушена, на месте чисел серые полосы, поверх — надпись. Ни одного числа: пример легко принять за данные. Без сроков и без «in progress»
*/
export const PENDING = { title: 'Данные в процессе сбора', detail: 'Подключаем MAU и рассылки опроса' };
/* Форма луча условная — та же, что у карточки с данными, но не по чьим-то числам: MAU и опрос шире оценок */

/*
  `counts` — ступени из оценок месяца без листа MAU (MAU и опрос — null): луч по ним начинается у оценок, слева пусто;
  чисел на карточке нет — только форма и надпись
*/
function pendingNode(compact, counts) {
  const steps = (counts ?? SURVEY_STEPS).filter(({ key }) => !compact || !AUDIENCE_STEPS.has(key));
  const layout = element('div', `conversion${compact ? ' conversion--compact' : ''} conversion--pending`);
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
  layout.append(beamNode(steps, compact, { id: 'conversion-pending-beam' }), list, note);
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
  const chosen = conversionMonth(period, rows);
  /* Срез другого месяца берётся тем же селектором с его границами: без селектора считать не по чему */
  const resolved = chosen && (!chosen.shifted || select) ? chosen : null;
  const pending = !context.audience?.length;
  block.element?.classList.toggle('card--conversion-pending', pending);
  if (pending) {
    /* Форма луча — по оценкам того же месяца, что карточка покажет с MAU; месяца нет — без луча */
    const ratings = resolved ? (resolved.shifted ? select({ from: resolved.month.from, to: resolved.month.to }).rows : slice) : null;
    block.setHead();
    block.setContent(pendingNode(compact, ratings ? surveyConversion(ratings, { mau: null, surveyed: null }) : null));
    return;
  }
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
  const shown = narrow ? all.filter(({ key }) => !AUDIENCE_STEPS.has(key)) : all;
  const layout = element('div', narrow ? 'conversion conversion--compact' : 'conversion');
  layout.style.setProperty('--beam-headroom', BEAM_HEADROOM);
  const list = element('ol', 'conversion__steps');
  list.setAttribute('role', 'list');
  list.append(...shown.map((step) => stepNode(step)));
  layout.append(beamNode(shown, narrow, { base: all[0].count }), list);
  block.setContent(layout);
}
