/*
  Значение и его дельта — неразрывная пара (аудит 13.11): дельта стоит справа от числа в одной строке и не уходит под него,
  когда число длиннее. Место дельты не зависит от данных: «+557» не прыгает между строкой числа и следующей
*/

import { element } from '../ui/dom.js';

/** `value` — узел или текст значения; `change` — узел дельты (`delta()`) или null, тогда пара — одно значение. */
export function valueDelta(value, change, { className } = {}) {
  const pair = element('span', ['value-delta', className].filter(Boolean).join(' '));
  pair.append(typeof value === 'string' ? element('span', 'value-delta__value', value) : value);
  if (change) {
    change.classList?.add('value-delta__delta');
    pair.append(change);
  }
  return pair;
}
