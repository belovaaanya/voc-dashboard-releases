/* Дельта (C-04, Figma 3204:2729): число и стрелка в цвете тона; направление названо и словом для screen reader (D-26) */

import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/*
  Один знак изменения на всём дашборде — стрелка ↗ / ↘ / →: она читается как «выросло / упало». Залитый треугольник
  ▲ / ▼ читается как сортировка или статус, и рядом с карточками метрик две формы одного смысла путали (аудит 13.11)
*/
const DIRECTIONS = {
  up: { icon: 'trend-up', tone: 'positive' },
  down: { icon: 'trend-down', tone: 'negative' },
  flat: { icon: 'trend-flat', tone: 'neutral' },
};

/** Тон вклада по знаку; неизвестный и нулевой вклад — нейтральный, а не «хороший». */
export const signTone = (value) => (value < 0 ? 'negative' : value > 0 ? 'positive' : 'neutral');

/** Тон по умолчанию — из направления, иначе передаётся явно. Без стрелки направление несёт знак числа. `large` — стрелка крупной карточки (Figma 3204:2731); `plain` — число само не изменение, тоном только стрелка (Figma 3030:3283). Прежний `triangle` (R-49) принимается и рисует ту же стрелку. */
export function delta({ text, direction, caption, tone = DIRECTIONS[direction].tone, arrow = true, large = false, plain = false, triangle = false, className }) {
  const node = element('span', ['delta', large && 'delta--lg', plain && 'delta--plain', `tone--${tone}`, className].filter(Boolean).join(' '));
  node.append(element('span', null, text));
  if (arrow) node.append(icon(DIRECTIONS[direction].icon, 'delta__arrow'));
  if (caption) node.append(element('span', 'visually-hidden', `, ${caption}`));
  return node;
}
