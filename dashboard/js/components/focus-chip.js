/* Выбранная дата в шапке блока, который она сузила: текст даты и сброс одной кнопкой (`D-31`, `R-41`) */

import { element } from '../ui/dom.js';
import { formatDate } from '../core/format.js';
import { icon } from '../ui/icons.js';

/* J-46: выбор заметен — значение крупнее и ярче подписи, сброс — иконкой закрытия, а не символом «×» */
export function selectionChip({ caption, value, label, title = label, action, onClear }) {
  const chip = element('button', 'focus-chip');
  chip.type = 'button';
  if (action) chip.dataset.action = action;
  chip.append(
    element('span', 'focus-chip__caption', caption),
    element('span', 'focus-chip__value', value),
    icon('close', 'focus-chip__icon'),
  );
  chip.title = title;
  chip.setAttribute('aria-label', label);
  chip.addEventListener('click', () => onClear(chip));
  return chip;
}

export function focusChip(context, detail) {
  const date = formatDate(context.state.focus);
  return selectionChip({
    caption: 'Дата',
    value: date,
    action: 'focus-clear',
    label: [`Сбросить выбранную дату ${date}`, detail].filter(Boolean).join('. '),
    title: detail || 'Сбросить дату',
    onClear: () => context.setState({ ...context.state, focus: null, detailEvent: null }),
  });
}
