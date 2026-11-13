/* Иконки интерфейса: линия цветом текста, сетка 16 — как контурные иконки макета (Figma 3204:2866) */

import { plural } from '../core/format.js';
import { element, svgNode } from './dom.js';

const PATHS = {
  calendar: ['M3 4.5h10v8.5H3z', 'M3 7.5h10', 'M5.5 3v3', 'M10.5 3v3'],
  expand: ['M5 11 11 5', 'M6.5 5H11v4.5'],
  collapse: ['M11 5 5 11', 'M9.5 11H5V6.5'],
  'trend-up': ['M4.5 11.5 11.5 4.5', 'M6 4.5h5.5V10'],
  'trend-down': ['M4.5 4.5 11.5 11.5', 'M11.5 6v5.5H6'],
  'trend-flat': ['M3.5 8h9', 'M9 4.5 12.5 8 9 11.5'],
  'chevron-down': ['M4.5 6.5 8 10l3.5-3.5'],
  /* J-138: значок пояснения в чипах типов событий */
  info: ['M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z', 'M8 7.5V11', 'M8 5.25v.01'],
  close: ['M5 5l6 6', 'M11 5l-6 6'],
  download: ['M8 3v7', 'M5 7.5 8 10.5l3-3', 'M3.5 12.5h9'],
  copy: ['M5.5 5.5h7v7h-7z', 'M3.5 10.5v-7h7'],
  /* J-94: «Мало оценок» — восклицательный знак в круге */
  alert: ['M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 1 0 0-11z', 'M8 5v3.5', 'M8 10.75v.25'],
  /* J-69: переключатель темы — солнце включает светлую, луна — тёмную */
  sun: ['M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z', 'M8 1.75v1.5', 'M8 12.75v1.5', 'M1.75 8h1.5', 'M12.75 8h1.5', 'M3.6 3.6l1.05 1.05', 'M11.35 11.35l1.05 1.05', 'M3.6 12.4l1.05-1.05', 'M11.35 4.65l1.05-1.05'],
  moon: ['M12.75 9.6A5 5 0 0 1 6.4 3.25a5 5 0 1 0 6.35 6.35z'],
  /* J-115: боковое меню — раздел дашборда, методика, сворачивание */
  grid: ['M3 3h4v4H3z', 'M9 3h4v4H9z', 'M3 9h4v4H3z', 'M9 9h4v4H9z'],
  book: ['M3.5 3h4a1.5 1.5 0 0 1 1.5 1.5v8.5', 'M12.5 3h-4', 'M3.5 3v9.5h4a1.5 1.5 0 0 1 1.5 1', 'M12.5 3v9.5h-4'],
  database: ['M3.5 4.5c0-1 2-1.75 4.5-1.75s4.5.75 4.5 1.75-2 1.75-4.5 1.75-4.5-.75-4.5-1.75z', 'M3.5 4.5v7c0 1 2 1.75 4.5 1.75s4.5-.75 4.5-1.75v-7', 'M3.5 8c0 1 2 1.75 4.5 1.75s4.5-.75 4.5-1.75'],
  'panel-left': ['M2.5 3h11v10h-11z', 'M6 3v10'],
  /* J-151: пункты меню страниц — роли, дайджест, обратная связь */
  users: ['M6 7.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z', 'M2 13c.5-2.2 2-3.5 4-3.5s3.5 1.3 4 3.5', 'M10.5 7.2a2 2 0 1 0 0-4', 'M11.5 9.6c1.4.4 2.3 1.6 2.5 3.4'],
  digest: ['M4 2.5h6l2.5 2.5v8.5h-8.5z', 'M6 7h5', 'M6 9.5h5', 'M6 12h3'],
  chat: ['M2.5 3.5h11v7.5h-6l-3 2.5v-2.5h-2z', 'M5 6.5h6', 'M5 8.5h4'],
};

/* Залитые формы: в контуре звезда и искра на размере подписи читаются хуже */
const FILLED = {
  sparkle: 'M8 2 9.3 6.7 14 8 9.3 9.3 8 14 6.7 9.3 2 8 6.7 6.7Z',
  star: 'M8 1.8 9.9 5.7 14.2 6.3 11.1 9.3 11.8 13.6 8 11.6 4.2 13.6 4.9 9.3 1.8 6.3 6.1 5.7Z',
  'triangle-up': 'M8 4.5 12 11H4Z',
  'triangle-down': 'M8 11.5 4 5h8Z',
  'triangle-flat': 'M4.5 7.25h7v1.5h-7Z',
};

/* Размер по умолчанию — сетка иконки: без класса svg не растягивается на весь контейнер */
export function icon(name, className = null) {
  if (!PATHS[name] && !FILLED[name]) throw new Error(`Нет иконки «${name}»`);
  const svg = svgNode('svg', className, { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' });
  if (FILLED[name]) {
    svg.append(svgNode('path', null, { d: FILLED[name], fill: 'currentColor' }));
    return svg;
  }
  for (const d of PATHS[name]) {
    svg.append(svgNode('path', null, { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  return svg;
}

/* Звезда в подписи («Доля 5★») — иконка: в подмножестве Manrope её нет; screen reader читает слово */
export function withStars(text) {
  const parts = text.split('★');
  return parts.flatMap((part, index) => (index === 0 ? [part] : [icon('star', 'icon-inline'), element('span', 'visually-hidden', ` ${starsWord(parts[index - 1])}`), part]))
    .filter((node) => node !== '');
}

/* Слово — по числу перед звездой, как у остальных подписей J-181: «1 звезда», «2 звезды», «5 звёзд» */
function starsWord(before) {
  const count = before.match(/(\d+)\s*$/)?.[1];
  return count === undefined ? 'звёзд' : plural(Number(count), ['звезда', 'звезды', 'звёзд']);
}
