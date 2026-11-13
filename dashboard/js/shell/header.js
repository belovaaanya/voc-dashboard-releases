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

/* J-26: дирекции скрыты в шапке; полный набор измерений расчётов сохраняется. */
const HEADER_DIMENSIONS = ['segment', 'role', 'product', 'trigger', 'os'];

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

/* J-115: «С кэшбеком» — переключатель в строке фильтров: он сужает все расчёты, как фильтр (J-21, J-103) */
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

/* J-174: `keys` — какие фильтры показать; страница ролей показывает только ОС (у АБМ) и без кэшбека */
function renderFilters(dimensions, state, label, onFilterChange, reference, onCashbackChange, onFiltersReset, { keys = HEADER_DIMENSIONS, cashback = true } = {}) {
  const bar = element('div', 'filters');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Фильтры среза');
  const controls = keys.map((key) => dimensions.find((candidate) => candidate.key === key)).filter(Boolean);
  if (!controls.length && !cashback) return null;
  controls.forEach((dimension, index) => {
    if (index) bar.append(renderDivider());
    bar.append(filterControl(dimension, state, label, onFilterChange, reference));
  });
  if (cashback) bar.append(renderDivider(), cashbackSwitch(state, onCashbackChange));
  const shown = keys.filter((key) => dimensions.some((candidate) => candidate.key === key));
  if (shown.some((key) => state.filters?.[key]?.length)) bar.append(resetFilters(onFiltersReset));
  return bar;
}

/* J-44: ссылка на срез — текущий адрес: канал, период, фильтры и выбор уже живут в URL (url-state.js) */
export function copyLinkControl(copy) {
  const item = copyButton({
    label: 'Скопировать ссылку на срез',
    done: 'Ссылка скопирована',
    className: 'chart-toggle',
    text: () => location.href,
    ...(copy ? { copy } : {}),
  });
  item.classList.add('shell-head__action');
  item.querySelector('.chart-toggle').dataset.action = 'copy-link';
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
  if (!slim) bar.append(renderFilters(dimensions, state, label, onFilterChange, reference, onCashbackChange, onFiltersReset));
  else {
    /* J-174: на странице ролей из фильтров — только ОС, она есть лишь у АБМ */
    const osFilter = renderFilters(dimensions, state, label, onFilterChange, reference, onCashbackChange, onFiltersReset, { keys: ['os'], cashback: false });
    if (osFilter) bar.append(osFilter);
  }
  /* J-75: загрузка CSV — только в десктопном приложении, справа в строке шапки перед темой:
     в служебной строке места нет, она переносилась бы на вторую строку */
  const dataImport = dataImportControl();
  if (dataImport) bar.append(dataImport);
  /* J-115: тема — справа в строке шапки; данные выгрузки и методика — в боковом меню */
  bar.append(themeToggle());
  head.append(bar);

  /* J-65: база дельт всех карточек метрик — одной строкой под фильтрами, а не под каждой дельтой (было J-37); ссылка на срез — справа в той же строке */
  const meta = element('div', 'shell-head__meta');
  if (comparedTo && !slim) meta.append(element('span', 'shell-head__compared', bindShortWords(`Изменения в карточках метрик — к ${formatDayRange(comparedTo.from, comparedTo.to)}`)));
  meta.append(copyLinkControl());
  if (!slim) head.append(meta);

  /* Перерисовка шапки не выбрасывает фокус клавиатуры в начало страницы: он остаётся на фильтре, который менялся */
  const focused = host.contains(document.activeElement) ? document.activeElement : null;
  const focusedDimension = focused?.dataset.dimension ?? focused?.dataset.clears;
  const focusedCashback = focused?.dataset.action === 'cashback';
  const focusedReset = focused?.dataset.action === 'filters-reset';
  host.replaceChildren(head);
  /* После сброса кнопки нет: фокус — на первый фильтр, а не в начало страницы */
  if (focusedReset) head.querySelector('.filters:not(.filters--period) .filters__control')?.focus();
  else if (focusedCashback) head.querySelector('[data-action="cashback"]')?.focus();
  else if (focusedDimension) {
    [...head.querySelectorAll('.filters__control')].find((control) => control.dataset.dimension === focusedDimension)?.focus();
  }
}
