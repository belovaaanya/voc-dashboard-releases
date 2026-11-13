/* Выбранная дата в шапке блока, который она сузила: текст даты и сброс одной кнопкой (`D-31`, `R-41`) */

import { element } from '../ui/dom.js';
import { formatDate } from '../core/format.js';
import { icon } from '../ui/icons.js';

/*
  J-46: выбор заметен — значение крупнее и ярче подписи, сброс — иконкой закрытия, а не символом «×».
  Одна сборка на все чипы выбора: дата, событие, дни календаря
*/
export function chipContent(caption, value) {
  return [
    element('span', 'focus-chip__caption', caption),
    element('span', 'focus-chip__value', value),
    icon('close', 'focus-chip__icon'),
  ];
}

export function focusChip(context, detail) {
  const date = formatDate(context.state.focus);
  const clear = element('button', 'focus-chip');
  clear.append(...chipContent('Дата', date));
  clear.type = 'button';
  clear.dataset.action = 'focus-clear';
  clear.setAttribute('aria-label', [`Сбросить выбранную дату ${date}`, detail].filter(Boolean).join('. '));
  clear.title = detail || 'Сбросить дату';
  clear.addEventListener('click', () => context.setState({ ...context.state, focus: null, detailEvent: null }));
  return clear;
}
