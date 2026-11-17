/* Общий список триггеров для шапки и фильтра колонки: продукт — только группа,
   в выбранные значения попадают сами доступные триггеры (J-21). */
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { searchField } from './search-field.js';

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

/*
  Список с группами: чекбокс группы выбирает все её значения, частичный выбор — indeterminate; группы раскрываются.
  `search` — поле поиска над списком: находит и по группе (группа видна целиком), и по значению (видны совпавшие,
  группа раскрыта); скрытые поиском значения выбор сохраняют. Шапка и фильтры колонок — триггеры по продуктам
  (triggerChoices), детализация — ещё категории ДКО по группам негатива
*/
export function groupedChoices({ groups, selected = [], legend, groupLabel = (key) => key, valueLabel = (value) => value, toggleLabel = (caption) => caption, search = null, onChange }) {
  const available = groups.flatMap(({ values }) => values);
  const chosen = new Set(selected.filter((value) => available.includes(value)));
  const choices = element('fieldset', 'control-popover__choices trigger-choices');
  choices.append(element('legend', 'visually-hidden', legend));
  const instance = ++nextInstance;
  const rows = [];

  for (const [index, { key, values }] of groups.entries()) {
    const caption = groupLabel(key);
    const group = element('div', 'trigger-choices__group');
    const head = element('div', 'trigger-choices__head');
    const productLabel = element('label', 'control-popover__option trigger-choices__product');
    const product = element('input', 'control-popover__checkbox trigger-choices__product-checkbox');
    product.type = 'checkbox';
    productLabel.append(product, element('span', null, caption));

    const toggle = element('button', 'trigger-choices__toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', toggleLabel(caption));
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(icon('chevron-down', 'trigger-choices__arrow'));
    const list = element('div', 'trigger-choices__values');
    const listId = `trigger-choices-${instance}-${index}`;
    list.id = listId;
    list.hidden = true;
    toggle.setAttribute('aria-controls', listId);
    const expand = (open) => {
      list.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => expand(list.hidden));

    const inputs = new Map();
    const options = new Map();
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
      options.set(value, option);
      option.append(input, element('span', null, valueLabel(value)));
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
    rows.push({ group, caption, values, options, expand });
  }

  if (search) {
    const needle = (text) => String(text ?? '').trim().toLocaleLowerCase('ru');
    const { field } = searchField({
      className: 'trigger-choices__search', inputClass: 'verbatim-search__input',
      label: search.label, placeholder: search.placeholder,
      onInput: (query) => {
        const found = needle(query);
        for (const { group, caption, values, options, expand } of rows) {
          const byGroup = !found || needle(caption).includes(found);
          const matched = values.filter((value) => byGroup || needle(valueLabel(value)).includes(found));
          group.hidden = matched.length === 0;
          for (const [value, option] of options) option.hidden = !byGroup && !matched.includes(value);
          /* Совпадение по значению раскрывает группу: иначе найденное не видно; пустой запрос — всё свёрнуто */
          expand(Boolean(found) && !byGroup && matched.length > 0);
        }
      },
    });
    /* Поле — сразу за legend: она остаётся первым потомком fieldset */
    choices.querySelector('legend').after(field);
  }
  return choices;
}

export function triggerChoices({ options, selected = [], label = (_, value) => value, reference, channel, onChange }) {
  const available = [...new Set(options)];
  return groupedChoices({
    groups: triggerGroups(available, reference, channel),
    selected,
    legend: 'Триггеры по продуктам',
    groupLabel: (key) => (key === UNGROUPED ? key : label('product', key)),
    valueLabel: (value) => label('trigger', value),
    toggleLabel: (caption) => `Триггеры продукта «${caption}»`,
    onChange,
  });
}
