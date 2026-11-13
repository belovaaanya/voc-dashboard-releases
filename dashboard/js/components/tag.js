/* Тег (C-04, Figma 3204:3055, 3030:3283): короткая метка на заливке цвета тона */

import { element, withOverflowTitle } from '../ui/dom.js';

/** `truncate` — тег в одну строку с многоточием, полный текст в подсказке: для тесной карточки (R-49). */
export function tag(text, tone, { truncate = false } = {}) {
  const node = element('span', truncate ? `tag tag--truncate tone--${tone}` : `tag tone--${tone}`, text);
  return truncate ? withOverflowTitle(node) : node;
}
