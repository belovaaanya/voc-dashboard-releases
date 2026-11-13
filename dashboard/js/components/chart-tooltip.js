/* Подсказка на графике: стоит в сцене графика у точки или над ячейкой */

import { element } from '../ui/dom.js';

/** `spoken: false` — текст подсказки уже есть в имени метки, и диктор его не повторяет. */
export function chartTooltip({ centered = false, spoken = false, className } = {}) {
  const tip = element('div', ['chart-tooltip glass', centered && 'chart-tooltip--centered', className].filter(Boolean).join(' '));
  tip.hidden = true;
  if (!spoken) tip.setAttribute('aria-hidden', 'true');
  return tip;
}

/** x и y — от левого верхнего угла сцены; сбоку от точки подсказка уходит влево, если справа нет места, над ячейкой — прижимается к краю сцены. */
export function showChartTooltip(tip, { x, y, content }) {
  if (content !== undefined) tip.replaceChildren(...[content].flat());
  tip.style.setProperty('--tooltip-y', `${y}px`);
  tip.classList.remove('chart-tooltip--left');
  tip.hidden = false;
  if (tip.classList.contains('chart-tooltip--centered')) {
    const half = tip.offsetWidth / 2;
    tip.style.setProperty('--tooltip-x', `${Math.min(Math.max(x, half), tip.parentElement.getBoundingClientRect().width - half)}px`);
    return;
  }
  tip.style.setProperty('--tooltip-x', `${x}px`);
  const stage = tip.parentElement.getBoundingClientRect();
  tip.classList.toggle('chart-tooltip--left', tip.getBoundingClientRect().right > stage.right);
}
