/*
  Прочерк «нет значения» — один вид на всех страницах (аудит 13.11): второстепенный цвет, а не белый или свой серый.
  Ноль — значение и пишется числом; прочерк — данных нет. Screen reader слышит «нет данных», а не «тире»
*/

import { element } from '../ui/dom.js';

export const EMPTY_MARK = '—';

export function emptyValue(label = 'нет данных') {
  const mark = element('span', 'value-empty', EMPTY_MARK);
  mark.setAttribute('aria-label', label);
  mark.setAttribute('role', 'img');
  return mark;
}
