import { element, svgNode } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formatDate, formatDateRange } from '../core/format.js';
import { buildTimeSeries, recommendedScale } from '../core/timeseries.js';
import { chartDomain, linePaths, plotPoints } from '../core/chart-geometry.js';
import { earliestDate, latestDate } from '../core/dates.js';
import { clampWindow, dateAt, dayIndex, localChartPeriod } from '../state/chart-selection.js';
import { observeStage } from './stage-observer.js';
import { chartTooltip, showChartTooltip } from './chart-tooltip.js';

const HEIGHT = 64;
const INSET = 10;
const PREVIEW_HEIGHT = 34;
const HANDLE_WIDTH = 10;
const SHIFT_STEP = 7;
const STEP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);
/* Commit перерисовывает дашборд и с ним таймлайн: ручку, с которой шёл выбор, фокусирует уже новая шкала того же блока */
const refocusByOwner = new WeakMap();
/* Жест применяется на каждом кадре: перерисовка блока берёт ту же шкалу — drag, захват указателя и фокус ручки переживают её */
const liveByOwner = new WeakMap();
/* Ширина шкалы прошлой отрисовки: перерисовка на кадре жеста не мерит сцену заново */
const stageSizes = new WeakMap();
const DEFAULT_OWNER = {};
const nextFrame = (callback) => (globalThis.requestAnimationFrame ?? ((run) => setTimeout(run, 16)))(callback);
const cancelFrame = (id) => (globalThis.cancelAnimationFrame ?? clearTimeout)(id);

const sameRange = (a, b) => a.from === b.from && a.to === b.to;
const focusLost = () => !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;

function emptyTimeline(node, caption) {
  caption.textContent = 'Нет данных для таймлайна';
  return { node, draw: () => {} };
}

/* Обзор всегда берёт историю канала и фильтров, независимо от периода графика. */
export function chartTimeline(context, { onPreview, owner = DEFAULT_OWNER } = {}) {
  const live = liveByOwner.get(owner);
  if (live?.node.isConnected && live.follows(context.period)) return { node: live.node, draw: () => {} };
  /* Шкалу убрала чужая перерисовка или период сменил не жест (Back): новая шкала начинает с периода расчёта */
  live?.abandon();
  const node = element('div', 'chart-timeline');
  const toolbar = element('div', 'chart-timeline__toolbar');
  /*
    Ревью 13.11: выбранные даты уже в периоде шапки группы — подпись их не повторяет. «Вернуть общий период» —
    иконка той же кнопки действия, что в шапке карточки; название (J-37) — её имя и подсказка. Без своего окна
    возвращать нечего: кнопка невидима и недоступна, но место за ней держится — полоса не прыгает
  */
  const caption = element('span', 'chart-timeline__caption', 'Вся история');
  const reset = element('button', 'card__action chart-timeline__reset');
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Вернуть общий период');
  reset.title = 'Вернуть общий период';
  reset.append(icon('reset', 'card__icon'));
  const idle = !context.periodControl?.local;
  reset.disabled = idle;
  if (idle) {
    reset.setAttribute('data-idle', '');
    reset.setAttribute('aria-hidden', 'true');
  }
  /* Кнопка исчезает вместе со своим окном: с клавиатуры (detail 0) фокус переходит на левую ручку новой шкалы, а не на body */
  reset.addEventListener('click', (event) => {
    if (!event?.detail) refocusByOwner.set(owner, { edge: 'from', range: null });
    context.periodControl?.onReset?.();
  });
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
  const tip = chartTooltip({ className: 'chart-timeline__tip' });
  node.append(stage);

  const committed = clampWindow(context.period, bounds);
  let current = committed;
  let cancelActiveDrag = null;
  let stopDrag = null;
  let width = 0;
  /* Жест — от первого шага до отпускания: период применяется не чаще кадра, в истории — одна запись (docs/blocks-dynamics.md) */
  let gesture = null;
  let instance = null;

  const applyFrame = () => {
    gesture.frame = 0;
    if (sameRange(current, gesture.applied)) return;
    gesture.applied = current;
    gesture.moved = true;
    /* Перерисовка переносит шкалу в новое тело блока: перенос снимает фокус с ручки — возвращаем его */
    const focused = stage.contains(document.activeElement) ? document.activeElement : null;
    context.setState(localChartPeriod(context.state, current), { gesture: 'move' });
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  };
  const scheduleApply = () => {
    /* Копия состояния до жеста: возврат к прежнему диапазону восстанавливает выбранный день, дни и детализацию */
    gesture ??= { base: { ...context.state }, applied: committed, moved: false, frame: 0 };
    liveByOwner.set(owner, instance);
    gesture.frame ||= nextFrame(applyFrame);
  };
  /* Тот же диапазон — не новая запись в истории: commit сбросил бы выбранный день, дни и детализацию */
  const commit = (focusEdge = null) => {
    if (!gesture) return;
    const { base, moved, frame } = gesture;
    gesture = null;
    cancelFrame(frame);
    liveByOwner.delete(owner);
    if (sameRange(current, committed)) {
      onPreview?.({ ...context.period });
      if (!moved) return;
    }
    refocusByOwner.set(owner, focusEdge ? { edge: focusEdge, range: current } : null);
    context.setState(sameRange(current, committed) ? base : localChartPeriod(context.state, current), { gesture: 'end' });
  };

  function paint() {
    if (!width) return;
    /* Repaint заменяет SVG/capture: незавершённый preview возвращаем к периоду расчёта. */
    cancelActiveDrag?.();
    /* Отложенный refocus не перехватывает фокус, ушедший на другой контрол, и не достаётся шкале другого периода */
    const refocus = refocusByOwner.get(owner);
    const pending = refocus && focusLost() && (!refocus.range || sameRange(refocus.range, committed)) ? refocus.edge : null;
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
      /* Удержанная стрелка применяет период на каждом кадре; запись в истории фиксируется, когда клавишу отпустили или ушли с ручки */
      handle.addEventListener('keyup', (event) => {
        if (STEP_KEYS.has(event.key)) commit(edge);
      });
      /* Chromium шлёт blur и при удалении ручки, пока она ещё в DOM: ручку убрала или перенесла с фокусом перерисовка — выбор не пишется */
      handle.addEventListener('blur', () => queueMicrotask(() => {
        if (handle.isConnected && (document.activeElement !== handle || document.hasFocus?.() === false)) commit();
      }));
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
      scheduleApply();
    }

    for (const [date, anchor] of [[bounds.from, 'start'], [bounds.to, 'end']]) {
      const label = svgNode('text', 'chart-axis-label', { x: anchor === 'start' ? INSET : width - INSET, y: 59, 'text-anchor': anchor });
      label.textContent = formatDate(date);
      svg.append(label);
    }
    place();

    const at = (event) => Math.max(0, Math.min(last, Math.round((event.clientX - svg.getBoundingClientRect().left - INSET) / inner * last)));
    const showTip = (event, text) => {
      showChartTooltip(tip, { content: text, x: Math.round(event.clientX - svg.getBoundingClientRect().left), y: 0, shape: `${width}|${text.replace(/\d/g, '0')}` });
    };
    let drag = null;
    /* Указатель слушает документ: перерисовка блока на каждом кадре переносит SVG, и захват указателя у узла может пропасть */
    const follow = (on) => {
      const method = on ? 'addEventListener' : 'removeEventListener';
      document[method]('pointermove', move);
      document[method]('pointerup', release);
      document[method]('pointercancel', cancel);
    };
    const cancelThisDrag = (deferCommit = false) => {
      if (!drag) return false;
      follow(false);
      current = drag.initial;
      drag = null;
      tip.hidden = true;
      onPreview?.({ ...context.period });
      /* Из paint: перерисовка дашборда — после неё, а не посреди сборки шкалы */
      if (deferCommit) queueMicrotask(() => commit());
      else commit();
      return true;
    };
    cancelActiveDrag = () => cancelThisDrag(true);
    stopDrag = () => {
      follow(false);
      drag = null;
      tip.hidden = true;
    };
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
      /* Подсказка мерится до правок шкалы и шапки: иначе её замер перестраивает layout посреди кадра */
      showTip(event, formatDateRange(current.from, current.to));
      place();
      onPreview?.({ ...current, preset: 'custom' });
      scheduleApply();
    };
    const ours = (event) => drag && (event.pointerId === undefined || event.pointerId === drag.pointerId);
    function move(event) {
      if (!ours(event)) return;
      /* Кнопку отпустили за окном браузера: pointerup туда не пришёл */
      if (event.buttons === 0) release(event);
      else dragTo(event);
    }
    function release(event) {
      if (!ours(event)) return;
      dragTo(event);
      follow(false);
      drag = null;
      tip.hidden = true;
      commit();
    }
    function cancel(event) {
      if (ours(event ?? {}) && cancelThisDrag()) paint();
    }

    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { edge: event.target.getAttribute('data-edge'), start: at(event), initial: { ...current }, pointerId: event.pointerId };
      svg.setPointerCapture(event.pointerId);
      follow(true);
    });
    svg.addEventListener('pointermove', (event) => {
      if (!drag) showTip(event, formatDate(dateAt(bounds.from, at(event))));
    });
    svg.addEventListener('pointerleave', () => {
      if (!drag) tip.hidden = true;
    });
    stage.replaceChildren(svg, tip);
    if (focused) svg.querySelector(`[data-edge="${focused}"]`)?.focus();
  }

  instance = {
    node,
    follows: (period) => Boolean(gesture) && sameRange(clampWindow(period, bounds), gesture.applied),
    abandon: () => {
      stopDrag?.();
      if (gesture) cancelFrame(gesture.frame);
      gesture = null;
      liveByOwner.delete(owner);
    },
    draw: () => observeStage(stage, (size) => {
      stageSizes.set(owner, size);
      width = size.width;
      paint();
    }, stageSizes.get(owner)),
  };
  return instance;
}
