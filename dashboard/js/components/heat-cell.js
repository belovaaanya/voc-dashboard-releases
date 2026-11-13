/* Ячейка тепловой карты — pill тона: сила значения — свечением (--heat-strength), ниже порога — только рамка (muted) */

import { element } from '../ui/dom.js';

/** `strength` 0–1 или null — без свечения; `clickable` — выбираемая ячейка карты антидрайверов: кнопка с рукой и обводкой. */
export function heatCell({ clickable = false, tone = null, muted = false, strength = null, className, content = [] } = {}) {
  const cell = element(clickable ? 'button' : 'span', ['heatmap-cell tone-pill', tone && `heatmap-cell--${tone}`, muted && 'heatmap-cell--muted', className].filter(Boolean).join(' '));
  if (clickable) cell.type = 'button';
  if (strength !== null) cell.style.setProperty('--heat-strength', `${Math.round(strength * 100)}%`);
  cell.append(...[content].flat());
  return cell;
}
