import { EMPTY } from '../shell/block.js';
import { antidriverSheets, exportFileName } from '../core/export.js';
import { downloadAction } from '../ui/download.js';
import {
  buildHeatmap,
  HIGHLIGHT_DAMAGE,
  HIGHLIGHT_INFLUENCE,
  HIGHLIGHT_PLAN,
  highlightFor,
  highlightHeatmap,
  highlightModes,
  isBlankCell,
  frequentElements,
  offersVersions,
  splitVersionKey,
  versionRowKey,
  VERSION_CUT,
  versionOsChoices,
} from '../core/antidrivers.js';
import { normalizeDriver } from '../state/driver-pick.js';
import { legendItem, legendList } from '../components/legend.js';
import { hoverTooltip } from '../components/hover-tooltip.js';
import { icon } from '../ui/icons.js';
import { DIMENSIONS, osName } from '../core/dimensions.js';
import { element, withOverflowTitle } from '../ui/dom.js';
import { bindShortWords, formatCount, formatDate, formatDelta, formatInterval, formatImpact, formatNumber, formatShare, formatVoc, plural } from '../core/format.js';
import { focusChip } from '../components/focus-chip.js';
import { focusedContext } from '../state/focus.js';
import { withFilter } from '../state/url-state.js';
import { planFor } from '../core/plan.js';
import { roundDelta, roundImpact, roundShare } from '../core/round.js';
import { segmented } from '../components/segmented.js';
import { pagingButtons } from '../components/paging.js';
import { periodScaleMemory, scaleTabs } from '../components/scale-tabs.js';
import { statusPanel } from '../components/status-panel.js';
import { recommendedScale, SCALE_OPTIONS } from '../core/timeseries.js';
import { dayCount } from '../core/dates.js';

/* J-31: дирекция скрыта. J-128: `ДКО` переехал в «Топ проблем» — у всех разрезов одни режимы «План» и «Урон» */
const DIMENSION_KEYS = ['trigger', 'product'];

let selectedAntidriverDimension = DIMENSION_KEYS[0];
let selectedHeatmapHighlight = HIGHLIGHT_PLAN;
/* Ручной масштаб — для периода блока, в котором его выбрали; выбранный день его не сбрасывает */
const heatmapScales = periodScaleMemory();
function heatmapScale(blockPeriod, viewPeriod) {
  const recommended = recommendedScale(viewPeriod);
  return heatmapScales.scaleFor(blockPeriod, recommended === 'quarter' ? 'month' : recommended);
}
const SCALE_CHOICES = SCALE_OPTIONS.filter(({ value }) => value !== 'quarter');

const PAGE_SIZE = 10;
const pagination = new WeakMap();

/*
  J-68: ширина колонки подписей тянется ручкой и живёт, пока открыта страница;
  между визитами — в localStorage как удобство зрителя (без него — ширина по умолчанию).
  Хранится желаемая ширина; показывается она с поправкой на текущую ширину карты
*/
const TITLE_WIDTH_KEY = 'voc.antidrivers.titleWidth';
export const TITLE_WIDTH_MIN = 160;
export const TITLE_WIDTH_MAX = 480;
const TITLE_WIDTH_STEP = 16;
const TITLE_WIDTH_SLACK = 2;
const TITLE_DRAG_THRESHOLD = 3;
let titleWidth = readTitleWidth();

function readTitleWidth() {
  try {
    const stored = Number(globalThis.localStorage?.getItem(TITLE_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= TITLE_WIDTH_MIN ? Math.min(stored, TITLE_WIDTH_MAX) : null;
  } catch {
    return null;
  }
}

function storeTitleWidth(width) {
  try {
    if (width === null) globalThis.localStorage?.removeItem(TITLE_WIDTH_KEY);
    else globalThis.localStorage?.setItem(TITLE_WIDTH_KEY, String(width));
  } catch {
    /* Хранилище недоступно (приватное окно) — ширина живёт до перезагрузки */
  }
}

/** Ширина в пределах: не уже исходной, не шире половины карты и не больше максимума. */
export function clampTitleWidth(width, frameWidth) {
  const ceiling = Math.max(TITLE_WIDTH_MIN, Math.min(TITLE_WIDTH_MAX, frameWidth > 0 ? Math.floor(frameWidth / 2) : TITLE_WIDTH_MAX));
  return Math.round(Math.min(ceiling, Math.max(TITLE_WIDTH_MIN, width)));
}

/**
  Ширина по умолчанию — под самое длинное название (J-193): к показанной ширине
  добавляется наибольший срез подписи. Не уже исходной; предел — тот же, что у ручки
*/
export function contentTitleWidth(labels, shown) {
  let overflow = 0;
  for (const label of labels) overflow = Math.max(overflow, Math.ceil(label.scrollWidth - label.clientWidth) || 0);
  /* scrollWidth округлён до целых: без запаса текст шире на долю пикселя и снова уходит в многоточие */
  return Math.max(TITLE_WIDTH_MIN, overflow ? shown + overflow + TITLE_WIDTH_SLACK : shown);
}

/** Показанная ширина и предел ручки — по текущей ширине карты: на узком экране подписи не закрывают плитки. */
function applyTitleWidth(view, resizer, width, frameWidth) {
  const shown = clampTitleWidth(width, frameWidth);
  /* Исходная ширина — токен: пустое значение снимает свойство */
  view.style.setProperty('--heatmap-row-title-width', shown === TITLE_WIDTH_MIN ? '' : `${shown}px`);
  resizer.setAttribute('aria-valuenow', String(shown));
  resizer.setAttribute('aria-valuemax', String(clampTitleWidth(Infinity, frameWidth)));
  resizer.setAttribute('aria-valuetext', `${shown} пикселей`);
  return shown;
}

/* Ручка — separator с клавишами: стрелки меняют ширину, Home и двойной клик возвращают ширину по названиям, End — наибольшую */
function titleResizer(view, frame, onResize) {
  const resizer = element('div', 'heatmap-resizer');
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', 'Ширина колонки названий');
  resizer.setAttribute('aria-valuemin', String(TITLE_WIDTH_MIN));
  resizer.setAttribute('tabindex', '0');
  resizer.title = 'Потяните, чтобы увидеть названия длиннее. Двойной клик — по длине названий';
  const frameWidth = () => frame.getBoundingClientRect?.().width ?? 0;
  /*
    Без ручного выбора — ширина под самое длинное название: подписи меряются при исходной ширине, иначе после
    широкой ручной ширины Home и двойной клик не сузили бы колонку обратно
  */
  let shown = TITLE_WIDTH_MIN;
  const autoWidth = (width) => {
    applyTitleWidth(view, resizer, TITLE_WIDTH_MIN, width);
    return contentTitleWidth(view.querySelectorAll?.('.heatmap__row-label') ?? [], TITLE_WIDTH_MIN);
  };
  const fit = () => {
    const width = frameWidth();
    shown = applyTitleWidth(view, resizer, titleWidth ?? autoWidth(width), width);
  };
  const set = (width) => {
    titleWidth = width === null ? null : clampTitleWidth(width, frameWidth());
    fit();
    onResize();
  };
  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = shown;
    resizer.setPointerCapture?.(event.pointerId);
    resizer.dataset.dragging = '';
    /* Дрожь указателя при клике по ручке не фиксирует ручную ширину: иначе ширина по названиям выключилась бы навсегда */
    let moved = false;
    const move = (moveEvent) => {
      const shift = moveEvent.clientX - startX;
      if (!moved && Math.abs(shift) < TITLE_DRAG_THRESHOLD) return;
      moved = true;
      set(startWidth + shift);
    };
    /* lostpointercapture приходит и после pointerup, и при потере захвата — например, если карта перерисовалась посреди перетаскивания */
    const stop = () => {
      delete resizer.dataset.dragging;
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('lostpointercapture', stop);
      if (resizer.hasPointerCapture?.(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
      if (moved) storeTitleWidth(titleWidth);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('lostpointercapture', stop);
  });
  resizer.addEventListener('dblclick', () => {
    set(null);
    storeTitleWidth(null);
  });
  resizer.addEventListener('keydown', (event) => {
    const current = shown;
    const next = { ArrowRight: current + TITLE_WIDTH_STEP, ArrowLeft: current - TITLE_WIDTH_STEP, Home: null, End: TITLE_WIDTH_MAX }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    set(next);
    storeTitleWidth(titleWidth);
  });
  resizer.fit = fit;
  fit();
  return resizer;
}

/* J-68: «справа есть ещё колонки» — правый край плиток затухает; у конца прокрутки обрыва нет */
export function markOverflow(scroll) {
  const more = scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 1;
  if (more) scroll.dataset.moreEnd = '';
  else delete scroll.dataset.moreEnd;
}

/* Подсветка не сбрасывает раскрытие; новый срез или разрез начинается с десяти строк (J-11, J-202: порция 20 из J-193 отменена). */
function pageFor(block, context, variant) {
  const filters = Object.entries(context.state.filters ?? {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => [key, [...values].sort()]);
  const key = JSON.stringify([context.state.channel, context.period.from, context.period.to,
    context.state.focus, selectedAntidriverDimension, filters, variant]);
  const previous = pagination.get(block);
  if (previous?.key === key && previous.rows === context.rows && previous.reference === context.reference) return previous;
  const page = { key, rows: context.rows, reference: context.reference, limit: PAGE_SIZE };
  pagination.set(block, page);
  return page;
}

/* J-135: у «Урона» — красный треугольник вниз, у «Влияния» — зелёный вверх и красный вниз: значки повторяют цвета карты */
const HIGHLIGHT_OPTIONS = {
  [HIGHLIGHT_PLAN]: { label: 'План' },
  [HIGHLIGHT_DAMAGE]: { label: 'Урон', icons: [{ name: 'triangle-down', tone: 'negative' }] },
  [HIGHLIGHT_INFLUENCE]: {
    label: 'Влияние',
    title: 'Как изменится VOC без оценок с элементом',
    icons: [{ name: 'triangle-up', tone: 'positive' }, { name: 'triangle-down', tone: 'negative' }],
  },
};

const isVersionCut = () => selectedAntidriverDimension === VERSION_CUT.key;

/* J-117: гранулярность — справа в шапке, как у динамики; разрез — в строке под шапкой рядом с режимом подсветки */
function heatmapScaleTabs(blockPeriod, scale, rerender) {
  return scaleTabs({
    label: 'Гранулярность антидрайверов',
    options: SCALE_CHOICES,
    selected: scale,
    onSelect: (value) => {
      heatmapScales.choose(value, blockPeriod);
      rerender();
    },
  });
}

function controls(block, context, scale) {
  const wrap = element('span', 'antidriver-controls');
  if (context.state.focus) wrap.append(focusChip(context));
  wrap.append(heatmapScaleTabs(context.period, scale, () => renderAntidrivers(block, context)));
  return wrap;
}

/* Разрез остаётся и у пустого результата: иначе из пустого разреза не вернуться */
function withCut(node, cutTabs) {
  const wrap = element('div', 'antidriver-empty');
  const toolbar = element('div', 'heatmap-toolbar');
  toolbar.append(cutTabs);
  wrap.append(toolbar, node);
  return wrap;
}

/* Отклонение режима подсветки — строкой подсказки, а не в ячейке: в ячейке только VOC (R-18) */
function highlightCaption(highlight, cell) {
  if (selectedHeatmapHighlight === HIGHLIGHT_PLAN) {
    if (highlight.value === null) return { line: 'Плана нет', spoken: 'плана нет' };
    const shown = formatDelta(roundDelta(highlight.value));
    const distance = formatVoc(Math.abs(highlight.value));
    if (highlight.value < 0) return { line: `Дельта к плану ${shown}`, spoken: `ниже плана на ${distance}` };
    if (highlight.value > 0) return { line: `Дельта к плану ${shown}`, spoken: `выше плана на ${distance}` };
    return { line: 'В плане', spoken: 'в плане' };
  }
  if (selectedHeatmapHighlight === HIGHLIGHT_DAMAGE && highlight.value !== null) {
    const shown = formatImpact(highlight.value);
    return { line: `Урон ${shown}`, spoken: `урон ${shown}` };
  }
  if (selectedHeatmapHighlight === HIGHLIGHT_INFLUENCE) {
    if (highlight.value === null) return { line: 'Влияние не считается: все оценки интервала с элементом', spoken: 'влияние не считается' };
    const shown = formatImpact(highlight.value);
    const without = `без элемента VOC ${formatVoc(cell.vocWithout)}`;
    if (highlight.value === 0) return { line: `Влияние около нуля, ${without}`, spoken: `влияние около нуля, ${without}` };
    return { line: `Влияние ${shown}, ${without}`, spoken: `влияние ${shown}, ${without}` };
  }
  return { line: null, spoken: null };
}

function showTooltip(tooltip, view, cell, lines) {
  tooltip.replaceChildren(...lines.map((line, index) => element('span', index ? 'heatmap-tooltip__line' : 'heatmap-tooltip__title', line)));
  tooltip.hidden = false;
  const box = cell.getBoundingClientRect();
  const frame = view.getBoundingClientRect();
  /* Подсказка над центром ячейки, но не шире карты: у крайних колонок прижимается к краю */
  const half = tooltip.offsetWidth / 2;
  const center = box.left - frame.left + box.width / 2;
  tooltip.style.setProperty('--tooltip-x', `${Math.min(Math.max(center, half), frame.width - half)}px`);
  tooltip.style.setProperty('--tooltip-y', `${box.top - frame.top}px`);
}

const counted = (count, forms) => `${formatCount(count)} ${plural(count, forms)}`;

function elementCellFacts(cell, highlight) {
  const value = formatVoc(cell.voc);
  const caption = cell.voc === null ? { line: null, spoken: null } : highlightCaption(highlight, cell);
  /* Оценка с упоминанием элемента считается один раз: группа дедуплицирована по voc_ccode (D-09) */
  const ratings = `${counted(cell.mentions, ['оценка', 'оценки', 'оценок'])} с упоминанием`;
  return { value, lines: [`VOC ${value}`, ratings, caption.line], spoken: [`VOC ${value}`, ratings, caption.spoken] };
}

/* J-128: выбор антидрайвера — строка целиком или ячейка (строка × интервал); повторный клик снимает выбор */
const rowLabel = (context, key) => context.label(selectedAntidriverDimension, key);
function pickOf(key, column = null) {
  return {
    cut: selectedAntidriverDimension, key,
    ...(column ? { from: column.from, to: column.to } : {}),
  };
}
const samePick = (left, right) => JSON.stringify(normalizeDriver(left)) === JSON.stringify(normalizeDriver(right));
/*
  Выбор перерисовывает весь дашборд: кнопки карты создаются заново. Фокус возвращается на ту же строку или ячейку,
  горизонтальная прокрутка карты — на прежнюю позицию, иначе нажатая поздняя колонка уезжает за край
*/
function togglePick(context, pick, node) {
  const card = node.closest?.('.card') ?? null;
  const scrollLeft = card?.querySelector('.heatmap-scroll')?.scrollLeft ?? 0;
  const { pickKey, pickColumn } = node.dataset;
  const current = normalizeDriver(context.state.driver);
  context.setState({ ...context.state, driver: current && samePick(current, pick) ? null : pick });
  const scroll = card?.querySelector('.heatmap-scroll');
  if (scroll) scroll.scrollLeft = scrollLeft;
  const selector = pickColumn === undefined ? '.heatmap__row-pick' : '.heatmap-cell';
  [...(card?.querySelectorAll(selector) ?? [])]
    .find((candidate) => candidate.dataset.pickKey === pickKey && candidate.dataset.pickColumn === pickColumn)
    ?.focus({ preventScroll: true });
}

function heatmapCell(context, heatmap, row, column, cell, highlight, tooltip, view) {
  const label = rowLabel(context, row.key);
  const interval = formatInterval(column);
  const facts = elementCellFacts(cell, highlight);
  const tone = isBlankCell(heatmap, cell) ? 'empty' : highlight.tone;
  const node = element('button', tone ? `heatmap-cell tone-pill heatmap-cell--${tone}` : 'heatmap-cell tone-pill');
  node.type = 'button';
  if (highlight.muted) node.classList.add('heatmap-cell--muted');
  if (highlight.tone) node.style.setProperty('--heat-strength', `${Math.round(highlight.strength * 100)}%`);
  node.append(element('span', 'heatmap-cell__value', facts.value));
  const pick = pickOf(row.key, column);
  const picked = samePick(context.state.driver, pick);
  node.setAttribute('aria-pressed', String(picked));
  node.setAttribute('aria-label', `${label}, ${interval}: ${facts.spoken.filter(Boolean).join(', ')}. ${picked ? 'Снять выбор' : 'Показать проблемы и комментарии за интервал'}`);
  node.dataset.pickKey = row.key;
  node.dataset.pickColumn = column.from;
  node.addEventListener('click', () => togglePick(context, pick, node));
  const lines = [`${label} · ${interval}`, ...facts.lines].filter(Boolean);
  const show = () => showTooltip(tooltip, view, node, lines);
  const hide = () => {
    tooltip.hidden = true;
  };
  node.addEventListener('pointerenter', show);
  node.addEventListener('focus', show);
  node.addEventListener('pointerleave', hide);
  node.addEventListener('blur', hide);
  return node;
}

function sameCorridor(plans) {
  const [first, ...rest] = plans;
  return rest.every((plan) => plan.min === first.min && plan.max === first.max) ? first : null;
}

/*
  J-193: длинное пояснение легенды — в подсказке значка «i» рядом с пунктами, а не строкой текста.
  Высота легенды одна во всех режимах, смена режима не сдвигает страницу (J-144). Без пунктов (нет плана) —
  пояснение видно: это состояние, а не расшифровка цвета
*/
function heatmapLegend(items, note, title) {
  const legend = element('div', 'heatmap-legend');
  if (!items.length) {
    const text = element('p', 'heatmap-legend__note', bindShortWords(note));
    text.title = note;
    legend.append(text);
    return legend;
  }
  const hint = element('span', 'heatmap-legend__hint');
  hint.setAttribute('role', 'img');
  hint.setAttribute('aria-label', `Что значит цвет: ${title}`);
  hint.setAttribute('tabindex', '0');
  hint.append(icon('info', 'heatmap-legend__hint-icon'));
  hoverTooltip(hint, [title, note]);
  legend.append(legendList(items), hint);
  return legend;
}

/* Интервал колонки родительным падежом — «средний VOC дня / недели / месяца»; крайние неполные колонки уже, поэтому по самой широкой */
function intervalOf(columns) {
  const widest = Math.max(0, ...columns.map(dayCount));
  if (widest <= 1) return 'дня';
  return widest <= 7 ? 'недели' : 'месяца';
}

/* J-188: легенды «Влияния» и «Урона» говорят, что значит цвет, а не как он посчитан: расчёт — в подсказке ячейки и в «Как считается» */
function legendFor(columnPlans, columns) {
  const interval = intervalOf(columns);
  if (selectedHeatmapHighlight === HIGHLIGHT_INFLUENCE) {
    /* J-144: тянет вверх — драйвер, вниз — антидрайвер; «около нуля» не подписывается — серая ячейка понятна и так */
    return heatmapLegend(
      [legendItem('Драйвер', 'heat-good'), legendItem('Антидрайвер', 'heat-bad')],
      `Зелёный тянет средний VOC ${interval} вверх, красный — вниз; серый почти не влияет`,
    'Влияние',
    );
  }
  if (selectedHeatmapHighlight === HIGHLIGHT_DAMAGE) {
    return heatmapLegend(
      [legendItem('Урон', 'heat-bad')],
      `Сколько VOC ${interval} теряет из-за элемента. Стабильнее «Влияния», но копится и у частых элементов с оценками около среднего`,
    'Урон',
    );
  }
  if (selectedHeatmapHighlight !== HIGHLIGHT_PLAN) return null;
  const plans = columnPlans.filter(Boolean);
  if (!plans.length) return heatmapLegend([], 'Для среза нет планового коридора — подсветка по плану недоступна');
  const corridor = sameCorridor(plans);
  const target = corridor ? `коридора плана ${formatVoc(corridor.min)}–${formatVoc(corridor.max)}` : 'коридора плана интервала';
  const gaps = plans.length < columnPlans.length ? '; интервалы без плана не подсвечены' : '';
  return heatmapLegend(
    [legendItem('Ниже плана', 'heat-bad'), legendItem('В плане', 'heat-neutral'), legendItem('Выше плана', 'heat-good')],
    `VOC элемента против ${target}: чем выше плана, тем зеленее; чем ниже плана, тем краснее${gaps}`,
    'План',
  );
}

/*
  J-149: карта — одна или несколько секций строк. У разреза «Версии» секции — платформы: подзаголовок «iOS» /
  «Android», свои строки по частотности, своя подсветка и своё «Показать ещё»; колонки общие
*/
function heatmapToolbar(columnPlans, columns, rerender, cutTabs, lead) {
  const toolbar = element('div', 'heatmap-toolbar');
  const highlightTabs = segmented({
    label: 'Подсветка тепловой карты',
    options: highlightModes(selectedAntidriverDimension).map((value) => ({ value, ...HIGHLIGHT_OPTIONS[value] })),
    selected: selectedHeatmapHighlight,
    onSelect: (value) => {
      selectedHeatmapHighlight = value;
      rerender();
    },
  });
  /* J-193: режимы — не сортировка, а цвет карты; подпись «Цвет:» говорит это прямо, порядок строк — частотность (J-11) */
  const highlight = element('div', 'heatmap-mode');
  highlight.append(element('span', 'heatmap-mode__label', 'Цвет:'), highlightTabs);
  /* J-117 + J-112: разрез, у разреза «Версии» — ОС и схлопывание, затем режим подсветки; гранулярность — в шапке блока */
  toolbar.append(...[cutTabs, ...lead, highlight].filter(Boolean));
  const legend = legendFor(columnPlans, columns);
  if (legend) toolbar.append(legend);
  return toolbar;
}

function heatmapHead(columns) {
  const head = element('thead');
  const headRow = element('tr');
  /* Колонка подписей без заголовка, как в макете; имя колонки — для screen reader */
  const corner = element('th', 'heatmap__row-title');
  corner.append(element('span', 'visually-hidden', isVersionCut() ? 'Версия' : 'Элемент'));
  headRow.append(corner);
  for (const column of columns) headRow.append(element('th', 'heatmap__date', formatDate(column.from)));
  head.append(headRow);
  return head;
}

/* Строка на всю ширину карты: заголовок секции или её кнопки порции */
function spanningRow(rowClass, cell, span) {
  const tr = element('tr', rowClass);
  cell.colSpan = span;
  tr.append(cell);
  return tr;
}

function sectionTitleRow(section, span) {
  const th = element('th', 'heatmap__section-title');
  th.setAttribute('scope', 'rowgroup');
  th.append(element('span', null, section.title), element('span', 'heatmap__section-count', section.caption));
  return spanningRow('heatmap__section', th, span);
}

/* J-128: подпись — кнопка выбора строки за весь период; у версии — платформа меткой и номер */
function rowPickButton(context, row, driver) {
  const pick = pickOf(row.key);
  const wholeRow = samePick(driver, pick);
  const button = element('button', 'heatmap__row-pick');
  button.type = 'button';
  button.setAttribute('aria-pressed', String(wholeRow));
  /* J-149: платформа — в подзаголовке секции, у строки — номер версии */
  if (isVersionCut()) button.append(withOverflowTitle(element('span', 'heatmap__row-label', splitVersionKey(row.key).version)));
  else button.append(withOverflowTitle(element('span', 'heatmap__row-label', rowLabel(context, row.key))));
  button.setAttribute('aria-label', `${rowLabel(context, row.key)}. ${wholeRow ? 'Снять выбор' : 'Показать проблемы и комментарии'}`);
  button.dataset.pickKey = row.key;
  button.addEventListener('click', () => togglePick(context, pick, button));
  return button;
}

function heatmapRow(context, heatmap, row, highlights, { tooltip, view }) {
  const driver = normalizeDriver(context.state.driver);
  const rowPicked = Boolean(driver && driver.cut === selectedAntidriverDimension && driver.key === row.key);
  const tr = element('tr', rowPicked ? 'is-picked' : null);
  /* Подпись в одну строку с многоточием, полная — в подсказке; имя строки не меняется (R-47) */
  const title = element('th', 'heatmap__row-title');
  title.append(rowPickButton(context, row, driver));
  tr.append(title);
  row.cells.forEach((cell, index) => {
    const td = element('td');
    td.append(heatmapCell(context, heatmap, row, heatmap.columns[index], cell, highlights[index], tooltip, view));
    tr.append(td);
  });
  return tr;
}

function heatmapBody(context, sections, columnPlans, overlay) {
  const body = element('tbody');
  const span = sections[0].heatmap.columns.length + 1;
  for (const section of sections) {
    const { heatmap } = section;
    const highlights = highlightHeatmap(heatmap, selectedHeatmapHighlight, columnPlans, section.calibration);
    if (section.title) body.append(sectionTitleRow(section, span));
    heatmap.rows.forEach((row, rowIndex) => body.append(heatmapRow(context, heatmap, row, highlights[rowIndex], overlay)));
    if (section.actions) {
      const td = element('td');
      td.append(section.actions);
      body.append(spanningRow('heatmap__section-actions', td, span));
    }
  }
  return body;
}

function heatmapScroll(tooltip) {
  const scroll = element('div', 'heatmap-scroll scroll-area');
  /* Фокус на скрытой колонке прокручивает карту к ней: подсказка переезжает к ячейке, а гаснет только без фокуса */
  scroll.addEventListener('scroll', () => {
    markOverflow(scroll);
    const focused = scroll.contains(document.activeElement) ? document.activeElement : null;
    if (focused?.classList.contains('heatmap-cell')) focused.dispatchEvent(new Event('focus'));
    else tooltip.hidden = true;
  });
  return scroll;
}

/*
  Ширину прокрутки и рамки знает только отрисованная карта: подгонка — после кадра и при смене
  размера. Наблюдатель отключается, когда перерисовка унесла карту со страницы
*/
function fitAfterPaint(scroll, resizer) {
  const refit = () => {
    resizer.fit();
    markOverflow(scroll);
  };
  globalThis.requestAnimationFrame?.(refit);
  if (globalThis.ResizeObserver) {
    const observer = new ResizeObserver(() => (scroll.isConnected ? refit() : observer.disconnect()));
    observer.observe(scroll);
  }
}

function heatmapView(context, sections, rerender, cutTabs, lead) {
  const view = element('div', 'antidriver-heatmap');
  view.id = 'antidrivers-heatmap';
  const { columns } = sections[0].heatmap;
  const columnPlans = columns.map(({ from, to }) =>
    planFor(context.reference?.plan, { channel: context.state.channel, from, to }),
  );
  view.append(heatmapToolbar(columnPlans, columns, rerender, cutTabs, lead));
  /* Подсказка — вне прокрутки карты: иначе у верхней строки её срезал бы край области прокрутки */
  const tooltip = element('div', 'heatmap-tooltip glass');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.hidden = true;
  const scroll = heatmapScroll(tooltip);
  const table = element('table', 'heatmap');
  table.append(heatmapHead(columns), heatmapBody(context, sections, columnPlans, { tooltip, view }));
  scroll.append(table);
  const frame = element('div', 'heatmap-frame');
  const resizer = titleResizer(view, frame, () => markOverflow(scroll));
  frame.append(scroll, resizer);
  view.append(frame, tooltip);
  fitAfterPaint(scroll, resizer);
  return view;
}

function noVersionOs() {
  return statusPanel('antidriver-unavailable', {
    title: 'Нет оценок iOS и Android',
    detail: 'Версии показываются только для iOS и Android, а в срезе таких оценок нет.',
  });
}

function noElements() {
  return statusPanel('antidriver-unavailable', {
    title: 'Нет элементов для анализа',
    detail: 'В выбранном разрезе нет учитываемых элементов.',
  });
}

/* Кнопки порции строк; горизонтальная прокрутка карты сохраняется */
function moreButtons({ limit, total, setLimit, rerender, label = '', key = '' }) {
  const buttons = element('div', 'heatmap-pagination__actions');
  const keepScroll = (change) => {
    change();
    return rerender();
  };
  const moreOf = (host) => host?.querySelector(`.heatmap-more[data-section="${key}"]`);
  buttons.append(...pagingButtons({
    shown: limit, total, page: PAGE_SIZE, moreClass: 'heatmap-more', collapseClass: 'heatmap-collapse', controls: 'antidrivers-heatmap', section: key,
    moreLabel: label ? `Показать ещё версии ${label}` : '',
    collapseLabel: label ? `Скрыть дополнительные версии ${label}` : 'Скрыть дополнительные строки антидрайверов',
    onMore: () => {
      const host = keepScroll(() => setLimit(limit + PAGE_SIZE));
      return moreOf(host) ?? host?.querySelector('.heatmap-pagination__status');
    },
    onCollapse: () => moreOf(keepScroll(() => setLimit(PAGE_SIZE))),
  }));
  return buttons;
}

/*
  J-11: строки — порциями по десять. J-149: у версий — порции в каждой секции платформы, кнопки — строкой под секцией;
  итог показанного — в подвале карты
*/
function paginatedView(context, parts, page, rerender, cutTabs, lead = []) {
  const sectioned = parts.length > 1 || Boolean(parts[0].title);
  page.limits ??= {};
  const limitOf = (key) => page.limits[key] ?? page.limit;
  const sections = parts.map((part) => {
    const actions = sectioned ? moreButtons({ limit: limitOf(part.key), total: part.total, label: part.title, key: part.key, rerender,
      setLimit: (limit) => { page.limits[part.key] = limit; } }) : null;
    return {
      ...part,
      heatmap: { ...part.heatmap, rows: part.heatmap.rows.slice(0, limitOf(part.key)) },
      calibration: part.heatmap,
      /* Строка кнопок — сразу за строками своей секции */
      actions: actions?.children.length ? actions : null,
    };
  });
  const view = heatmapView(context, sections, rerender, cutTabs, lead);
  const footer = element('div', 'heatmap-pagination');
  const shown = sections.map((section) => `${section.title ? `${section.title}: ` : ''}${formatCount(section.heatmap.rows.length)} из ${formatCount(section.total)}`);
  const status = element('p', 'heatmap-pagination__status', `По частотности · ${sectioned ? shown.join(' · ') : `Показано ${shown[0]}`}`);
  status.setAttribute('role', 'status');
  status.setAttribute('tabindex', '-1');
  footer.append(status);
  if (!sectioned) {
    const buttons = moreButtons({ limit: page.limit, total: parts[0].total, rerender, setLimit: (limit) => { page.limit = limit; } });
    if (buttons.children.length) footer.append(buttons);
  }
  view.append(footer);
  return view;
}

/*
  Режим цвета, разрез и платформы перерисовывают карту с теми же колонками: горизонтальная прокрутка остаётся на месте,
  иначе смена «План / Урон / Влияние» уводила карту к первому дню. Масштаб меняет колонки — его перерисовка без этого
*/
function keepHeatmapScroll(block, render) {
  const scrollLeft = block.element?.querySelector('.heatmap-scroll')?.scrollLeft ?? 0;
  render();
  const scroll = block.element?.querySelector('.heatmap-scroll');
  if (scroll) scroll.scrollLeft = scrollLeft;
  return block.element;
}

const focusParameters = (context) => (context.state.focus ? [['Выбранная дата', formatDate(context.state.focus)]] : []);

export function renderAntidrivers(block, context) {
  block.setTitle('Антидрайверы');
  /* J-40: период общий с графиком и календарём — выбирается в шапке группы */
  const period = context.periodControl?.shared ? null : { ...context.period, picker: context.periodControl };
  const viewContext = focusedContext(context);
  const dimensions = DIMENSION_KEYS.map((key) => DIMENSIONS.find((dimension) => dimension.key === key)).filter(Boolean);
  if (offersVersions(context.rows, context.state.channel)) dimensions.push(VERSION_CUT);
  if (!dimensions.some(({ key }) => key === selectedAntidriverDimension)) {
    selectedAntidriverDimension = dimensions[0].key;
  }
  selectedHeatmapHighlight = highlightFor(selectedAntidriverDimension, selectedHeatmapHighlight);
  const dimension = dimensions.find(({ key }) => key === selectedAntidriverDimension);

  const cutTabs = segmented({
    label: 'Разрез антидрайверов',
    options: dimensions.map(({ key, title, fullTitle }) => ({ value: key, label: title, title: fullTitle })),
    selected: selectedAntidriverDimension,
    onSelect: (value) => {
      selectedAntidriverDimension = value;
      keepHeatmapScroll(block, () => renderAntidrivers(block, context));
    },
  });
  /* J-149: платформы — секциями; сузить до одной — фильтром «Опер. системы» шапки */
  const found = isVersionCut() ? versionOsChoices(viewContext.slice) : [];
  const page = pageFor(block, context, isVersionCut() ? found : null);
  const scale = heatmapScale(context.period, viewContext.period);
  const isVersion = isVersionCut();
  const versionParameters = isVersion && found.length ? [['ОС версий', found.map(osName).join(', ')]] : [];
  /* В шапке — период блока; выбранный день и окно его сравнения — на кнопке сброса даты */
  const head = (heatmap = null) => block.setHead({
    ...(period ? { period } : {}),
    controls: controls(block, context, scale),
    actions: heatmap ? downloadAction(
      () => exportFileName('Антидрайверы', viewContext),
      () => antidriverSheets(viewContext, heatmap, {
        cut: dimension.title,
        cutKey: dimension.key,
        scale,
        ...(isVersion ? { rowTitle: 'Версия' } : {}),
        extra: [...versionParameters, ...focusParameters(context)],
      }),
    ) : null,
  });
  if (viewContext.slice.length === 0) {
    head();
    block.setState(EMPTY);
    return;
  }
  const rerender = () => keepHeatmapScroll(block, () => renderAntidrivers(block, context));
  if (isVersion && !found.length) {
    head();
    block.setContent(noVersionOs());
    return;
  }
  const project = isVersion
    ? (row) => [versionRowKey(row)]
    : (row) => dimension.values(row, viewContext.reference);
  /*
    J-112, J-149: у версий секция на платформу — частотность, урон и влияние считаются внутри своей ОС: номера версий
    платформ независимы, и знаменатель другой платформы их бы смешал. Остальные разрезы — одна секция без заголовка
  */
  const parts = (isVersion ? found : [null]).map((os) => {
    const slice = os
      ? context.select({ from: viewContext.period.from, to: viewContext.period.to, filters: withFilter(context.state.filters, 'os', [osName(os)]) }).rows
      : viewContext.slice;
    const ranked = frequentElements(slice, project, viewContext.label, dimension.key);
    return {
      key: os ?? '',
      title: os ? osName(os) : null,
      caption: os ? `${formatCount(ranked.length)} ${plural(ranked.length, ['версия', 'версии', 'версий'])}` : null,
      total: ranked.length,
      /* J-11: наиболее частотные элементы текущего периода, сначала десять. */
      heatmap: buildHeatmap(slice, viewContext.period, scale, project, ranked.map(({ key }) => key)),
    };
  }).filter(({ total }) => total > 0);
  if (parts.length === 0) {
    head();
    block.setContent(withCut(noElements(), cutTabs));
    return;
  }
  /* Выгрузка — все строки всех секций, а не раскрытые; ключ строки версии несёт платформу */
  const heatmap = { columns: parts[0].heatmap.columns, rows: parts.flatMap((part) => part.heatmap.rows) };
  head(heatmap);
  block.setContent(paginatedView(viewContext, parts, page, rerender, cutTabs));
}
