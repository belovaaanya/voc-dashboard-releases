/* Точка статуса (C-04, Figma 3204:2746, 3204:3055): кольцо в карточке, точка со свечением в строке */

import { element } from '../ui/dom.js';

/** Смысл точка несёт одним цветом, поэтому стоит только рядом с текстом того же смысла и скрыта от screen reader (V-24). */
export function statusDot(tone, size = 'card') {
  const dot = element('span', `status-dot status-dot--${size} tone--${tone}`);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}
