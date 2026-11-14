/*
  Каркас шапки: табы каналов, панель фильтров, источник данных и дата
  актуальности.

  Состав панели генерируется из доступных измерений (D-13), табы — из данных
  (D-01), подписи — через справочник с fallback на код (D-02).
*/

import { bindShortWords, formatCount, formatDayRange } from '../core/format.js';
import { themeToggle } from './theme.js';
import { CHANNEL_DIMENSION } from '../core/dimensions.js';
import { element, withFullLabel, withOverflowTitle } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { periodPicker } from '../components/period-picker.js';
import { dataImportControl, dataNoticeControl } from './data-import.js';
import { appUpdateControl } from './app-update.js';
import { segmented } from '../components/segmented.js';
import { triggerChoices } from '../components/trigger-choices.js';
import { filterPopover } from '../components/filter-popover.js';

/* J-26: дирекции скрыты в шапке; полный набор измерений расчётов сохраняется. */
/* Продукт убран (решение пользователя 14.11): он дублирует триггеры — триггер и так сгруппирован по продуктам в своём списке */
const HEADER_DIMENSIONS = ['segment', 'role', 'trigger', 'os'];
/* Редкие фильтры — за кнопкой «Ещё фильтры»: на виду канал, период, сегмент, продукт и триггер. Выбранный редкий фильтр
   виден всегда — чипом, как остальные: активный срез не прячется */
const MORE_DIMENSIONS = ['role', 'os'];
/* Раскрыт ли список «Ещё фильтры»: шапка перерисовывается после каждого выбора, а список остаётся открытым */
let moreOpen = false;

/* J-45: подпись «Канал» видна, а не только в имени переключателя — сразу понятно, что выбран канал и что его можно сменить */
export function renderChannels(channels, state, label, onChange) {
  return segmented({
    label: 'Канал',
    caption: 'Канал',
    options: channels.map((channel) => ({ value: channel, label: channel, title: label(CHANNEL_DIMENSION, channel) })),
    selected: state.channel,
    onSelect: onChange,
    size: 'lg',
  });
}

/*
  Разделитель декоративный: пустой и скрытый от screen reader. В макете внутри
  разделителей лежат подписи из другого состояния — их не переносим (V-04)
*/
function renderDivider() {
  const divider = element('span', 'filters__divider');
  divider.setAttribute('aria-hidden', 'true');
  return divider;
}

export function filterCaption(dimension, state, label) {
  const selected = state.filters?.[dimension.key] ?? [];
  const caption = element('span', 'filters__control-label');
  /* «Все …» тоже сжимается многоточием, когда строке не хватает места (раскрыты «Ещё фильтры») — полный текст в подсказке */
  if (!selected.length) {
    caption.textContent = dimension.allCaption;
    withOverflowTitle(caption);
  }
  else if (selected.length === 1) {
    const [value] = selected;
    caption.textContent = value;
    const full = label(dimension.key, value);
    /* Значение без кода (триггер, продукт) режется по ширине контрола — полный текст в подсказке */
    if (full === value) withOverflowTitle(caption);
    else withFullLabel(caption, full);
  } else caption.textContent = `${dimension.title}: ${formatCount(selected.length)}`;
  return caption;
}

function periodControl(period, manifestPeriod, onChange) {
  return periodPicker({
    id: 'period-popover',
    period,
    manifestPeriod,
    onChange,
    itemClass: 'filters__item',
    triggerClass: 'filters__control filters__control--period',
    iconClass: 'filters__calendar-icon',
  });
}

function filterControl(dimension, state, label, onChange, reference) {
  const item = element('div', 'filters__item');
  const selected = state.filters?.[dimension.key] ?? [];

  const trigger = element('button', 'filters__control');
  trigger.type = 'button';
  trigger.dataset.dimension = dimension.key;
  trigger.dataset.active = String(selected.length > 0);
  trigger.append(filterCaption(dimension, state, label));

  /* Крестик — после панели: с открытым списком Tab идёт от триггера в его dialog, а не на крестик */
  item.append(trigger);
  const { close } = filterPopover({
    item,
    trigger,
    id: `filter-${dimension.key}-popover`,
    optionId: `filter-${dimension.key}`,
    title: dimension.title,
    options: dimension.options,
    selected,
    optionLabel: (value) => label(dimension.key, value),
    choices: dimension.key === 'trigger'
      ? (onDraft) => triggerChoices({ options: dimension.options, selected, label, reference, channel: state.channel, onChange: onDraft })
      : null,
    returnFocus: true,
    onApply: (values) => onChange(dimension.key, values),
    onReset: () => onChange(dimension.key, []),
  });
  /* Выбранный фильтр — чип со значением и крестиком (R-34): крестик снимает фильтр, не открывая список */
  if (selected.length) {
    item.classList.add('filters__item--chip');
    const clear = element('button', 'filters__clear');
    clear.type = 'button';
    clear.dataset.clears = dimension.key;
    clear.setAttribute('aria-label', `Снять фильтр «${dimension.title}»`);
    clear.append(icon('close', 'filters__clear-icon'));
    clear.addEventListener('click', () => {
      close();
      onChange(dimension.key, []);
    });
    item.append(clear);
  }
  return item;
}

/* J-61: период — своя группа шапки, отдельно от фильтров разрезов: он задаёт время, а не срез */
function renderPeriod(period, manifestPeriod, onPeriodChange) {
  const group = element('div', 'filters filters--period');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Период');
  group.append(periodControl(period, manifestPeriod, onPeriodChange));
  return group;
}

/*
  J-115: «С кэшбеком» сужает все расчёты, как фильтр (J-21, J-103) — переключатель в конце строки фильтров. В кнопке
  настроек (J-230) его не находили: вернулся в строку, на виду
*/
function cashbackSwitch(state, onChange) {
  const item = element('label', 'filters__item filters__switch');
  const input = element('input', 'filters__switch-input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.dataset.action = 'cashback';
  input.checked = state.includeCashback !== false;
  input.addEventListener('change', () => onChange?.(input.checked));
  const track = element('span', 'filters__switch-track');
  track.setAttribute('aria-hidden', 'true');
  item.append(input, track, element('span', 'filters__switch-label', 'С кэшбеком'));
  return item;
}

/* J-128: «Сбросить фильтры» — только когда выбран хотя бы один фильтр среза; канал, период, кэшбек и выбор в блоках не трогает */
function resetFilters(onFiltersReset) {
  const reset = element('button', 'filters__reset', 'Сбросить фильтры');
  reset.type = 'button';
  reset.dataset.action = 'filters-reset';
  reset.addEventListener('click', () => onFiltersReset?.());
  return reset;
}

/* Кнопка раскрывает редкие фильтры в той же строке: у них те же списки и чипы, без вложенного popover */
function moreFiltersButton(hidden) {
  const button = element('button', 'filters__control filters__more');
  button.type = 'button';
  button.dataset.action = 'more-filters';
  /* Раскрытый список — только стрелка вверх: открытые фильтры сами показывают раскрытие, а подпись
     «Меньше фильтров» вместе с «С кэшбеком» не помещалась в строку на 1280 */
  const sync = () => {
    button.setAttribute('aria-expanded', String(moreOpen));
    button.classList.toggle('filters__more--open', moreOpen);
    if (moreOpen) {
      button.setAttribute('aria-label', 'Свернуть фильтры');
      button.title = 'Свернуть фильтры';
      button.replaceChildren(icon('chevron-down', 'filters__more-icon'));
    } else {
      button.removeAttribute('aria-label');
      button.removeAttribute('title');
      button.replaceChildren(element('span', 'filters__control-label', 'Ещё фильтры'), icon('chevron-down', 'filters__more-icon'));
    }
    for (const node of hidden) node.hidden = !moreOpen;
  };
  button.addEventListener('click', () => {
    moreOpen = !moreOpen;
    sync();
  });
  sync();
  return button;
}

/* J-174: `keys` — какие фильтры показать; страница ролей показывает только ОС (у АБМ) и без кэшбека (J-168).
   `more` — редкие фильтры за кнопкой; `onCashbackChange` — переключатель «С кэшбеком» в конце строки */
function renderFilters(dimensions, state, label, onFilterChange, reference, onFiltersReset, { keys = HEADER_DIMENSIONS, more = MORE_DIMENSIONS, cashback = true, onCashbackChange } = {}) {
  const bar = element('div', 'filters');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Фильтры среза');
  const controls = keys.map((key) => dimensions.find((candidate) => candidate.key === key)).filter(Boolean);
  if (!controls.length && !cashback) return null;
  const folded = [];
  controls.forEach((dimension, index) => {
    const nodes = [...(index ? [renderDivider()] : []), filterControl(dimension, state, label, onFilterChange, reference)];
    /* Редкий фильтр без выбора — за кнопкой; с выбором — чип на виду */
    if (more.includes(dimension.key) && !state.filters?.[dimension.key]?.length && controls.length > 1) folded.push(...nodes);
    bar.append(...nodes);
  });
  if (folded.length) bar.append(renderDivider(), moreFiltersButton(folded));
  if (cashback) bar.append(...(controls.length ? [renderDivider()] : []), cashbackSwitch(state, onCashbackChange));
  const shown = keys.filter((key) => dimensions.some((candidate) => candidate.key === key));
  if (shown.some((key) => state.filters?.[key]?.length)) bar.append(resetFilters(onFiltersReset));
  return bar;
}

/* Меняет соседей `kept`, не вынимая его: вынутый и вставленный узел теряет фокус и перезапускает CSS-анимацию */
function replaceAround(parent, kept, before, after) {
  if (kept.parentElement !== parent) {
    parent.replaceChildren(...before, kept, ...after);
    return;
  }
  for (const child of [...parent.childNodes]) if (child !== kept) child.remove();
  kept.before(...before);
  kept.after(...after);
}

const shells = new WeakMap();

/* Десктопное приложение без листов: фильтровать нечего, в шапке только источник данных, тема и следующий шаг */
export function renderEmptyHeader(host) {
  const head = element('header', 'shell-head');
  const appUpdate = appUpdateControl();
  if (appUpdate) head.append(appUpdate);
  const notice = dataNoticeControl();
  if (notice) head.append(notice);
  const bar = element('div', 'shell-head__bar');
  const dataImport = dataImportControl();
  if (dataImport) bar.append(dataImport);
  bar.append(themeToggle());
  head.append(bar);
  const meta = element('div', 'shell-head__meta');
  meta.append(element('span', null, 'Данные не загружены. Нажмите «Обновить данные».'));
  head.append(meta);
  host.replaceChildren(head);
}

export function renderHeader(host, context) {
  const {
    channels,
    dimensions,
    state,
    period,
    label,
    manifest,
    comparedTo = null,
    onChannelChange,
    onPeriodChange,
    onFilterChange,
    reference,
    onCashbackChange,
    onFiltersReset,
    slim = false,
  } = context;

  let shell = shells.get(host);
  if (!shell) {
    shell = { head: element('header', 'shell-head'), bar: element('div', 'shell-head__bar') };
    shells.set(host, shell);
  }
  const { head, bar } = shell;
  const headBefore = [];
  /* Новая версия приложения — строкой над шапкой: в строке фильтров на 1280 места нет, а появляется она редко */
  const appUpdate = appUpdateControl();
  if (appUpdate) headBefore.push(appUpdate);
  /* Confluence: новые данные или нужен вход — той же строкой */
  const dataNotice = dataNoticeControl();
  if (dataNotice) headBefore.push(dataNotice);

  const barBefore = [renderChannels(channels, state, label, onChannelChange)];
  /* Период — тот же разрешённый период, по которому считают карточки: иначе шапка и цифры расходятся */
  barBefore.push(renderPeriod(period, manifest.period, onPeriodChange));
  if (!slim) {
    const filters = renderFilters(dimensions, state, label, onFilterChange, reference, onFiltersReset, { onCashbackChange });
    if (filters) barBefore.push(filters);
  } else {
    /* J-174: на странице ролей из фильтров — только ОС, она есть лишь у АБМ; за кнопку её не прячем */
    const osFilter = renderFilters(dimensions, state, label, onFilterChange, reference, onFiltersReset, { keys: ['os'], more: [], cashback: false });
    if (osFilter) barBefore.push(osFilter);
  }
  const barAfter = [];
  /* J-75: загрузка CSV — только в десктопном приложении, справа в строке шапки перед темой:
     в служебной строке места нет, она переносилась бы на вторую строку */
  const dataImport = dataImportControl();
  if (dataImport) barAfter.push(dataImport);
  /* J-115: тема — справа в строке шапки; данные выгрузки и методика — в боковом меню */
  barAfter.push(themeToggle());

  const headAfter = [];
  /* J-65: база дельт всех карточек метрик — одной строкой под фильтрами, а не под каждой дельтой (было J-37) */
  if (comparedTo && !slim) {
    const meta = element('div', 'shell-head__meta');
    meta.append(element('span', 'shell-head__compared', bindShortWords(`Изменения в карточках метрик — к ${formatDayRange(comparedTo.from, comparedTo.to)}`)));
    headAfter.push(meta);
  }

  /* Перерисовка шапки не выбрасывает фокус клавиатуры в начало страницы: он остаётся на фильтре, который менялся */
  const focused = host.contains(document.activeElement) ? document.activeElement : null;
  const focusedDimension = focused?.dataset.dimension ?? focused?.dataset.clears;
  const focusedReset = focused?.dataset.action === 'filters-reset';
  const focusedCashback = focused?.dataset.action === 'cashback';
  bar.replaceChildren(...barBefore, ...barAfter);
  replaceAround(head, bar, headBefore, headAfter);
  if (head.parentElement !== host) host.replaceChildren(head);
  /* После сброса кнопки нет: фокус — на первый фильтр, а не в начало страницы */
  if (focusedReset) head.querySelector('.filters:not(.filters--period) .filters__control')?.focus();
  else if (focusedCashback) head.querySelector('[data-action="cashback"]')?.focus();
  else if (focusedDimension) {
    [...head.querySelectorAll('.filters__control')].find((control) => control.dataset.dimension === focusedDimension)?.focus();
  }
}
