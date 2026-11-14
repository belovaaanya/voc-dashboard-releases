/*
  Выбор месяца дайджеста (неделя 16–22.11): дайджест считается за календарный месяц, а не за период шапки —
  период 01.04–30.06 молча показывал «Май 2026». В шапке страницы дайджеста вместо периода — «Месяц»: месяцы с
  оценками, новые сверху, строка на год. Те же кнопки-пресеты, что у выбора периода, — выбранный подсвечен.
*/

import { MONTHS, monthName } from '../core/format.js';
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { bindPopover, popoverPanel } from '../ui/popover.js';

const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);
/** «Май 2026» — подпись триггера и доступное имя кнопки месяца. */
export const monthTitle = (month) => `${capitalized(monthName(month))} ${month.slice(0, 4)}`;

/** Месяцы `YYYY-MM` по годам, новые сверху: [[год, [месяцы по убыванию]], …]. */
export function monthRows(months) {
  const years = new Map();
  for (const month of [...months].sort().reverse()) {
    const year = month.slice(0, 4);
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(month);
  }
  return [...years];
}

export function monthPicker({ id, month, months, onChange, itemClass, triggerClass, iconClass }) {
  const item = element('div', itemClass);
  const trigger = element('button', triggerClass);
  trigger.type = 'button';
  trigger.dataset.action = 'digest-month';
  trigger.setAttribute('aria-label', `Месяц дайджеста: ${month ? monthTitle(month) : 'нет данных'}`);
  trigger.append(element('span', 'filters__control-label', month ? monthTitle(month) : 'Нет месяцев'), icon('calendar', iconClass));
  trigger.disabled = !months.length;

  const panel = popoverPanel({ id, title: 'Месяц', label: 'Выбор месяца дайджеста', className: 'control-popover--period control-popover--month' });
  const presets = element('div', 'control-popover__presets');
  let close;
  for (const [year, list] of monthRows(months)) {
    const group = element('div', 'control-popover__preset-row');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', year);
    const buttons = element('div', 'control-popover__preset-list');
    for (const value of list) {
      const button = element('button', 'control-popover__preset', MONTHS[Number(value.slice(5, 7)) - 1]);
      button.type = 'button';
      button.dataset.month = value;
      button.setAttribute('aria-label', monthTitle(value));
      button.setAttribute('aria-pressed', String(value === month));
      button.addEventListener('click', () => {
        close();
        if (value !== month) onChange(value);
      });
      buttons.append(button);
    }
    group.append(element('span', 'control-popover__preset-label', year), buttons);
    presets.append(group);
  }
  panel.append(presets);
  item.append(trigger, panel);
  close = bindPopover(item, trigger, panel);
  return item;
}
