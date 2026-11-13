/*
  Горизонтальная прокрутка с затуханием краёв (аудит 13.11): широкая таблица или heatmap режется не посреди слова,
  а мягко уходит в край, и видно, что продолжение есть. Затухает только тот край, за которым ещё есть содержимое.
  Полоса прокрутки — общий класс `scroll-area` каркаса. Подключают «Топ проблем» и «Антидрайверы»
*/

import { element } from '../ui/dom.js';

/* Порог в пикселях: дробная прокрутка у края не включает затухание */
const EDGE = 1;

/** Края, за которыми ещё есть содержимое: `{ start, end }`. */
export function scrollEdges({ scrollLeft, scrollWidth, clientWidth }) {
  const hidden = scrollWidth - clientWidth;
  return { start: scrollLeft > EDGE, end: hidden - scrollLeft > EDGE };
}

/** Оборачивает `content` в полосу прокрутки; `label` — имя области для клавиатуры (прокрутка стрелками после Tab). */
export function hScroll(content, { className, label } = {}) {
  const track = element('div', ['h-scroll', 'scroll-area', className].filter(Boolean).join(' '));
  if (label) {
    track.tabIndex = 0;
    track.setAttribute('role', 'region');
    track.setAttribute('aria-label', label);
  }
  track.append(content);
  const sync = () => {
    const { start, end } = scrollEdges(track);
    track.dataset.fadeStart = String(start);
    track.dataset.fadeEnd = String(end);
  };
  track.addEventListener('scroll', sync, { passive: true });
  /* Ширина меняется при сворачивании меню и смене данных: края пересчитываются без прокрутки */
  if (typeof ResizeObserver === 'function') new ResizeObserver(sync).observe(track);
  globalThis.requestAnimationFrame?.(sync);
  return track;
}
