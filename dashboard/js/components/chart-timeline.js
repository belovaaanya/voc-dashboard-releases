import { element, svgNode } from '../ui/dom.js';
import { formatDate, formatDateRange } from '../core/format.js';
import { buildTimeSeries, recommendedScale } from '../core/timeseries.js';
import { chartDomain, linePaths, plotPoints } from '../core/chart-geometry.js';
import { earliestDate, latestDate } from '../core/dates.js';
import { clampWindow, dateAt, dayIndex, localChartPeriod } from '../state/chart-selection.js';
import { observeStage } from './stage-observer.js';

const HEIGHT = 64;
const INSET = 10;
const PREVIEW_HEIGHT = 34;
const HANDLE_WIDTH = 10;
const SHIFT_STEP = 7;
const STEP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);
/* Commit перерисовывает дашборд и с ним таймлайн: ручку, с которой шёл выбор, фокусирует уже новая шкала того же блока */
const refocusByOwner = new WeakMap();
const DEFAULT_OWNER = {};

const sameRange = (a, b) => a.from === b.from && a.to === b.to;
const focusLost = () => !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;

function emptyTimeline(node, caption) {
  caption.textContent = 'Нет данных для таймлайна';
  return { node, draw: () => {} };
}

/* Обзор всегда берёт историю канала и фильтров, независимо от периода графика. */
export function chartTimeline(context, { onPreview, owner = DEFAULT_OWNER } = {}) {
  const node = element('div', 'chart-timeline');
  const toolbar = element('div', 'chart-timeline__toolbar');
  const caption = element('span', 'chart-timeline__caption', 'Вся история · выделите период');
  const reset = element('button', 'chart-toggle', 'Вернуть общий период');
  reset.type = 'button';
  reset.disabled = !context.periodControl?.local;
  reset.addEventListener('click', () => context.periodControl?.onReset?.());
  toolbar.append(caption, reset);
  node.append(toolbar);
  if (!context.rows.length) return emptyTimeline(node, caption);
  const rows = context.select({ from: earliestDate(context.rows), to: latestDate(context.rows) }).rows;
  if (!rows.length) return emptyTimeline(node, caption);

  const bounds = { from: earliestDate(rows), to: latestDate(rows) };
  const history = buildTimeSeries(rows, bounds, recommendedScale(bounds));
  const domain = chartDomain(history, [], null);
  const last = dayIndex(bounds.to, bounds.from);
  const stage = element('div', 'chart-timeline__stage');
  /* J-57: дата под курсором при наведении и выбираемый диапазон при перетаскивании — рядом с курсором */
  const tip = element('div', 'chart-tooltip chart-timeline__tip glass');
  tip.hidden = true;
  tip.setAttribute('aria-hidden', 'true');
  node.append(stage);

  const committed = clampWindow(context.period, bounds);
  let current = committed;
  let cancelActiveDrag = null;
  let width = 0;
  /* После commit эта шкала уже заменена: blur её ручки при удалении из DOM не пишет второй раз */
  let settled = false;

  /* Тот же диапазон — не новая запись в истории: commit сбросил бы выбранный день, дни и детализацию */
  const commit = (focusEdge = null) => {
    if (settled) return;
    if (sameRange(current, committed)) {
      onPreview?.({ ...context.period });
      return;
    }
    settled = true;
    refocusByOwner.set(owner, focusEdge ? { edge: focusEdge, range: current } : null);
    context.setState(localChartPeriod(context.state, current));
  };

  function paint() {
    if (!width) return;
    /* Repaint заменяет SVG/capture: незавершённый preview возвращаем к периоду расчёта. */
    cancelActiveDrag?.();
    /* Отложенный refocus не перехватывает фокус, ушедший на другой контрол, и не достаётся шкале другого периода */
    const refocus = refocusByOwner.get(owner);
    const pending = refocus && focusLost() && sameRange(refocus.range, committed) ? refocus.edge : null;
    const focused = stage.contains(document.activeElement) ? document.activeElement.getAttribute('data-edge') : pending;
    refocusByOwner.delete(owner);
    const inner = Math.max(1, width - 2 * INSET);
    const x = (date) => INSET + (last ? dayIndex(date, bounds.from) / last * inner : inner / 2);
    const svg = svgNode('svg', 'chart-timeline__svg', {
      width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, 'aria-label': 'Выбор периода графика по всей истории', role: 'group',
    });
    const paths = svgNode('g', 'chart-timeline__preview', { transform: `translate(${INSET} 4)` });
    for (const d of linePaths(plotPoints(history, { width: inner, height: PREVIEW_HEIGHT, ...domain }))) paths.append(svgNode('path', null, { d }));
    const selection = svgNode('rect', 'chart-timeline__window', { y: 2, height: 40, 'data-edge': 'window' });
    svg.append(paths, selection);

    const handles = ['from', 'to'].map((edge) => {
      const handle = svgNode('rect', 'chart-timeline__handle', {
        y: 2, width: HANDLE_WIDTH, height: 40, rx: 3, tabindex: 0, role: 'slider', 'data-edge': edge,
        'aria-label': edge === 'from' ? 'Начало периода графика' : 'Конец периода графика', 'aria-valuemin': 0, 'aria-valuemax': last,
      });
      handle.addEventListener('keydown', (event) => stepByKey(event, edge));
      /* Удержанная стрелка двигает ручку без записи в историю; выбор фиксируется, когда клавишу отпустили или ушли с ручки */
      handle.addEventListener('keyup', (event) => {
        if (STEP_KEYS.has(event.key)) commit(edge);
      });
      /* Chromium шлёт blur и при удалении ручки, пока она ещё в DOM: ручку убрала перерисовка — выбор не пишется */
      handle.addEventListener('blur', () => queueMicrotask(() => handle.isConnected && commit()));
      svg.append(handle);
      return handle;
    });

    const place = () => {
      selection.setAttribute('x', x(current.from));
      selection.setAttribute('width', Math.max(2, x(current.to) - x(current.from)));
      for (const handle of handles) {
        const edge = handle.getAttribute('data-edge');
        handle.setAttribute('x', x(current[edge]) - HANDLE_WIDTH / 2);
        handle.setAttribute('aria-valuenow', dayIndex(current[edge], bounds.from));
        handle.setAttribute('aria-valuetext', formatDate(current[edge]));
      }
      caption.textContent = `Вся история · ${formatDateRange(current.from, current.to)}`;
    };

    function stepByKey(event, edge) {
      const index = dayIndex(current[edge], bounds.from);
      const step = event.shiftKey ? SHIFT_STEP : 1;
      const target = { ArrowLeft: index - step, ArrowRight: index + step, Home: 0, End: last }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      const [min, max] = edge === 'from' ? [0, dayIndex(current.to, bounds.from)] : [dayIndex(current.from, bounds.from), last];
      current = { ...current, [edge]: dateAt(bounds.from, Math.max(min, Math.min(max, target))) };
      place();
      onPreview?.({ ...current, preset: 'custom' });
    }

    for (const [date, anchor] of [[bounds.from, 'start'], [bounds.to, 'end']]) {
      const label = svgNode('text', 'chart-axis-label', { x: anchor === 'start' ? INSET : width - INSET, y: 59, 'text-anchor': anchor });
      label.textContent = formatDate(date);
      svg.append(label);
    }
    place();

    const at = (event) => Math.max(0, Math.min(last, Math.round((event.clientX - svg.getBoundingClientRect().left - INSET) / inner * last)));
    const showTip = (event, text) => {
      tip.textContent = text;
      tip.hidden = false;
      tip.style.setProperty('--tooltip-x', `${Math.round(event.clientX - svg.getBoundingClientRect().left)}px`);
      tip.style.setProperty('--tooltip-y', '0px');
    };
    let drag = null;
    const cancelThisDrag = () => {
      if (!drag) return false;
      current = drag.initial;
      drag = null;
      tip.hidden = true;
      onPreview?.({ ...context.period });
      return true;
    };
    cancelActiveDrag = cancelThisDrag;
    const dragTo = (event) => {
      const index = at(event);
      const fromIndex = dayIndex(current.from, bounds.from);
      const toIndex = dayIndex(current.to, bounds.from);
      if (drag.edge === 'from') current = { ...current, from: dateAt(bounds.from, Math.min(index, toIndex)) };
      else if (drag.edge === 'to') current = { ...current, to: dateAt(bounds.from, Math.max(index, fromIndex)) };
      else if (drag.edge === 'window') {
        const shift = index - drag.start;
        current = clampWindow({ from: dateAt(drag.initial.from, shift), to: dateAt(drag.initial.to, shift) }, bounds);
      } else current = { from: dateAt(bounds.from, Math.min(index, drag.start)), to: dateAt(bounds.from, Math.max(index, drag.start)) };
      place();
      onPreview?.({ ...current, preset: 'custom' });
      showTip(event, formatDateRange(current.from, current.to));
    };

    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { edge: event.target.getAttribute('data-edge'), start: at(event), initial: { ...current } };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', (event) => {
      if (drag) dragTo(event);
      else showTip(event, formatDate(dateAt(bounds.from, at(event))));
    });
    svg.addEventListener('pointerleave', () => {
      if (!drag) tip.hidden = true;
    });
    svg.addEventListener('pointerup', (event) => {
      if (!drag) return;
      dragTo(event);
      drag = null;
      tip.hidden = true;
      commit();
    });
    const cancel = () => {
      if (cancelThisDrag()) paint();
    };
    svg.addEventListener('pointercancel', cancel);
    svg.addEventListener('lostpointercapture', () => {
      if (drag) cancel();
    });
    stage.replaceChildren(svg, tip);
    if (focused) svg.querySelector(`[data-edge="${focused}"]`)?.focus();
  }

  return {
    node,
    draw: () => observeStage(stage, (size) => {
      width = size.width;
      paint();
    }),
  };
}
