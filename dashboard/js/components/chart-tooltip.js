/* Подсказка на графике: стоит в сцене графика у точки или над ячейкой */

import { element } from '../ui/dom.js';

/** `spoken: false` — текст подсказки уже есть в имени метки, и диктор его не повторяет. */
export function chartTooltip({ centered = false, spoken = false, className } = {}) {
  const tip = element('div', ['chart-tooltip glass', centered && 'chart-tooltip--centered', className].filter(Boolean).join(' '));
  tip.hidden = true;
  if (!spoken) tip.setAttribute('aria-hidden', 'true');
  return tip;
}

/* Вылет подсказки вправо от x и ширина сцены по форме текста (`shape`): подсказка drag мерится один раз на форму, а не на каждом шаге */
const extents = new Map();
globalThis.document?.fonts?.addEventListener?.('loadingdone', () => extents.clear());

/**
 * x и y — от левого верхнего угла сцены; сбоку от точки подсказка уходит влево, если справа нет места, над ячейкой — прижимается к краю сцены.
 * `shape` — ключ текста, при котором размер подсказки и сцены тот же (цифры моноширинные): замер берётся из прошлого показа.
 */
export function showChartTooltip(tip, { x, y, content, shape }) {
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
  const key = shape && `${tip.className}|${shape}`;
  let extent = key && extents.get(key);
  if (!extent) {
    const stage = tip.parentElement.getBoundingClientRect();
    extent = { right: tip.getBoundingClientRect().right - stage.left - x, stage: stage.width };
    if (key) extents.set(key, extent);
  }
  tip.classList.toggle('chart-tooltip--left', x + extent.right > extent.stage);
}
