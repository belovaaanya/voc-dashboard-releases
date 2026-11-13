/*
  Горизонтальная прокрутка с затуханием краёв (аудит 13.11): широкая таблица или heatmap режется не посреди слова,
  а мягко уходит в край, и видно, что продолжение есть. Затухает только тот край, за которым ещё есть содержимое.
  Полоса прокрутки — общий класс `scroll-area` каркаса. Подключают «Топ проблем», «Антидрайверы» и детализация
*/

import { element } from '../ui/dom.js';

/* Порог в пикселях: дробная прокрутка у края не включает затухание */
const EDGE = 1;

/** Края, за которыми ещё есть содержимое: `{ start, end }`. */
export function scrollEdges({ scrollLeft, scrollWidth, clientWidth }) {
  const hidden = scrollWidth - clientWidth;
  return { start: scrollLeft > EDGE, end: hidden - scrollLeft > EDGE };
}

const FADES = ['both', 'end', 'none'];

/** Ставит `data-fade-start/end` по положению прокрутки. */
export function markEdges(track) {
  const { start, end } = scrollEdges(track);
  track.dataset.fadeStart = String(start);
  track.dataset.fadeEnd = String(end);
}

/**
 * Оборачивает `content` в полосу прокрутки; `label` — имя области для клавиатуры (прокрутка стрелками после Tab).
 * `fade: 'end'` — левый край не затухает (там закреплённая колонка); `'none'` — края только в `data-fade-*`, затухание рисует блок.
 */
export function hScroll(content, { className, label, fade = 'both' } = {}) {
  if (!FADES.includes(fade)) throw new Error(`Нет вида затухания «${fade}»`);
  const track = element('div', ['h-scroll', 'scroll-area', fade !== 'both' && `h-scroll--fade-${fade}`, className].filter(Boolean).join(' '));
  if (label) {
    track.tabIndex = 0;
    track.setAttribute('role', 'region');
    track.setAttribute('aria-label', label);
  }
  track.append(content);
  const sync = () => markEdges(track);
  track.addEventListener('scroll', sync, { passive: true });
  /* Ширина полосы и содержимого меняется без прокрутки (меню, данные, колонка названий); перерисовка уносит полосу — наблюдение кончается */
  if (typeof ResizeObserver === 'function') {
    let shown = false;
    const observer = new ResizeObserver(() => {
      if (track.isConnected) shown = true;
      else if (shown) return observer.disconnect();
      sync();
    });
    observer.observe(track);
    observer.observe(content);
  }
  globalThis.requestAnimationFrame?.(sync);
  return track;
}

/** Перерисовка не сбрасывает прокрутку: запоминает её до перерисовки, `restore()` ставит на новую полосу и возвращает её. */
export function rememberScroll(root, selector) {
  const left = root?.querySelector?.(selector)?.scrollLeft ?? 0;
  return () => {
    const track = root?.querySelector?.(selector) ?? null;
    if (track) track.scrollLeft = left;
    return track;
  };
}
