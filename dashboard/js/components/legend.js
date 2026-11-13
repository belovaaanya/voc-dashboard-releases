/* Легенда (C-05, Figma 3204:2883): индикатор и подпись; форма индикатора повторяет отметку ряда, чтобы ключ читался и без цвета */

import { element } from '../ui/dom.js';

const SHAPES = ['dot', 'line', 'zones', 'dash', 'band', 'bar'];

/** Знак ключа без подписи; `large` — точка крупнее и без поля ключа: её колонку задаёт сетка блока («Дни плана»). */
export function legendMarker(tone, shape = 'dot', { large = false } = {}) {
  if (!SHAPES.includes(shape)) throw new Error(`Нет формы легенды «${shape}»`);
  const marker = element('span', large ? 'legend-item__marker legend-item__marker--large' : 'legend-item__marker');
  marker.setAttribute('aria-hidden', 'true');
  marker.append(element('span', [`legend-item__${shape}`, tone && `tone--${tone}`].filter(Boolean).join(' ')));
  return marker;
}

/** `zones` — линия VOC, меняющая цвет по коридору плана: тон у неё свой, по зонам. */
export function legendItem(label, tone, shape = 'dot') {
  const item = element('span', 'legend-item');
  item.setAttribute('role', 'listitem');
  item.append(legendMarker(tone, shape), element('span', null, label));
  return item;
}

export function legendList(items, className) {
  const list = element('div', ['legend-list', className].filter(Boolean).join(' '));
  list.setAttribute('role', 'list');
  list.append(...items);
  return list;
}
