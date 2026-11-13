/* Общий список триггеров для шапки и фильтра колонки: продукт — только группа,
   в выбранные значения попадают сами доступные триггеры (J-21). */
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const UNGROUPED = 'Без продукта';
let nextInstance = 0;

export function triggerGroups(options, reference, channel) {
  const groups = new Map();
  for (const value of new Set(options)) {
    const product = reference?.operations?.[channel]?.[value]?.product;
    const key = typeof product === 'string' && product.trim() ? product.trim() : UNGROUPED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return [...groups].sort(([left], [right]) => {
    if (left === UNGROUPED) return 1;
    if (right === UNGROUPED) return -1;
    return left.localeCompare(right, 'ru');
  }).map(([key, values]) => ({ key, values }));
}

export function triggerChoices({ options, selected = [], label = (_, value) => value, reference, channel, onChange }) {
  const available = [...new Set(options)];
  const chosen = new Set(selected.filter((value) => available.includes(value)));
  const choices = element('fieldset', 'control-popover__choices trigger-choices');
  choices.append(element('legend', 'visually-hidden', 'Триггеры по продуктам'));
  const instance = ++nextInstance;

  for (const [index, { key, values }] of triggerGroups(available, reference, channel).entries()) {
    const caption = key === UNGROUPED ? key : label('product', key);
    const group = element('div', 'trigger-choices__group');
    const head = element('div', 'trigger-choices__head');
    const productLabel = element('label', 'control-popover__option trigger-choices__product');
    const product = element('input', 'control-popover__checkbox trigger-choices__product-checkbox');
    product.type = 'checkbox';
    productLabel.append(product, element('span', null, caption));

    const toggle = element('button', 'trigger-choices__toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', `Триггеры продукта «${caption}»`);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(icon('chevron-down', 'trigger-choices__arrow'));
    const list = element('div', 'trigger-choices__values');
    const listId = `trigger-choices-${instance}-${index}`;
    list.id = listId;
    list.hidden = true;
    toggle.setAttribute('aria-controls', listId);
    toggle.addEventListener('click', () => {
      list.hidden = !list.hidden;
      toggle.setAttribute('aria-expanded', String(!list.hidden));
    });

    const inputs = new Map();
    const sync = () => {
      let count = 0;
      for (const [value, input] of inputs) {
        input.checked = chosen.has(value);
        if (input.checked) count += 1;
      }
      product.checked = count === values.length;
      product.indeterminate = count > 0 && count < values.length;
    };
    const notify = () => {
      sync();
      onChange(available.filter((value) => chosen.has(value)));
    };
    for (const value of values) {
      const option = element('label', 'control-popover__option');
      const input = element('input', 'control-popover__checkbox trigger-choices__value');
      input.type = 'checkbox';
      input.value = value;
      input.addEventListener('change', () => {
        if (input.checked) chosen.add(value);
        else chosen.delete(value);
        notify();
      });
      inputs.set(value, input);
      option.append(input, element('span', null, label('trigger', value)));
      list.append(option);
    }
    product.addEventListener('change', () => {
      for (const value of values) {
        if (product.checked) chosen.add(value);
        else chosen.delete(value);
      }
      notify();
    });
    sync();
    head.append(productLabel, toggle);
    group.append(head, list);
    choices.append(group);
  }
  return choices;
}
