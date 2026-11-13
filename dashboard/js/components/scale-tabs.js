/* Табы масштаба графика (D-52, J-13): дни, недели, месяцы на `segmented` (C-03) */

import { SCALE_OPTIONS } from '../core/timeseries.js';
import { segmented } from './segmented.js';

export function scaleTabs({ label, options = SCALE_OPTIONS, selected, onSelect }) {
  return segmented({ label, options, selected, onSelect });
}

/* J-181: ручной масштаб помнится для своего периода; новый период снова получает автоматический */
export function periodScaleMemory() {
  let chosen = null;
  return {
    scaleFor: (period, automatic) => (chosen?.from === period.from && chosen?.to === period.to ? chosen.scale : automatic),
    choose: (scale, period) => { chosen = { scale, from: period.from, to: period.to }; },
  };
}
