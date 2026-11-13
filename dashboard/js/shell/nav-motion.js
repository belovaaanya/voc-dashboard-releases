/*
  Раскрытие и сворачивание бокового меню без раскладки страницы на каждом кадре: колонка меню на время перехода
  узкая, панель рабочей области разложена один раз по этой колонке и едет transform, меню меняет только свою ширину.
  Конец перехода ставит колонку итоговой ширины. Без движения (D-56) — сразу итоговое состояние
*/

import { milliseconds, motionAllowed } from '../ui/motion.js';

export const NAV_MOTION = 'navMotion';
/* Панель едет transform без смены размера: кто мерит её место, мерит его на кадрах перехода и в конце */
export const NAV_MOTION_START = 'navmotionstart';
export const NAV_MOTION_END = 'navmotionend';
let running = null;

function tokens() {
  const style = getComputedStyle(document.documentElement);
  const px = (name) => parseFloat(style.getPropertyValue(name)) || 0;
  return {
    expanded: px('--nav-width'),
    collapsed: px('--nav-width-collapsed'),
    duration: milliseconds(style.getPropertyValue('--motion-base')),
    easing: style.getPropertyValue('--ease-standard').trim() || 'ease-out',
  };
}

function finish() {
  if (!running) return;
  const { animations } = running;
  running = null;
  delete document.documentElement.dataset[NAV_MOTION];
  for (const animation of animations) animation.cancel();
  globalThis.dispatchEvent?.(new Event(NAV_MOTION_END));
}

/** Меняет состояние меню (`apply`) и проводит переход от текущей видимой ширины меню к итоговой. */
export function animateNav(nav, workspace, apply) {
  const from = nav?.getBoundingClientRect?.().width;
  finish();
  apply();
  if (!motionAllowed() || !nav?.animate || !workspace?.animate || !from) return;
  const { expanded, collapsed, duration, easing } = tokens();
  const to = document.documentElement.dataset.nav === 'collapsed' ? collapsed : expanded;
  if (!duration || Math.abs(to - from) < 1) return;
  document.documentElement.dataset[NAV_MOTION] = '';
  const timing = { duration, easing, fill: 'forwards' };
  const animations = [
    nav.animate([{ width: `${from}px` }, { width: `${to}px` }], timing),
    workspace.animate([{ transform: `translateX(${from - collapsed}px)` }, { transform: `translateX(${to - collapsed}px)` }], timing),
  ];
  const current = { animations };
  running = current;
  globalThis.dispatchEvent?.(new Event(NAV_MOTION_START));
  animations[0].finished.then(() => running === current && finish(), () => {});
}
