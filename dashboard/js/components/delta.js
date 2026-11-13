/* Дельта (C-04, Figma 3204:2729): число и стрелка в цвете тона; направление названо и словом для screen reader (D-26) */

import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const DIRECTIONS = {
  up: { icon: 'trend-up', triangle: 'triangle-up', tone: 'positive' },
  down: { icon: 'trend-down', triangle: 'triangle-down', tone: 'negative' },
  flat: { icon: 'trend-flat', triangle: 'triangle-flat', tone: 'neutral' },
};

/** Тон вклада по знаку; неизвестный и нулевой вклад — нейтральный, а не «хороший». */
export const signTone = (value) => (value < 0 ? 'negative' : value > 0 ? 'positive' : 'neutral');

/** Тон по умолчанию — из направления, иначе передаётся явно. Без стрелки направление несёт знак числа. `large` — стрелка крупной карточки (Figma 3204:2731); `plain` — число само не изменение, тоном только стрелка (Figma 3030:3283); `triangle` — залитый треугольник вместо стрелки (R-49). */
export function delta({ text, direction, caption, tone = DIRECTIONS[direction].tone, arrow = true, large = false, plain = false, triangle = false, className }) {
  const node = element('span', ['delta', large && 'delta--lg', plain && 'delta--plain', `tone--${tone}`, className].filter(Boolean).join(' '));
  node.append(element('span', null, text));
  if (arrow) node.append(icon(DIRECTIONS[direction][triangle ? 'triangle' : 'icon'], 'delta__arrow'));
  if (caption) node.append(element('span', 'visually-hidden', `, ${caption}`));
  return node;
}
