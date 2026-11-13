import { element } from '../ui/dom.js';

let activeClose = null;
let sequence = 0;

export function closeHoverTooltip() {
  activeClose?.();
}

/** Подсказка в верхнем слое: её не обрезают прокрутка карточки и соседние блоки. */
export function hoverTooltip(target, lines) {
  const panel = element('div', 'summary-tooltip glass');
  const description = lines.join('\n');
  target.setAttribute('aria-description', description);
  const native = typeof panel.showPopover === 'function';
  panel.id = `summary-tooltip-${++sequence}`;
  panel.setAttribute('role', 'tooltip');
  if (native) panel.setAttribute('popover', 'manual');
  else {
    panel.classList.add('summary-tooltip--portal');
    panel.hidden = true;
  }
  panel.append(...lines.map((line, index) => element('span', index ? 'summary-tooltip__line' : 'summary-tooltip__title', line)));
  // Описание читается даже при закрытой подсказке.
  if (native) target.append(panel);
  let timer;
  const cancelTimer = () => clearTimeout(timer);
  const close = () => {
    cancelTimer();
    if (native) {
      if (panel.matches(':popover-open')) panel.hidePopover();
    } else {
      panel.hidden = true;
      panel.remove();
    }
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('scroll', close, true);
    globalThis.removeEventListener?.('resize', close);
    if (activeClose === close) activeClose = null;
  };
  const onKey = event => {
    if (event.key === 'Escape') close();
  };
  const show = () => {
    cancelTimer();
    if (activeClose !== close) closeHoverTooltip();
    if (native) {
      if (!panel.matches(':popover-open')) panel.showPopover();
    } else {
      document.body.append(panel);
      panel.hidden = false;
    }
    activeClose = close;
    const box = target.getBoundingClientRect();
    const padding = 8;
    const left = Math.max(padding, Math.min(box.left, innerWidth - panel.offsetWidth - padding));
    const below = box.bottom + padding;
    const top = below + panel.offsetHeight <= innerHeight - padding ? below : Math.max(padding, box.top - panel.offsetHeight - padding);
    panel.style.setProperty('left', `${left}px`);
    panel.style.setProperty('top', `${top}px`);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', close, true);
    globalThis.addEventListener?.('resize', close);
  };
  const leave = () => {
    cancelTimer();
    if (document.activeElement === target) return;
    timer = setTimeout(close, 150);
    timer.unref?.();
  };
  target.addEventListener('pointerenter', show);
  target.addEventListener('focus', show);
  target.addEventListener('pointerleave', leave);
  target.addEventListener('blur', close);
  panel.addEventListener('pointerenter', cancelTimer);
  panel.addEventListener('pointerleave', leave);
}
