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
import { copyButton } from '../components/copy-button.js';
import { dataImportControl, dataNoticeControl } from './data-import.js';
import { appUpdateControl } from './app-update.js';
import { segmented } from '../components/segmented.js';
import { triggerChoices } from '../components/trigger-choices.js';
import { filterPopover } from '../components/filter-popover.js';
import { bindPopover } from '../ui/popover.js';

/* J-26: дирекции скрыты в шапке; полный набор измерений расчётов сохраняется. */
const HEADER_DIMENSIONS = ['segment', 'role', 'product', 'trigger', 'os'];
/* Редкие фильтры — за кнопкой «Ещё фильтры»: на виду канал, период, сегмент, продукт и триггер. Выбранный редкий фильтр
   виден всегда — чипом, как остальные: активный срез не прячется */
const MORE_DIMENSIONS = ['role', 'os'];
/* Раскрыт ли список «Ещё фильтры»: шапка перерисовывается после каждого выбора, а список остаётся открытым */
let moreOpen = false;

/* J-45: подпись «Канал» видна, а не только в имени переключателя — сразу понятно, что выбран канал и что его можно сменить */
export function renderChannels(channels, state, label, onChange) {
  const wrap = element('div', 'channel-switch');
  const caption = element('span', 'channel-switch__label', 'Канал');
  caption.setAttribute('aria-hidden', 'true');
  wrap.append(caption, segmented({
    label: 'Канал',
    options: channels.map((channel) => ({ value: channel, label: channel, title: label(CHANNEL_DIMENSION, channel) })),
    selected: state.channel,
    onSelect: onChange,
    size: 'lg',
  }));
  return wrap;
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
  if (!selected.length) caption.textContent = dimension.allCaption;
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

/* J-115: «С кэшбеком» сужает все расчёты, как фильтр (J-21, J-103); переключатель — в настройках шапки, не в строке фильтров */
function cashbackSwitch(state, onCashbackChange) {
  const item = element('label', 'filters__item filters__switch');
  const input = element('input', 'filters__switch-input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.dataset.action = 'cashback';
  input.checked = state.includeCashback !== false;
  input.addEventListener('change', () => onCashbackChange?.(input.checked));
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
  const sync = () => {
    button.setAttribute('aria-expanded', String(moreOpen));
    button.replaceChildren(element('span', 'filters__control-label', moreOpen ? 'Меньше фильтров' : 'Ещё фильтры'),
      icon('chevron-down', 'filters__more-icon'));
    for (const node of hidden) node.hidden = !moreOpen;
  };
  button.addEventListener('click', () => {
    moreOpen = !moreOpen;
    sync();
  });
  sync();
  return button;
}

/* J-174: `keys` — какие фильтры показать; страница ролей показывает только ОС (у АБМ). `more` — редкие фильтры за кнопкой */
function renderFilters(dimensions, state, label, onFilterChange, reference, onFiltersReset, { keys = HEADER_DIMENSIONS, more = MORE_DIMENSIONS } = {}) {
  const bar = element('div', 'filters');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Фильтры среза');
  const controls = keys.map((key) => dimensions.find((candidate) => candidate.key === key)).filter(Boolean);
  if (!controls.length) return null;
  const folded = [];
  controls.forEach((dimension, index) => {
    const nodes = [...(index ? [renderDivider()] : []), filterControl(dimension, state, label, onFilterChange, reference)];
    /* Редкий фильтр без выбора — за кнопкой; с выбором — чип на виду */
    if (more.includes(dimension.key) && !state.filters?.[dimension.key]?.length && controls.length > 1) folded.push(...nodes);
    bar.append(...nodes);
  });
  if (folded.length) bar.append(renderDivider(), moreFiltersButton(folded));
  const shown = keys.filter((key) => dimensions.some((candidate) => candidate.key === key));
  if (shown.some((key) => state.filters?.[key]?.length)) bar.append(resetFilters(onFiltersReset));
  return bar;
}

/* Настройки шапки — иконка-шестерёнка с popover: «С кэшбеком» по умолчанию включён, как раньше в строке фильтров */
function settingsControl(state, onCashbackChange) {
  const item = element('div', 'shell-head__action shell-head__settings');
  const trigger = element('button', 'shell-head__button shell-head__button--icon');
  trigger.type = 'button';
  trigger.dataset.action = 'settings';
  trigger.setAttribute('aria-label', 'Настройки расчёта');
  trigger.title = 'Настройки расчёта';
  trigger.append(icon('settings', 'shell-head__icon'));
  const panel = element('div', 'control-popover glass shell-head__settings-popover');
  panel.id = 'settings-popover';
  panel.setAttribute('aria-label', 'Настройки расчёта');
  panel.append(element('h2', 'control-popover__title', 'Настройки расчёта'), cashbackSwitch(state, onCashbackChange),
    element('p', 'shell-head__settings-note', 'Выключите, чтобы считать VOC без оценок по операциям с кэшбеком.'));
  item.append(trigger, panel);
  bindPopover(item, trigger, panel);
  return item;
}

/*
  J-44: ссылка на срез — текущий адрес: канал, период, фильтры и выбор уже живут в URL (url-state.js).
  Срез — вся страница, поэтому кнопка — в строке управления шапки справа, вида кнопки «Обновить данные»;
  под фильтрами у карточек метрик она читалась ссылкой на эти карточки. J-203: квадратная иконка 40×40 —
  с подписью она отнимала место у фильтров АБМ; действие — в доступном имени и подсказке
*/
export function copyLinkControl(copy) {
  const item = copyButton({
    label: 'Скопировать ссылку на срез',
    iconName: 'link',
    iconClass: 'shell-head__icon',
    className: 'shell-head__button shell-head__button--icon',
    text: () => location.href,
    ...(copy ? { copy } : {}),
  });
  item.classList.add('shell-head__action', 'shell-head__link');
  const button = item.querySelector('.shell-head__button');
  button.dataset.action = 'copy-link';
  return item;
}

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
    toolbar = null,
  } = context;

  const head = element('header', 'shell-head');
  /* Новая версия приложения — строкой над шапкой: в строке фильтров на 1280 места нет, а появляется она редко */
  const appUpdate = appUpdateControl();
  if (appUpdate) head.append(appUpdate);
  /* Confluence: новые данные или нужен вход — той же строкой */
  const dataNotice = dataNoticeControl();
  if (dataNotice) head.append(dataNotice);

  const bar = element('div', 'shell-head__bar');
  bar.append(renderChannels(channels, state, label, onChannelChange));
  /* Период — тот же разрешённый период, по которому считают карточки: иначе шапка и цифры расходятся */
  bar.append(renderPeriod(period, manifest.period, onPeriodChange));
  if (!slim) {
    const filters = renderFilters(dimensions, state, label, onFilterChange, reference, onFiltersReset);
    if (filters) bar.append(filters);
  } else {
    /* J-174: на странице ролей из фильтров — только ОС, она есть лишь у АБМ; за кнопку её не прячем */
    const osFilter = renderFilters(dimensions, state, label, onFilterChange, reference, onFiltersReset, { keys: ['os'], more: [] });
    if (osFilter) bar.append(osFilter);
  }
  /* Ссылка на срез — про всю страницу, как переключатели над данными. С макетом дизайнера 11.11 — в строке действий
     над панелью, без неё (тесты, пустое приложение) — справа в строке шапки. На странице ролей её нет (J-168) */
  const link = slim ? null : copyLinkControl();
  if (toolbar) toolbar.replaceChildren(...(link ? [link] : []));
  else if (link) bar.append(link);
  /* Настройки расчёта: «С кэшбеком» — не фильтр среза, а правило подсчёта; на странице ролей не действует (J-168) */
  if (!slim) bar.append(settingsControl(state, onCashbackChange));
  /* J-75: загрузка CSV — только в десктопном приложении, справа в строке шапки перед темой:
     в служебной строке места нет, она переносилась бы на вторую строку */
  const dataImport = dataImportControl();
  if (dataImport) bar.append(dataImport);
  /* J-115: тема — справа в строке шапки; данные выгрузки и методика — в боковом меню */
  bar.append(themeToggle());
  head.append(bar);

  /* J-65: база дельт всех карточек метрик — одной строкой под фильтрами, а не под каждой дельтой (было J-37) */
  if (comparedTo && !slim) {
    const meta = element('div', 'shell-head__meta');
    meta.append(element('span', 'shell-head__compared', bindShortWords(`Изменения в карточках метрик — к ${formatDayRange(comparedTo.from, comparedTo.to)}`)));
    head.append(meta);
  }

  /* Перерисовка шапки не выбрасывает фокус клавиатуры в начало страницы: он остаётся на фильтре, который менялся */
  const focused = host.contains(document.activeElement) ? document.activeElement : null;
  const focusedDimension = focused?.dataset.dimension ?? focused?.dataset.clears;
  const focusedCashback = focused?.dataset.action === 'cashback';
  const focusedReset = focused?.dataset.action === 'filters-reset';
  host.replaceChildren(head);
  /* После сброса кнопки нет: фокус — на первый фильтр, а не в начало страницы */
  if (focusedReset) head.querySelector('.filters:not(.filters--period) .filters__control')?.focus();
  else if (focusedCashback) {
    /* Переключатель живёт в popover настроек: после перерисовки он снова открыт, фокус на месте */
    head.querySelector('[data-action="settings"]')?.click();
    head.querySelector('[data-action="cashback"]')?.focus();
  }
  else if (focusedDimension) {
    [...head.querySelectorAll('.filters__control')].find((control) => control.dataset.dimension === focusedDimension)?.focus();
  }
}
