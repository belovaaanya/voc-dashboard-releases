import { chartTimeline } from '../components/chart-timeline.js';
import { chartTooltip, showChartTooltip } from '../components/chart-tooltip.js';
import { observeStage } from '../components/stage-observer.js';
import { dateRange, selectionDays, toggleDays } from '../state/chart-selection.js';
import { areaPaths, chartDomain, planZoneStops, countAxis, curveSamples, damageAxis, gapPaths, hitColumns, labelOrder, linePaths, placeCards, placeLabels, plotPoints, xLabelIndices } from '../core/chart-geometry.js';
import { legendItem, legendList } from '../components/legend.js';
import { segmented } from '../components/segmented.js';
import { periodScaleMemory, scaleTabs } from '../components/scale-tabs.js';
import { stateText } from '../components/status-panel.js';
import { statusDot } from '../components/status-dot.js';
import { tag } from '../components/tag.js';
import { eventText } from './insights.js';
import { accidentColor } from '../core/incident-events.js';
import { element, svgNode } from '../ui/dom.js';
import { formatCount, formatDate, formatDateRange, formatDayRange, formatDelta, formatInterval, formatNumber, formatRatings, formatVoc } from '../core/format.js';
import { comparedPeriod } from '../core/period.js';
import { dynamicsSheets, exportFileName } from '../core/export.js';
import { downloadAction } from '../ui/download.js';
import { planFor } from '../core/plan.js';
import { roundDelta, roundVoc } from '../core/round.js';
import { SCALE_OPTIONS, buildTimeSeries, recommendedScale, withDamage } from '../core/timeseries.js';
import { ANOMALY_EVENT, EVENT_LANES, INCIDENT_EVENT, ROLLOUT_EVENT, SUSTAINED_EVENT, eventLanes, majorEvents } from '../core/calendar.js';
import { calendarEventsOf, calendarReady } from '../state/event-analysis.js';

/* График рисуется в пикселях сцены, а не в растянутом viewBox: иначе на узкой странице текст мельче роли (B-17) */
/* Сверху — место под подпись значения у точки на верхней границе шкалы (B-03) */
const MARGIN = { top: 26, right: 12, bottom: 28, left: 44 };
/* Ревью 13.11: названия осей — над шкалами, слева и справа на одной линии, с теми же краями, что их цифры */
const AXIS_TITLE_Y = 8;
/* Неделя 16–22.11: точка мельче — линия не теряется среди точек; мишень мыши — столбец интервала, он прежний */
const POINT_RADIUS = 2;
/* Запас клипа под точку при наведении (3,5 + кольцо 3) и выбранную (5 + обводка); ряды по x обрезаны точно (B-02, V-05) */
const PLOT_BLEED = 7;
/* Переход тона линии — по центру границы коридора (J-15): точка у границы не стоит на сером участке */
const ZONE_FADE = 16;
const LABEL_OFFSET = POINT_RADIUS + 5;
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

/*
  Полоса событий под осью дат (неделя 16–22.11, только «Для аналитика»): строка на тип, точка — в интервале графика
  на той же оси X. Высота строки — 10, точка растёт с числом событий интервала
*/
const LANE_HEIGHT = 10;
const LANE_GAP = 4;
const laneRadius = (count) => (count >= 4 ? 4 : count >= 2 ? 3 : 2);
const stripHeight = (lanes) => (lanes.length ? LANE_GAP + lanes.length * LANE_HEIGHT : 0);

function frameFor({ width, height }, bars, strip = 0, cards = 0) {
  const right = bars ? barsAxisWidth(bars) : MARGIN.right;
  return {
    width,
    height,
    strip,
    cards,
    plot: { x: MARGIN.left, y: MARGIN.top + cards, width: width - MARGIN.left - right, height: height - MARGIN.top - MARGIN.bottom - strip - cards },
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
  svg.append(svgText('chart-axis-label chart-axis-label--y chart-axis-title', 'VOC', { x: 0, y: plot.y - MARGIN.top + AXIS_TITLE_Y, 'dominant-baseline': 'middle' }));
  for (const x of xs) grid.append(svgNode('line', 'chart-grid__minor', { x1: x, y1: 0, x2: x, y2: plot.height }));
  svg.append(grid);
}

const edgeAnchor = (index, length) => (index === 0 ? 'start' : index === length - 1 ? 'end' : 'middle');

function appendXAxis(svg, series, points, frame, indices) {
  const labels = svgNode('g', 'chart-axis chart-axis--x', { transform: `translate(${frame.plot.x} 0)` });
  for (const index of indices) {
    labels.append(svgText('chart-axis-label', formatDate(series[index].from), {
      x: points[index].x,
      y: frame.plot.y + frame.plot.height + MARGIN.bottom - 4,
      'text-anchor': edgeAnchor(index, series.length),
    }));
  }
  svg.append(labels);
}

/* Столбик объёма гаснет к оси (R-12): градиент в долях своего столбика, поэтому один на все */
/*
  Строка на тип в порядке `EVENT_LANES`; точка — в интервале, где есть события этого типа, крупнее при 2–3 и при
  4+ событиях. Наведение — подсказка «дата · тип · число», клик — как клик по точке графика: события и антидрайверы
  этого интервала. Мишень — столбец интервала во всю высоту строки
*/
/*
  Карточки крупных событий (неделя 16–22.11, «Для аналитика»): плашка подсказки графика на тонкой пунктирной ножке
  к своей дате на оси. Внутри одной строкой — строка ленты «Календаря событий» в сжатом виде: иконка типа, дата,
  тег типа и VOC справа — те же тексты (`eventText`) и тот же тег. Высота — как у `.chart-card` в стилях; ширина — по
  тексту, её меряет отрисовка до раскладки (`placeCards`), `CARD.width` — запас, если померить нельзя
*/
const CARD = { width: 240, height: 24 };
/*
  Карточки — в своей полосе над областью графика (над подписями точек): при ежедневном масштабе линия VOC проходит
  почти по всей высоте, и внутри области карточка неизбежно легла бы на линию. Ножки идут вниз к дате на оси
*/
const CARD_GAP = 4;
/* Неделя 16–22.11: от верха сцены — 8, а не 4: под строкой легенды карточкам тесно (легенда → карточка — 16) */
const CARD_TOP = CARD_GAP * 2;
const CARD_ZONE = CARD_TOP + CARD.height + CARD_GAP;
const CARD_LIMIT = 5;
/* Кандидатов меряется с запасом: крупная карточка может не встать, и место займёт следующая */
const CARD_MEASURED = CARD_LIMIT * 3;
const CARD_LABELS = { [INCIDENT_EVENT]: 'Авария', [ANOMALY_EVENT]: 'Крит. снижение', [SUSTAINED_EVENT]: 'Инцидент' };
/* Иконка — та же, что у типа в календаре событий и в полосе (J-269) */
const CARD_TONES = Object.fromEntries(EVENT_LANES.map(({ kind, tone }) => [kind, tone]));

/*
  Число карточки — отклонение события, а не VOC разреза (J-286): «VOC 4,30» над графиком канала читается как VOC канала.
  У снижения — падение VOC серии к средней окна («к норме»), у инцидента — к нижней границе плана, у аварии — доля
  затронутых. VOC разреза и его оценки — в подсказке
*/
const CARD_NUMBER_SUFFIX = { [INCIDENT_EVENT]: 'затронуто', [ANOMALY_EVENT]: 'к норме', [SUSTAINED_EVENT]: 'к плану' };
const CARD_NUMBER_HINT = { [INCIDENT_EVENT]: 'затронуто', [ANOMALY_EVENT]: 'VOC к средней окна', [SUSTAINED_EVENT]: 'к нижней границе плана' };

/* Доля аварии в источнике шагом 10 %: 0 — «<10 %», пусто — доля не указана (как в ленте) */
function cardNumber({ event, gap }) {
  if (event.kind !== INCIDENT_EVENT) return formatDelta(roundDelta(-gap));
  if (gap === null || gap === undefined) return 'доля не указана';
  if (gap === 0) return '<10\u00a0%';
  return `${formatNumber(gap * 100, 0)}\u00a0%`;
}

/* Строки подсказки: разрез события с его VOC и оценками, затем вклад в VOC канала — по нему выбраны карточки */
function cardDetails(candidate, text) {
  const { event, impact, ratings, voc } = candidate;
  const lead = text.detail.split(' · ')[0];
  const subject = event.kind === INCIDENT_EVENT
    ? lead
    : [lead, `VOC ${formatVoc(roundVoc(voc))}`, formatRatings(ratings)].join(' · ');
  return [subject, `Вклад в VOC канала: ${formatDelta(roundDelta(-impact))}`];
}

/* Строка ленты календаря в одну строку: иконка, дата, тег типа, VOC — те же части, что у `insight-row` */
function eventCard(event, tone, text, label, number, date) {
  const suffix = number === 'доля не указана' ? '' : CARD_NUMBER_SUFFIX[event.kind];
  const card = element('button', 'chart-card glass');
  card.type = 'button';
  if (event.kind === INCIDENT_EVENT) card.style.setProperty('--accident-tone', accidentColor(event.effect, event.duration_seconds));
  card.setAttribute('aria-label', `${date}. ${label}: ${number} ${CARD_NUMBER_HINT[event.kind]}. ${POINT_HINT}`);
  /* Дата — день события на оси (ДД.ММ), а не диапазон серии ленты: длительность серии уже в теге («Инцидент 6 дн»),
     а узкая карточка оставляет место соседним */
  card.append(statusDot(tone, 'event'), element('span', 'chart-card__date', date.slice(0, 5)), tag(text.title, text.color));
  card.append(element('span', 'chart-card__value', suffix ? `${number} ${suffix}` : number));
  return card;
}

function appendEventCards(stage, svg, candidates, series, points, plot, tooltip, interaction, context) {
  for (const old of stage.querySelectorAll('.chart-card')) old.remove();
  if (!candidates.length) return;
  /* Карточки ставятся в сцену невидимыми и меряются: ширина зависит от типа, числа и шрифта */
  const drafts = candidates.slice(0, CARD_MEASURED).map((candidate) => {
    const { event } = candidate;
    const feed = eventText(event, context);
    const text = { tone: CARD_TONES[event.kind], label: CARD_LABELS[event.kind], number: cardNumber(candidate), date: formatDate(event.date) };
    const card = eventCard(event, text.tone, feed, text.label, text.number, text.date);
    card.style.visibility = 'hidden';
    stage.append(card);
    return { ...candidate, ...text, details: cardDetails(candidate, feed), card, width: Math.ceil(card.offsetWidth || CARD.width) };
  });
  /* Один ряд над подписями точек: в координатах области — выше её верха на поле подписей и саму полосу */
  const placed = placeCards(drafts, {
    xs: points.map(({ x }) => x), line: [], width: plot.width, card: CARD, gap: CARD_GAP, limit: CARD_LIMIT,
    rows: [-(MARGIN.top + CARD_ZONE) + CARD_TOP],
  });
  const kept = new Set(placed.map(({ card }) => card));
  for (const { card } of drafts) if (!kept.has(card)) card.remove();
  const stems = svgNode('g', 'chart-cards', { 'aria-hidden': 'true', transform: `translate(${plot.x} ${plot.y})` });
  for (const { event, index, center, rect, label, number, date, card, details } of placed) {
    /* Ножка — нейтральный пунктир, как направляющие сетки: от края карточки к оси дат под областью графика */
    stems.append(svgNode('line', 'chart-cards__stem', { x1: center, y1: rect.y + rect.height, x2: center, y2: plot.height }));
    card.style.left = `${plot.x + rect.x}px`;
    card.style.top = `${plot.y + rect.y}px`;
    card.style.visibility = '';
    const bucket = series[index];
    /* Подсказка — у оси дат, как у точки графика: над карточкой ей не хватит места в сцене, и она закрыла бы карточку */
    const reveal = () => showChartTooltip(tooltip, {
      content: [element('span', 'chart-tooltip__value', `${date} · ${label} · ${number} ${CARD_NUMBER_HINT[event.kind]}`),
        ...details.map((line) => element('span', 'chart-tooltip__value', line)),
        element('span', 'chart-tooltip__hint', POINT_HINT)],
      x: plot.x + center,
      y: plot.y + plot.height,
    });
    const conceal = () => { tooltip.hidden = true; };
    card.addEventListener('pointerenter', reveal);
    card.addEventListener('focus', reveal);
    card.addEventListener('pointerleave', conceal);
    card.addEventListener('blur', conceal);
    card.dataset.focusCard = `${event.kind}:${event.date}`;
    card.addEventListener('click', (click) => {
      const id = card.dataset.focusCard;
      if (interaction.select && points[index]?.y !== null) interaction.select(index, click);
      else context.setState({ ...context.state, focus: null, days: dateRange(bucket.from, bucket.to), detailEvent: null });
      /* Клик перерисовывает график: фокус возвращается на ту же карточку новой отрисовки */
      stage.closest('.card')?.querySelector(`[data-focus-card="${id}"]`)?.focus({ preventScroll: true });
    });
  }
  svg.append(stems);
}

function appendEventStrip(svg, lanes, series, points, frame, tooltip, interaction, context) {
  const { plot } = frame;
  const top = plot.y + plot.height + MARGIN.bottom + LANE_GAP;
  const strip = svgNode('g', 'chart-events', { transform: `translate(${plot.x} ${top})`, 'aria-hidden': 'true' });
  const columns = hitColumns(points, plot.width);
  lanes.forEach((lane, row) => {
    const y = row * LANE_HEIGHT + LANE_HEIGHT / 2;
    /* Раскатка подписана каналом, как чип календаря («Раскатка НИБ») */
    const label = lane.kind === ROLLOUT_EVENT && context.state.channel ? `${lane.label} ${context.state.channel}` : lane.label;
    strip.append(svgNode('line', 'chart-events__rail', { x1: 0, y1: y, x2: plot.width, y2: y }));
    for (const { index, count } of lane.cells) {
      const bucket = series[index];
      const x = points[index].x;
      const dot = svgNode('circle', `chart-events__mark tone--${lane.tone}`, { cx: x, cy: y, r: laneRadius(count) });
      const { left, right } = columns[index];
      const hit = svgNode('rect', 'chart-events__hit', { x: left, y: row * LANE_HEIGHT, width: right - left, height: LANE_HEIGHT });
      const when = bucket.from === bucket.to ? formatDate(bucket.from) : formatInterval(bucket);
      hit.addEventListener('pointerenter', () => {
        dot.classList.add('is-hovered');
        showChartTooltip(tooltip, {
          content: [element('span', 'chart-tooltip__value', `${when} · ${label} · ${formatCount(count)}`),
            element('span', 'chart-tooltip__hint', POINT_HINT)],
          x: plot.x + x,
          y: top + y,
        });
      });
      hit.addEventListener('pointerleave', () => {
        dot.classList.remove('is-hovered');
        tooltip.hidden = true;
      });
      /* Клик — как по точке графика; у интервала без оценок точки нет — тогда выбирается сам день */
      hit.addEventListener('click', (event) => {
        if (interaction.select && points[index].y !== null) interaction.select(index, event);
        else context.setState({ ...context.state, focus: null, days: dateRange(bucket.from, bucket.to), detailEvent: null });
      });
      strip.append(dot, hit);
    }
  });
  svg.append(strip);
}

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
    x: frame.width, y: plot.y - MARGIN.top + AXIS_TITLE_Y, 'dominant-baseline': 'middle',
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
/* Последний контекст отрисовки блока: ожидание событий календаря перерисует график, только если он ещё актуален */
const lastContexts = new WeakMap();
/* Сколько кадров ждать событий календаря: он рисуется следующим кадром, после жеста — по отпусканию */
const CALENDAR_WAIT_FRAMES = 120;

function awaitCalendar(block, context, frames = CALENDAR_WAIT_FRAMES) {
  requestAnimationFrame(() => {
    if (lastContexts.get(block) !== context) return;
    if (calendarReady(context)) renderDynamics(block, context);
    else if (frames > 1) awaitCalendar(block, context, frames - 1);
  });
}

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

/*
  Неделя 16–22.11: выбранная и последняя точки — светящийся круг, как иконка типа события (J-269): тёмная сердцевина
  сверху, яркий тон к краю и свечение тона. Градиент — свой на тон в defs графика, цвет — у классов в стилях
*/
const POINT_MARK_TONES = { above: 'positive', below: 'negative', 'in-plan': 'neutral', default: 'neutral' };

function appendMarkGradients(defs, prefix) {
  for (const tone of ['positive', 'negative', 'neutral']) {
    const gradient = svgNode('radialGradient', `chart-mark chart-mark--${tone}`, { id: `${prefix}-mark-${tone}`, cx: 0.5, cy: 0.5, r: 0.5, fx: 0.5, fy: 0.3 });
    gradient.append(svgNode('stop', 'chart-mark__core', { offset: 0 }), svgNode('stop', 'chart-mark__tone', { offset: 0.6 }),
      svgNode('stop', 'chart-mark__rim', { offset: 1 }));
    defs.append(gradient);
  }
}

function markPoint(circle, prefix, tone) {
  circle.classList.add('is-mark', `chart-point--mark-${tone}`);
  circle.style.fill = `url(#${prefix}-mark-${tone})`;
}

const lastIndex = (points) => points.reduce((found, { y }, index) => (y === null ? found : index), -1);

/* Урон — гладкая красная линия со свечением и заливкой, гаснущей к оси, по шкале урона справа (как столбики раньше) */
function appendDamageLine(group, defs, points, plot, ids) {
  const ys = points.filter(({ y }) => y !== null).map(({ y }) => y);
  if (!ys.length) return;
  appendGradient(defs, ids.damage, 'damage-area', { strong: Math.min(...ys), clear: plot.height });
  appendPathGroup(group, areaPaths(points, plot.height), 'chart-area', filled(ids.damage));
  const lines = linePaths(points);
  appendPathGroup(group, lines, 'chart-line chart-line--glow chart-line--damage');
  appendPathGroup(group, lines, 'chart-line chart-line--damage');
}

/* Последняя и выбранные точки урона — красный светящийся круг на его линии; мишени и подсказка — у точек VOC */
function appendDamageMarks(marks, series, points, state, prefix) {
  const days = selectionDays(state);
  const last = lastIndex(points);
  const group = svgNode('g', 'chart-damage-marks', { 'aria-hidden': 'true' });
  series.forEach((bucket, index) => {
    const point = points[index];
    if (point.y === null) return;
    const selected = days.some((day) => day >= bucket.from && day <= bucket.to);
    if (!selected && index !== last) return;
    const circle = svgNode('circle', 'chart-point chart-point--below', { cx: point.x, cy: point.y, r: POINT_RADIUS });
    circle.classList.toggle('is-selected', selected);
    markPoint(circle, prefix, 'negative');
    group.append(circle);
  });
  marks.append(group);
}

function appendPoints(block, marks, series, points, tooltip, plan, context, plot, interaction, damageMode, prefix) {
  const last = lastIndex(points);
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
    /* Выбранная и последняя точки — светящийся круг цвета точки, как иконка типа события (J-269); в уроне — на его линии */
    if (!damageMode && (selected || index === last)) markPoint(circle, prefix, POINT_MARK_TONES[pointTone(bucket.voc, plan)]);
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
  /* Неделя 16–22.11: прошлый период — только в «Для аналитика»; на главной график без пунктира и его подписи */
  const shownPrevious = hasPrevious && context.analyst;
  const compared = comparedPeriod(context.previousPeriod, context.rows);
  const legend = element('div', 'chart-legend');
  /* J-85: прошлый период шире неполного текущего, на графике видна только его часть — её и подписываем */
  const shownTo = [previous.at(-1)?.to ?? compared.to, compared.to].sort()[0];
  legend.append(legendList(modeOf(context) === MODE_DAMAGE
    ? [legendItem(DAMAGE_CAPTION, 'negative', 'line'), legendItem('VOC', 'neutral', 'line')]
    : [
      plan ? legendItem('VOC', null, 'zones') : legendItem('VOC', 'neutral', 'line'),
      plan && legendItem('План', 'plan', 'band'),
      /* J-37: даты прошлого периода в скобках — иначе их не пересчитать в голове */
      shownPrevious && legendItem(`Прошлый период (${formatDayRange(compared.from, shownTo)})`, 'neutral', 'dash'),
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
    /* Неделя 16–22.11: прошлый период рисуется только в «Для аналитика» — на главной он не растягивает шкалу; выгрузка его сохраняет */
    domain: chartDomain(current, context.analyst ? previous : [], shownPlan),
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
  const { current, previous, lanes } = model;
  const bars = chartBars(current, damageMode);
  const frame = frameFor(size, bars, stripHeight(lanes), model.cards.length ? CARD_ZONE : 0);
  const { plot } = frame;
  const plan = damageMode ? null : model.plan;
  /* Неделя 16–22.11: пунктир прошлого периода — только в «Для аналитика» */
  const hasPrevious = !damageMode && model.hasPrevious && context.analyst;
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
  /*
    Неделя 16–22.11: описание графика — `desc`, а не `title`: системная подсказка `title` всплывала поверх нашей
    «Клик покажет события и антидрайверы этой точки». Screen reader читает `desc` так же
  */
  svg.append(svgNode('desc', null));
  svg.firstChild.textContent = hasPrevious ? 'Динамика VOC, план, предыдущий период и количество оценок' : 'Динамика VOC, план и количество оценок';
  const dated = xLabelIndices(plot.width, current.length, DATE_LABEL_WIDTH);
  appendGrid(svg, domain, plot, dated.map((index) => currentPoints[index].x));
  appendXAxis(svg, current, currentPoints, frame, dated);
  if (bars) appendBarsAxis(svg, bars, frame);

  const defs = svgNode('defs');
  const prefix = `dynamics-${chartSequence += 1}`;
  const ids = Object.fromEntries(['series', 'marks', 'above', 'below', 'zones', 'glow', 'fillAbove', 'fillBelow', 'volume', 'damage']
    .map((name) => [name, `${prefix}-${name}`]));
  appendMarkGradients(defs, prefix);
  const bled = { y: -PLOT_BLEED, height: plot.height + PLOT_BLEED * 2 };
  appendClip(defs, ids.series, plot, bled);
  appendClip(defs, ids.marks, plot, { y: -MARGIN.top, height: plot.height + MARGIN.top + PLOT_BLEED, sideBleed: PLOT_BLEED });
  const plotGroup = svgNode('g', 'chart-plot', { transform: `translate(${plot.x} ${plot.y})` });
  const series = svgNode('g', 'chart-series', { 'clip-path': `url(#${ids.series})` });
  const marks = svgNode('g', 'chart-marks', { 'clip-path': `url(#${ids.marks})` });
  const damagePoints = damageMode && bars ? current.map((bucket, index) => ({
    x: currentPoints[index].x, y: bucket.damage === null ? null : barY(bars.spec.value(bucket), bars, plot),
  })) : null;
  if (damagePoints) appendDamageLine(series, defs, damagePoints, plot, ids);
  else if (bars) {
    appendBarGradient(defs, ids.volume, bars.spec.tone);
    appendBars(series, current, currentPoints, plot, ids.volume, bars);
  }
  if (hasPrevious) appendPathGroup(series, linePaths(previousPoints), 'chart-line chart-line--previous');
  appendSeries(series, defs, currentPoints, plan, domain, ids, plot);
  const labels = svgNode('g', 'chart-point-labels', { 'aria-hidden': 'true' });
  marks.append(labels);
  const interaction = { suppressClick: false };
  appendPoints(block, marks, current, currentPoints, tooltip, plan, context, plot, interaction, damageMode, prefix);
  if (damagePoints) appendDamageMarks(marks, current, damagePoints, context.state, prefix);
  plotGroup.append(selectedColumns(current, currentPoints, plot, context.state), series, marks);
  attachDayBrush(svg, plotGroup, context, current, currentPoints, plot, interaction);
  svg.append(defs, plotGroup);
  if (lanes.length) appendEventStrip(svg, lanes, current, currentPoints, frame, tooltip, interaction, context);

  /* Перерисовка по размеру сцены не сбрасывает фокус с точки, а подсказка не остаётся у её старого места */
  const focused = stage.contains(document.activeElement) ? document.activeElement.getAttribute('data-focus-date') : null;
  tooltip.hidden = true;
  stage.querySelector('.chart-svg')?.remove();
  stage.prepend(svg);
  placePointLabels(labels, current, currentPoints, plan, plot);
  appendEventCards(stage, svg, model.cards, current, currentPoints, plot, tooltip, interaction, context);
  if (focused) svg.querySelector(`[data-focus-date="${focused}"]`)?.focus();
}

function renderChart(block, context, scale, plan) {
  /* Полоса событий — только в разделе «Для аналитика» (J-228): на главной график без неё */
  const base = chartModel(context, scale, plan);
  /*
    События считает календарь — отложенно и не на кадрах жеста таймлайна (`ready: calendarReady`). Полоса берёт их
    только готовыми из общего кэша, а пока их нет — график рисуется без неё и перерисовывается, когда календарь досчитал
  */
  const wanted = context.analyst && context.slice.length > 0;
  const ready = wanted && calendarReady(context);
  if (wanted && !ready) awaitCalendar(block, context);
  const events = ready ? calendarEventsOf(context) : [];
  const model = { ...base, lanes: ready ? eventLanes(events, base.current) : [], cards: majorEvents(events, base.current, context.slice) };
  const chart = element('div', modeOf(context) === MODE_DAMAGE ? 'chart chart--damage' : 'chart');
  chart.append(chartLegend(context, model));
  const stage = element('div', 'chart-stage');
  /* Сцена выше на полосу событий: область графика не сжимается */
  /* Сцена выше на полосу событий и полосу карточек: область графика не сжимается */
  const extra = stripHeight(model.lanes) + (model.cards.length ? CARD_ZONE : 0);
  if (extra) stage.style.setProperty('--chart-events-height', `${extra}px`);
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
  lastContexts.set(block, context);
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
