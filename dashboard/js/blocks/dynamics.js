import { chartTimeline } from '../components/chart-timeline.js';
import { chartTooltip, showChartTooltip } from '../components/chart-tooltip.js';
import { observeStage } from '../components/stage-observer.js';
import { dateRange, selectionDays, toggleDays } from '../state/chart-selection.js';
import { areaPaths, chartDomain, planZoneStops, countAxis, curveSamples, damageAxis, gapPaths, hitColumns, labelOrder, linePaths, placeLabels, plotPoints, xLabelIndices } from '../core/chart-geometry.js';
import { legendItem, legendList } from '../components/legend.js';
import { segmented } from '../components/segmented.js';
import { periodScaleMemory, scaleTabs } from '../components/scale-tabs.js';
import { stateText } from '../components/status-panel.js';
import { element, svgNode } from '../ui/dom.js';
import { formatCount, formatDate, formatDateRange, formatDayRange, formatDelta, formatInterval, formatRatings, formatVoc } from '../core/format.js';
import { comparedPeriod } from '../core/period.js';
import { dynamicsSheets, exportFileName } from '../core/export.js';
import { downloadAction } from '../ui/download.js';
import { planFor } from '../core/plan.js';
import { roundVoc } from '../core/round.js';
import { SCALE_OPTIONS, buildTimeSeries, recommendedScale, withDamage } from '../core/timeseries.js';

/* График рисуется в пикселях сцены, а не в растянутом viewBox: иначе на узкой странице текст мельче роли (B-17) */
/* Сверху — место под подпись значения у точки на верхней границе шкалы (B-03) */
const MARGIN = { top: 26, right: 12, bottom: 28, left: 44 };
/* Ревью 13.11: названия осей — над шкалами, слева и справа на одной линии, с теми же краями, что их цифры */
const AXIS_TITLE_Y = 8;
const POINT_RADIUS = 3;
/* Запас клипа под маркер с обводкой и под обводку линии на границе шкалы; ряды по x обрезаны точно (B-02, V-05) */
const PLOT_BLEED = POINT_RADIUS * 2;
/* Переход тона линии — по центру границы коридора (J-15): точка у границы не стоит на сером участке */
const ZONE_FADE = 16;
const LABEL_OFFSET = POINT_RADIUS + 4;
const LABEL_GAP = 2;
const LINE_SAMPLE = 3;
/* Подпись даты `дд.мм.гг` ролью type-axis; с запасом, чтобы соседние не слипались */
const DATE_LABEL_WIDTH = 44;
/* Справа — шкала числа оценок под столбики: поле по самой длинной подписи, не уже подписи «Оценки» */
const COUNT_CAPTION = 'Оценки';
const COUNT_CHAR_WIDTH = 7;
const COUNT_AXIS_GAP = 8;
/* Столбики занимают нижнюю треть: выше идёт линия VOC, и они не спорят с ней */
const VOLUME_SHARE = 0.34;
/* J-86, J-97: столбики урона — главный ряд режима: самый высокий занимает большую часть области, линия VOC поверх них — фон */
const DAMAGE_SHARE = 0.8;
const DAMAGE_CAPTION = 'Урон';
const MODE_VOC = 'voc';
const MODE_DAMAGE = 'damage';
const MODE_OPTIONS = [{ value: MODE_VOC, label: 'Средний VOC' }, { value: MODE_DAMAGE, label: 'Урон' }];
/* Ручной масштаб — для периода, в котором его выбрали: новый период снова получает автоматический */
const chartScale = periodScaleMemory();
/*
  Главная облегчена (раздел «Для аналитика», J-228): режим «Урон» и масштаб «Кварталы» — только при
  `context.analyst`. Выбор, сделанный в разделе аналитика, на главной не применяется: там всегда «Средний VOC»,
  а квартальный масштаб становится месячным
*/
const MAIN_SCALES = SCALE_OPTIONS.filter(({ value }) => value !== 'quarter');
const scaleFor = (period, analyst) => {
  const scale = chartScale.scaleFor(period, recommendedScale(period));
  return !analyst && scale === 'quarter' ? 'month' : scale;
};
let selectedMode = MODE_VOC;
/* Режим отрисовки: на главной всегда «Средний VOC» */
const modeOf = (context) => (context.analyst ? selectedMode : MODE_VOC);
let chartSequence = 0;

function svgText(className, text, attributes) {
  const node = svgNode('text', className, attributes);
  node.textContent = text;
  return node;
}

function chartScaleTabs(block, context, scale) {
  return scaleTabs({
    label: 'Масштаб графика',
    ...(context.analyst ? {} : { options: MAIN_SCALES }),
    selected: scale,
    onSelect: (value) => {
      chartScale.choose(value, context.period);
      renderDynamics(block, context);
    },
  });
}

function expandAction(block, context) {
  const expanded = block.isExpanded();
  const setExpanded = (value) => {
    block.setExpanded(value, () => setExpanded(false));
    renderDynamics(block, context);
  };
  /* Escape сворачивает с контекстом последней отрисовки, а не той, в которой карточку развернули */
  if (expanded) block.setExpanded(true, () => setExpanded(false));
  return {
    id: 'expand',
    label: expanded ? 'Свернуть график' : 'Развернуть график',
    icon: expanded ? 'collapse' : 'expand',
    onClick: () => setExpanded(!expanded),
  };
}

function shownSeries(ratings, period, scale) {
  return withDamage(buildTimeSeries(ratings, period, scale)).map((point) => ({
    ...point,
    voc: roundVoc(point.voc),
  }));
}

/* Правая шкала столбиков: оценки или, в режиме урона, урон со знаком минус */
const COUNT_BARS = { caption: COUNT_CAPTION, share: VOLUME_SHARE, tone: 'volume', format: formatCount, value: ({ count }) => count };
const DAMAGE_BARS = { caption: DAMAGE_CAPTION, share: DAMAGE_SHARE, tone: 'damage', format: (tick) => formatDelta(tick ? -tick : 0), value: ({ damage }) => (damage === null ? 0 : -damage) };

const barsAxisWidth = (bars) => Math.max(bars.spec.caption.length, bars.spec.format(bars.axis.max).length) * COUNT_CHAR_WIDTH + COUNT_AXIS_GAP;

function frameFor({ width, height }, bars) {
  const right = bars ? barsAxisWidth(bars) : MARGIN.right;
  return {
    width,
    height,
    plot: { x: MARGIN.left, y: MARGIN.top, width: width - MARGIN.left - right, height: height - MARGIN.top - MARGIN.bottom },
  };
}

function yPosition(value, domain, plot) {
  return plot.height - ((value - domain.min) / (domain.max - domain.min)) * plot.height;
}

function appendClip(defs, id, plot, { y, height, sideBleed = 0 }) {
  const clip = svgNode('clipPath', null, { id });
  clip.append(svgNode('rect', null, { x: -sideBleed, y, width: plot.width + sideBleed * 2, height: Math.max(0, height) }));
  defs.append(clip);
}

/* Заливка тянется от линии к краю коридора и гаснет к нему (Figma 3204:2892) */
function appendGradient(defs, id, tone, { strong, clear }) {
  const gradient = svgNode('linearGradient', `chart-gradient chart-gradient--${tone}`, {
    id, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: strong, y2: strong === clear ? clear + 1 : clear,
  });
  gradient.append(svgNode('stop', 'chart-gradient__strong', { offset: 0 }), svgNode('stop', 'chart-gradient__clear', { offset: 1 }));
  defs.append(gradient);
}

/* Сетка макета — пунктирная сеть: линии шкалы, промежуточные между ними и вертикали у подписей дат (Figma 3204:2909) */
function appendGrid(svg, domain, plot, xs) {
  const grid = svgNode('g', 'chart-grid', { transform: `translate(${plot.x} ${plot.y})` });
  domain.ticks.forEach((tick, index) => {
    const y = yPosition(tick, domain, plot);
    grid.append(svgNode('line', null, { x1: 0, y1: y, x2: plot.width, y2: y }));
    const next = domain.ticks[index + 1];
    if (next !== undefined) {
      const middle = yPosition((tick + next) / 2, domain, plot);
      grid.append(svgNode('line', 'chart-grid__minor', { x1: 0, y1: middle, x2: plot.width, y2: middle }));
    }
    svg.append(svgText('chart-axis-label chart-axis-label--y', formatVoc(tick), { x: 0, y: plot.y + y, 'dominant-baseline': 'middle' }));
  });
  svg.append(svgText('chart-axis-label chart-axis-label--y chart-axis-title', 'VOC', { x: 0, y: AXIS_TITLE_Y, 'dominant-baseline': 'middle' }));
  for (const x of xs) grid.append(svgNode('line', 'chart-grid__minor', { x1: x, y1: 0, x2: x, y2: plot.height }));
  svg.append(grid);
}

const edgeAnchor = (index, length) => (index === 0 ? 'start' : index === length - 1 ? 'end' : 'middle');

function appendXAxis(svg, series, points, frame, indices) {
  const labels = svgNode('g', 'chart-axis chart-axis--x', { transform: `translate(${frame.plot.x} 0)` });
  for (const index of indices) {
    labels.append(svgText('chart-axis-label', formatDate(series[index].from), {
      x: points[index].x,
      y: frame.height - 4,
      'text-anchor': edgeAnchor(index, series.length),
    }));
  }
  svg.append(labels);
}

/* Столбик объёма гаснет к оси (R-12): градиент в долях своего столбика, поэтому один на все */
function appendBarGradient(defs, id, tone) {
  const gradient = svgNode('linearGradient', `chart-gradient chart-gradient--${tone}`, { id, x1: 0, x2: 0, y1: 0, y2: 1 });
  gradient.append(svgNode('stop', 'chart-gradient__strong', { offset: 0 }), svgNode('stop', 'chart-gradient__clear', { offset: 1 }));
  defs.append(gradient);
}

const barY = (value, { axis, spec }, plot) => plot.height - (value / axis.max) * plot.height * spec.share;

/* Подписи шкалы оценок — справа от области, у верха столбиков: по ним читается высота столбика; название шкалы — наверху */
function appendBarsAxis(svg, bars, frame) {
  const { plot } = frame;
  const labels = svgNode('g', 'chart-axis chart-axis--count');
  for (const tick of bars.axis.ticks) {
    labels.append(svgText('chart-axis-label chart-axis-label--count', bars.spec.format(tick), {
      x: frame.width, y: plot.y + barY(tick, bars, plot), 'dominant-baseline': 'middle',
    }));
  }
  labels.append(svgText('chart-axis-label chart-axis-label--count chart-axis-title', bars.spec.caption, {
    x: frame.width, y: AXIS_TITLE_Y, 'dominant-baseline': 'middle',
  }));
  svg.append(labels);
}

function appendBars(group, series, points, plot, fillId, chartBars) {
  /* Столбик в четверть шага между точками: столбики фона, а не главный ряд (R-30) */
  const width = Math.max(2, Math.min(7, (plot.width / Math.max(series.length, 1)) * 0.25));
  const bars = svgNode('g', 'chart-bars', filled(fillId));
  series.forEach((bucket, index) => {
    const value = chartBars.spec.value(bucket);
    if (!value) return;
    const height = plot.height - barY(value, chartBars, plot);
    bars.append(svgNode('rect', 'chart-bar', {
      x: points[index].x - width / 2,
      y: plot.height - height,
      width,
      height,
      rx: Math.min(2, width / 2),
    }));
  });
  group.append(bars);
}

function appendPathGroup(group, paths, className, attributes = {}) {
  const layer = svgNode('g', null, attributes);
  for (const path of paths) layer.append(svgNode('path', className, { d: path }));
  group.append(layer);
}

const clipped = (id) => ({ 'clip-path': `url(#${id})` });
const filled = (id) => ({ fill: `url(#${id})` });
const stroked = (id) => ({ stroke: `url(#${id})` });

/* Тон линии меняется плавно по высоте (J-15) — расчёт стопов общий с широкой линией дайджеста, в chart-geometry */
export function zoneStops(top, bottom, height) {
  return planZoneStops(top, bottom, height, ZONE_FADE);
}

/* J-72: у свечения свой градиент той же разметки — в коридоре он прозрачный: светятся только зелёный и красный участки */
function appendZoneGradient(defs, id, plot, top, bottom, modifier = '') {
  const gradient = svgNode('linearGradient', `chart-zones${modifier}`, { id, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: 0, y2: plot.height });
  for (const { offset, zone } of zoneStops(top, bottom, plot.height)) {
    gradient.append(svgNode('stop', `chart-zones__stop chart-zones__stop--${zone}`, { offset }));
  }
  defs.append(gradient);
}

function appendSeries(group, defs, points, plan, domain, ids, plot) {
  const ys = points.filter(({ y }) => y !== null).map(({ y }) => y);
  const [highest, lowest] = [Math.min(...ys), Math.max(...ys)];
  appendPathGroup(group, gapPaths(points), 'chart-line chart-line--gap');
  if (!plan) {
    appendPathGroup(group, linePaths(points), 'chart-line chart-line--default');
    return;
  }

  const top = yPosition(plan.max, domain, plot);
  const bottom = yPosition(plan.min, domain, plot);
  group.append(svgNode('rect', 'chart-plan-band', { x: 0, y: top, width: plot.width, height: bottom - top }));

  appendClip(defs, ids.above, plot, { y: -PLOT_BLEED, height: top + PLOT_BLEED });
  appendClip(defs, ids.below, plot, { y: bottom, height: plot.height - bottom + PLOT_BLEED });
  appendZoneGradient(defs, ids.zones, plot, top, bottom);
  appendZoneGradient(defs, ids.glow, plot, top, bottom, ' chart-zones--glow');
  appendGradient(defs, ids.fillAbove, 'positive', { strong: Math.min(highest, top), clear: top });
  appendGradient(defs, ids.fillBelow, 'negative', { strong: Math.max(lowest, bottom), clear: bottom });

  appendPathGroup(group, areaPaths(points, top), 'chart-area', { ...clipped(ids.above), ...filled(ids.fillAbove) });
  appendPathGroup(group, areaPaths(points, bottom), 'chart-area', { ...clipped(ids.below), ...filled(ids.fillBelow) });
  const lines = linePaths(points);
  appendPathGroup(group, lines, 'chart-line chart-line--glow', stroked(ids.glow));
  appendPathGroup(group, lines, 'chart-line chart-line--zones', stroked(ids.zones));
}

/* J-104: подсказка стоит у оси дат сбоку от точки: справа, а без места — слева; точку и её столбик не закрывает */
/* J-47: вторая строка подсказки говорит, что даст клик: точку можно выбрать, выбранную — снять */
/* J-49: выбор дня меняет только группу аналитики — события и антидрайверы */
export const POINT_HINT = 'Клик покажет события и антидрайверы этой точки';
export const SELECTED_POINT_HINT = 'Клик снимет выбор';

function tooltipLines(bucket, damageMode) {
  if (!damageMode) return [element('span', 'chart-tooltip__value', `${formatInterval(bucket)} · VOC ${formatVoc(bucket.voc)} · ${formatRatings(bucket.count)}`)];
  return [
    element('span', 'chart-tooltip__value', `${formatInterval(bucket)} · Урон ${formatDelta(roundVoc(bucket.damage))} · ${formatRatings(bucket.count)}`),
    element('span', 'chart-tooltip__hint', `С пятёрками в этом интервале VOC периода — ${formatVoc(bucket.vocWithFives)}`),
  ];
}

function showTooltip(tooltip, bucket, point, plot, selected = false, damageMode = false) {
  showChartTooltip(tooltip, {
    content: [...tooltipLines(bucket, damageMode), element('span', 'chart-tooltip__hint', selected ? SELECTED_POINT_HINT : POINT_HINT)],
    x: plot.x + point.x,
    y: plot.y + plot.height,
  });
}

function pointTone(value, plan) {
  if (!plan) return 'default';
  if (value > plan.max) return 'above';
  if (value < plan.min) return 'below';
  return 'in-plan';
}

/* Рамки подписи вокруг точки: над ней, под ней (у точки ниже коридора — сначала под), справа, слева */
function labelBoxes(point, tone, anchor, size) {
  const left = { start: point.x, middle: point.x - size.width / 2, end: point.x - size.width }[anchor];
  const vertical = [
    { x: left, y: point.y - LABEL_OFFSET - size.height, anchor },
    { x: left, y: point.y + LABEL_OFFSET, anchor },
  ];
  if (tone === 'below') vertical.reverse();
  return [
    ...vertical,
    { x: point.x + LABEL_OFFSET, y: point.y - size.height / 2, anchor: 'start' },
    { x: point.x - LABEL_OFFSET - size.width, y: point.y - size.height / 2, anchor: 'end' },
  ].map((box) => ({ ...box, width: size.width, height: size.height }));
}

/* Размер сцены прошлой отрисовки блока: перерисовка на кадре жеста не мерит сцену заново */
const stageSizes = new WeakMap();

/* Рамка подписи зависит только от класса и текста: на кадрах drag подписи те же, getBBox не перестраивает layout */
const labelBoxCache = new Map();
globalThis.document?.fonts?.addEventListener?.('loadingdone', () => labelBoxCache.clear());

function labelBox(node) {
  const key = `${node.getAttribute('class')}|${node.textContent}`;
  const known = labelBoxCache.get(key);
  if (known) return known;
  const { width, height, y } = node.getBBox();
  const box = { width, height, y };
  if (width > 0) labelBoxCache.set(key, box);
  return box;
}

/* Подписи измеряются один раз все вместе: замер каждой позиции по отдельности перестраивал layout на каждой точке */
function placePointLabels(group, series, points, plan, plot) {
  const values = series.map(({ voc }) => voc);
  const finite = values.filter(Number.isFinite);
  const extremes = [Math.min(...finite), Math.max(...finite)];
  const order = labelOrder(values);
  const labels = order.map((index) => {
    const tone = pointTone(values[index], plan);
    const node = svgText(`chart-point-label chart-point-label--${tone}`, formatVoc(values[index]), { 'dominant-baseline': 'middle' });
    group.append(node);
    return { index, tone, node };
  });
  const measured = labels.map(({ node }) => labelBox(node));
  const placed = labels.map(({ index, tone }, at) => {
    const { width, height, y } = measured[at];
    return { boxes: labelBoxes(points[index], tone, edgeAnchor(index, series.length), { width, height }), extreme: extremes.includes(values[index]), middle: y + height / 2 };
  });
  const marks = points.filter(({ y }) => y !== null)
    .map(({ x, y }) => ({ x: x - POINT_RADIUS, y: y - POINT_RADIUS, width: POINT_RADIUS * 2, height: POINT_RADIUS * 2 }));
  const line = curveSamples(points, LINE_SAMPLE);
  const bounds = { x: 0, y: -MARGIN.top, width: plot.width, height: plot.height + MARGIN.top };
  placeLabels(placed, { marks, line, bounds, gap: LABEL_GAP }).forEach((choice, at) => {
    const { node } = labels[at];
    if (choice < 0) {
      node.remove();
      return;
    }
    const box = placed[at].boxes[choice];
    const x = { start: box.x, middle: box.x + box.width / 2, end: box.x + box.width }[box.anchor];
    node.setAttribute('x', x);
    node.setAttribute('y', box.y + box.height / 2 - placed[at].middle);
    node.setAttribute('text-anchor', box.anchor);
  });
}

/* Диапазон дней — самостоятельный выбор для событий, не новый общий период. */
function attachDayBrush(svg, plotGroup, context, series, points, plot, interaction) {
  if (!series.length) return;
  const brush = svgNode('rect', 'chart-day-brush', { y: 0, height: plot.height, visibility: 'hidden' });
  plotGroup.prepend(brush);
  const columns = hitColumns(points, plot.width);
  const indexAt = (event) => {
    const x = event.clientX - svg.getBoundingClientRect().left - plot.x;
    return Math.max(0, Math.min(series.length - 1, Math.round(x / Math.max(1, plot.width) * (series.length - 1))));
  };
  let drag = null;
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const box = svg.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    if (x < plot.x || x > plot.x + plot.width || y < 0 || y > plot.y + plot.height) return;
    event.preventDefault();
    drag = { start: indexAt(event), x: event.clientX, added: event.ctrlKey || event.metaKey };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag || Math.abs(event.clientX - drag.x) < 4) return;
    const index = indexAt(event), left = Math.min(index, drag.start), right = Math.max(index, drag.start);
    brush.setAttribute('x', columns[left].left);
    brush.setAttribute('width', columns[right].right - columns[left].left);
    brush.setAttribute('visibility', 'visible');
    interaction.suppressClick = true;
  });
  svg.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const from = Math.min(drag.start, indexAt(event)), to = Math.max(drag.start, indexAt(event));
    if (interaction.suppressClick) {
      const days = dateRange(series[from].from, series[to].to);
      context.setState({ ...context.state, focus: null, detailEvent: null, days: drag.added ? [...new Set([...selectionDays(context.state), ...days])].sort() : days });
    } else interaction.select?.(from, event);
    drag = null;
    brush.setAttribute('visibility', 'hidden');
  });
  svg.addEventListener('pointercancel', () => { drag = null; interaction.suppressClick = false; brush.setAttribute('visibility', 'hidden'); });
}

/* J-46: выбранный день — полоса во всю высоту под линией: выбор виден издалека, а не только по белой точке */
function selectedColumns(series, points, plot, state) {
  const group = svgNode('g', 'chart-selected-columns', { 'aria-hidden': 'true' });
  const days = selectionDays(state);
  if (!days.length) return group;
  const columns = hitColumns(points, plot.width);
  series.forEach((bucket, index) => {
    if (points[index].y === null || !days.some((day) => day >= bucket.from && day <= bucket.to)) return;
    const { left, right } = columns[index];
    group.append(svgNode('rect', 'chart-selected-column', { x: left, y: 0, width: right - left, height: plot.height }));
  });
  return group;
}

function appendPoints(block, marks, series, points, tooltip, plan, context, plot, interaction, damageMode) {
  const hits = svgNode('g', 'chart-point-hits', { 'aria-hidden': 'true' });
  const group = svgNode('g', 'chart-points');
  /* Мишень — столбец во всю высоту до середины шага к соседям: интервал выбирается наведением на его вертикаль, а не только на кружок */
  const columns = hitColumns(points, plot.width);
  const reveals = new Map();
  const selections = new Map();
  interaction.select = (index, event) => selections.get(index)?.(event);
  series.forEach((bucket, index) => {
    const point = points[index];
    if (point.y === null) return;
    const circle = svgNode('circle', `chart-point chart-point--${pointTone(bucket.voc, plan)}`, {
      cx: point.x,
      cy: point.y,
      r: POINT_RADIUS,
    });
    const { left, right } = columns[index];
    const hit = svgNode('rect', 'chart-point-hit', { x: left, y: -MARGIN.top, width: right - left, height: plot.height + MARGIN.top });
    circle.setAttribute('tabindex', '0');
    circle.setAttribute('role', 'button');
    circle.setAttribute('data-focus-date', bucket.from);
    const selected = selectionDays(context.state).some((day) => day >= bucket.from && day <= bucket.to);
    circle.classList.toggle('is-selected', selected);
    circle.setAttribute('aria-pressed', String(selected));
    circle.setAttribute('aria-label', `${formatInterval(bucket)}: VOC ${formatVoc(bucket.voc)}, ${damageMode ? `урон ${formatDelta(roundVoc(bucket.damage))}, ` : ''}${formatRatings(bucket.count)}`);
    const reveal = () => {
      for (const other of group.querySelectorAll('.is-hovered')) other.classList.remove('is-hovered');
      circle.classList.add('is-hovered');
      showTooltip(tooltip, bucket, point, plot, selected, damageMode);
    };
    /* Подсказка и вертикаль общие: уход мыши возвращает их точке в фокусе (клавиатура или клик), а не гасит */
    const hide = () => {
      circle.classList.remove('is-hovered');
      const focused = reveals.get(document.activeElement);
      if (focused) {
        focused();
        return;
      }
      tooltip.hidden = true;
    };
    reveals.set(circle, reveal);
    const select = (event) => {
      if (interaction.suppressClick) return;
      const days = dateRange(bucket.from, bucket.to);
      const added = event.ctrlKey || event.metaKey;
      const focus = selected ? null : bucket.from;
      context.setState(added
        ? { ...context.state, focus: null, detailEvent: null, days: toggleDays(selectionDays(context.state), days) }
        : { ...context.state, focus, days: [], detailEvent: null });
      block.element.querySelector(`[data-focus-date="${bucket.from}"]`)?.focus();
    };
    selections.set(index, select);
    for (const target of [circle, hit]) {
      target.addEventListener('mouseenter', reveal);
      target.addEventListener('mouseleave', hide);
    }
    circle.addEventListener('focus', reveal);
    circle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      select(event);
    });
    circle.addEventListener('blur', () => {
      circle.classList.remove('is-hovered');
      tooltip.hidden = true;
    });
    hits.append(hit);
    group.append(circle);
  });
  marks.append(hits, group);
}

/*
  Ревью 13.11: переключатель «Средний VOC / Урон» и число оценок — в шапке карточки одной строкой с масштабом и
  действиями, легенда — строкой под ней
*/
function chartMode(block, context) {
  const lead = element('div', 'chart-legend__lead');
  const count = element('span', 'chart-legend__count', `Оценки: ${formatCount(context.slice.length)}`);
  if (!context.analyst) {
    lead.append(count);
    return lead;
  }
  lead.append(segmented({
    label: 'Показатель графика',
    options: MODE_OPTIONS,
    selected: modeOf(context),
    onSelect: (value) => {
      selectedMode = value;
      renderDynamics(block, context);
    },
  }), count);
  return lead;
}

function chartLegend(context, { plan, hasPrevious, previous }) {
  const compared = comparedPeriod(context.previousPeriod, context.rows);
  const legend = element('div', 'chart-legend');
  /* J-85: прошлый период шире неполного текущего, на графике видна только его часть — её и подписываем */
  const shownTo = [previous.at(-1)?.to ?? compared.to, compared.to].sort()[0];
  legend.append(legendList(modeOf(context) === MODE_DAMAGE
    ? [legendItem(DAMAGE_CAPTION, 'negative', 'bar'), legendItem('VOC', 'neutral', 'line')]
    : [
      plan ? legendItem('VOC', null, 'zones') : legendItem('VOC', 'neutral', 'line'),
      plan && legendItem('План', 'plan', 'band'),
      /* J-37: даты прошлого периода в скобках — иначе их не пересчитать в голове */
      hasPrevious && legendItem(`Прошлый период (${formatDayRange(compared.from, shownTo)})`, 'neutral', 'dash'),
    ].filter(Boolean)));
  return legend;
}

function chartModel(context, scale, plan) {
  const current = shownSeries(context.slice, context.period, scale);
  /* J-85: сравнение карточек идёт с полным прошлым периодом, а на графике интервалы идут встык: лишний хвост сжал бы ось времени */
  const previous = shownSeries(context.previousSlice, context.previousPeriod, scale).slice(0, current.length);
  const shownPlan = plan ? { ...plan, min: roundVoc(plan.min), max: roundVoc(plan.max) } : null;
  return {
    current,
    previous,
    hasPrevious: previous.some(({ voc }) => voc !== null),
    plan: shownPlan,
    domain: chartDomain(current, previous, shownPlan),
  };
}

/* J-86: в режиме урона столбики вместо оценок, поверх — серая линия VOC без плана и прошлого периода */
function chartBars(current, damageMode) {
  const spec = damageMode ? DAMAGE_BARS : COUNT_BARS;
  const peak = Math.max(0, ...current.map(spec.value));
  if (peak <= 0) return null;
  return { spec, axis: damageMode ? damageAxis(peak) : countAxis(peak) };
}

function drawChart(block, context, stage, tooltip, model, size) {
  const damageMode = modeOf(context) === MODE_DAMAGE;
  const { current, previous } = model;
  const bars = chartBars(current, damageMode);
  const frame = frameFor(size, bars);
  const { plot } = frame;
  const plan = damageMode ? null : model.plan;
  const hasPrevious = !damageMode && model.hasPrevious;
  const domain = damageMode ? chartDomain(current, [], null) : model.domain;
  const currentPoints = plotPoints(current, { width: plot.width, height: plot.height, ...domain });
  const previousPoints = plotPoints(previous, { width: plot.width, height: plot.height, ...domain });

  const svg = svgNode('svg', 'chart-svg', {
    width: frame.width,
    height: frame.height,
    viewBox: `0 0 ${frame.width} ${frame.height}`,
    role: 'group',
    'aria-label': `Динамика VOC за ${formatDateRange(context.period.from, context.period.to)}`,
  });
  svg.append(svgNode('title', null));
  svg.firstChild.textContent = 'Динамика VOC, план, предыдущий период и количество оценок';
  const dated = xLabelIndices(plot.width, current.length, DATE_LABEL_WIDTH);
  appendGrid(svg, domain, plot, dated.map((index) => currentPoints[index].x));
  appendXAxis(svg, current, currentPoints, frame, dated);
  if (bars) appendBarsAxis(svg, bars, frame);

  const defs = svgNode('defs');
  const prefix = `dynamics-${chartSequence += 1}`;
  const ids = Object.fromEntries(['series', 'marks', 'above', 'below', 'zones', 'glow', 'fillAbove', 'fillBelow', 'volume'].map((name) => [name, `${prefix}-${name}`]));
  const bled = { y: -PLOT_BLEED, height: plot.height + PLOT_BLEED * 2 };
  appendClip(defs, ids.series, plot, bled);
  appendClip(defs, ids.marks, plot, { y: -MARGIN.top, height: plot.height + MARGIN.top + PLOT_BLEED, sideBleed: PLOT_BLEED });
  const plotGroup = svgNode('g', 'chart-plot', { transform: `translate(${plot.x} ${plot.y})` });
  const series = svgNode('g', 'chart-series', { 'clip-path': `url(#${ids.series})` });
  const marks = svgNode('g', 'chart-marks', { 'clip-path': `url(#${ids.marks})` });
  if (bars) {
    appendBarGradient(defs, ids.volume, bars.spec.tone);
    appendBars(series, current, currentPoints, plot, ids.volume, bars);
  }
  if (hasPrevious) appendPathGroup(series, linePaths(previousPoints), 'chart-line chart-line--previous');
  appendSeries(series, defs, currentPoints, plan, domain, ids, plot);
  const labels = svgNode('g', 'chart-point-labels', { 'aria-hidden': 'true' });
  marks.append(labels);
  const interaction = { suppressClick: false };
  appendPoints(block, marks, current, currentPoints, tooltip, plan, context, plot, interaction, damageMode);
  plotGroup.append(selectedColumns(current, currentPoints, plot, context.state), series, marks);
  attachDayBrush(svg, plotGroup, context, current, currentPoints, plot, interaction);
  svg.append(defs, plotGroup);

  /* Перерисовка по размеру сцены не сбрасывает фокус с точки, а подсказка не остаётся у её старого места */
  const focused = stage.contains(document.activeElement) ? document.activeElement.getAttribute('data-focus-date') : null;
  tooltip.hidden = true;
  stage.querySelector('.chart-svg')?.remove();
  stage.prepend(svg);
  placePointLabels(labels, current, currentPoints, plan, plot);
  if (focused) svg.querySelector(`[data-focus-date="${focused}"]`)?.focus();
}

function renderChart(block, context, scale, plan) {
  const model = chartModel(context, scale, plan);
  const chart = element('div', modeOf(context) === MODE_DAMAGE ? 'chart chart--damage' : 'chart');
  chart.append(chartLegend(context, model));
  const stage = element('div', 'chart-stage');
  /* Урон с пятёрками и подсказку клика знает только подсказка: диктор читает её, а не одно имя точки */
  const tooltip = chartTooltip({ spoken: true });
  stage.append(tooltip);
  if (context.slice.length) chart.append(stage);
  /* Строка пояснения с полями абзаца, без role=status: перерисовка графика не объявляет её заново */
  else chart.append(stateText('detail', 'Нет оценок за выбранный период графика. Выберите другой период на таймлайне.'));
  /* Протягивание таймлайна показывает даты в выборе периода — в шапке группы, если период общий (J-40) */
  const timeline = chartTimeline(context, { owner: block, onPreview: (range) => (context.previewPeriod ?? block.previewPeriod)?.(range) });
  chart.append(timeline.node);
  return { chart, model, mode: chartMode(block, context), draw: () => {
    if (context.slice.length) observeStage(stage, (size) => {
      stageSizes.set(block, size);
      drawChart(block, context, stage, tooltip, model, size);
    }, stageSizes.get(block));
    timeline.draw();
  } };
}

export function renderDynamics(block, context) {
  /* Ревью 13.11: над графиком уже заголовок группы «Динамика, события и антидрайверы» — своё название видно только развёрнутым */
  block.setTitle('Динамика VOC', undefined, { hidden: !block.isExpanded() });
  /* J-40: общий период блока аналитики выбирается в шапке группы, а не графика */
  /* Развёрнутая карточка закрывает шапку группы: общий период тогда подписан в своей шапке, без выбора */
  const period = context.periodControl?.shared
    ? (block.isExpanded() ? { ...context.period } : null)
    : { ...context.period, ...(context.periodControl ? { picker: context.periodControl } : {}) };
  const scale = scaleFor(context.period, context.analyst);
  const plan = planFor(context.reference?.plan, {
    channel: context.state.channel,
    from: context.period.from,
    to: context.period.to,
  });
  const { chart, draw, model, mode } = renderChart(block, context, scale, plan);
  const download = downloadAction(() => exportFileName('Динамика VOC', context), () => dynamicsSheets(context, model, scale));
  block.setHead({ ...(period ? { period } : {}), controls: [mode, chartScaleTabs(block, context, scale)], actions: [expandAction(block, context), download] });
  block.setContent(chart);
  draw();
}
