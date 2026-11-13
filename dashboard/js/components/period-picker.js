/* Выбор периода: одна сборка для шапки дашборда и local period блока — preset, свой диапазон, сброс к общему */

import { PERIOD_PRESETS, periodForPreset, presetLabel, presetName, validateCustomPeriod } from '../state/controls.js';
import { element } from '../ui/dom.js';
import { formatDateRange } from '../core/format.js';
import { icon } from '../ui/icons.js';
import { bindPopover, popoverPanel } from '../ui/popover.js';

function dateField(name, labelText, value) {
  const label = element('label', 'control-popover__field');
  label.append(element('span', 'control-popover__field-label', labelText));
  const input = element('input', 'control-popover__date');
  input.type = 'date';
  input.name = name;
  input.required = true;
  input.value = value;
  label.append(input);
  return { label, input };
}

/**
 * `scope` и `onReset` — только у local period: имя блока в подписях и возврат к общему периоду.
 * `align: 'end'` раскрывает popover влево — для контрола у правого края карточки.
 */
function periodTrigger(period, scope, triggerClass, iconClass) {
  const trigger = element('button', triggerClass);
  trigger.type = 'button';
  const rangeLabel = element('span', 'filters__control-label');
  trigger.append(rangeLabel, icon('calendar', iconClass));
  const show = ({ from, to }) => {
    const range = formatDateRange(from, to);
    rangeLabel.textContent = range;
    trigger.setAttribute('aria-label', `${scope ? `Период блока «${scope}»` : 'Период'}: ${range}`);
  };
  show(period);
  return { trigger, show };
}

function presetButtons(period, manifestPeriod, choose) {
  const presets = element('div', 'control-popover__presets');
  for (const preset of PERIOD_PRESETS) {
    const button = element('button', 'control-popover__preset', presetLabel(preset.value, manifestPeriod));
    button.type = 'button';
    button.setAttribute('aria-label', presetName(preset.value, manifestPeriod));
    button.title = preset.kind;
    button.setAttribute('aria-pressed', String(period.preset === preset.value));
    button.addEventListener('click', () => choose(periodForPreset(preset.value, manifestPeriod)));
    presets.append(button);
  }
  return presets;
}

/* Свой диапазон: даты, ошибка проверки и «Применить»; «Как у дашборда» — только у local period */
function customRangeForm(period, { choose, onReset, close }) {
  const form = element('form', 'control-popover__custom');
  form.append(element('h3', 'control-popover__subtitle', 'Свой диапазон'));
  const fields = element('div', 'control-popover__fields');
  const from = dateField('from', 'Начало', period.from);
  const to = dateField('to', 'Конец', period.to);
  fields.append(from.label, to.label);
  form.append(fields);
  const error = element('p', 'control-popover__error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.append(error);
  const actions = element('div', 'control-popover__actions');
  if (onReset) {
    const reset = element('button', 'control-popover__reset', 'Как у дашборда');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      close();
      onReset();
    });
    actions.append(reset);
  }
  const apply = element('button', 'control-popover__apply', 'Применить');
  apply.type = 'submit';
  actions.append(apply);
  form.append(actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = validateCustomPeriod(from.input.value, to.input.value);
    error.textContent = result.error ?? '';
    error.hidden = !result.error;
    if (result.period) choose(result.period);
  });
  for (const input of [from.input, to.input]) {
    input.addEventListener('input', () => {
      error.hidden = true;
    });
  }
  return { form, from: from.input, to: to.input };
}

export function periodPicker({ id, period, manifestPeriod, onChange, onReset = null, scope = null, itemClass, triggerClass, iconClass, align = 'start', onPreviewReady }) {
  const item = element('div', itemClass);
  const { trigger, show } = periodTrigger(period, scope, triggerClass, iconClass);
  const panel = popoverPanel({ id, title: 'Период', label: scope ? `Выбор периода блока «${scope}»` : 'Выбор периода', className: 'control-popover--period', align });

  let close;
  const choose = (next) => {
    close();
    onChange(next);
  };
  const presets = presetButtons(period, manifestPeriod, choose);
  const custom = customRangeForm(period, { choose, onReset, close: () => close() });
  /* Preview таймлайна меняет представление и draft календаря, не URL и расчёт. */
  onPreviewReady?.((next) => {
    show(next);
    custom.from.value = next.from;
    custom.to.value = next.to;
    [...presets.children].forEach((button, index) => {
      button.setAttribute('aria-pressed', String(next.preset === PERIOD_PRESETS[index].value));
    });
  });
  panel.append(presets, custom.form);
  item.append(trigger, panel);
  close = bindPopover(item, trigger, panel);
  return item;
}
