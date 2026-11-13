/* Бейдж (C-04, Figma 3204:2734): pill с рамкой и свечением цвета тона */

import { element } from '../ui/dom.js';

export function badge(text, tone) {
  return element('span', `badge tone-pill tone--${tone}`, text);
}
