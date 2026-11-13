/* Popover фильтра с draft и «Сбросить» / «Применить» — controls-period-filters, «Фильтры» */

import { toggleSelectedValue } from '../state/controls.js';
import { element } from '../ui/dom.js';
import { bindPopover } from '../ui/popover.js';

function checkboxList({ optionId, title, options, selected, optionLabel, onToggle }) {
  const list = element('fieldset', 'control-popover__choices');
  list.append(element('legend', 'visually-hidden', title));
  for (const [index, value] of options.entries()) {
    const option = element('label', 'control-popover__option');
    const input = element('input', 'control-popover__checkbox');
    input.type = 'checkbox';
    input.value = value;
    input.checked = selected.includes(value);
    input.id = `${optionId}-${index}`;
    input.addEventListener('change', () => onToggle(value));
    option.append(input, element('span', null, optionLabel(value)));
    list.append(option);
  }
  return list;
}

function actionButton(className, text, onClick) {
  const button = element('button', className, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

/* `inline: false` — panel вне `item` (таблица с прокруткой); без `returnFocus` фокус ставит вызывающий */
export function filterPopover({
  item, trigger, id, optionId = id, title, options = [], selected = [], optionLabel = (value) => value, choices = null,
  className = '', inline = true, returnFocus = false, onApply, onReset,
}) {
  let draft = [...selected];
  const panel = element('div', className ? `control-popover glass ${className}` : 'control-popover glass');
  panel.id = id;
  panel.setAttribute('aria-label', `Фильтр: ${title}`);
  panel.append(element('h2', 'control-popover__title', title));
  panel.append(choices
    ? choices((values) => { draft = values; })
    : checkboxList({ optionId, title, options, selected, optionLabel, onToggle: (value) => { draft = toggleSelectedValue(draft, value); } }));

  const actions = element('div', 'control-popover__actions');
  let close = () => {};
  actions.append(
    actionButton('control-popover__reset', 'Сбросить', () => {
      close(returnFocus);
      onReset();
    }),
    actionButton('control-popover__apply', 'Применить', () => {
      close(returnFocus);
      onApply(draft);
    }),
  );
  panel.append(actions);

  if (inline) item.append(panel);
  close = bindPopover(item, trigger, panel);
  return { panel, close };
}
