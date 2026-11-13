import { EMPTY, ERROR, LOADING } from '../shell/block.js';
import { detailEventChip } from '../components/detail-event-chip.js';
import { driverChip } from '../components/driver-chip.js';
import { driverRows } from '../state/driver-pick.js';
import { triggerChoices } from '../components/trigger-choices.js';
import { tag } from '../components/tag.js';
import { emptyValue } from '../components/empty-value.js';
import { element, withFullLabel } from '../ui/dom.js';
import { copyButton } from '../components/copy-button.js';
import { detailRows } from '../state/detail-event.js';
import { formatCount, formatDate, quoted } from '../core/format.js';
import { icon } from '../ui/icons.js';
import { filterPopover } from '../components/filter-popover.js';
import { pagingButtons } from '../components/paging.js';
import { searchField } from '../components/search-field.js';
import { hScroll } from '../components/h-scroll.js';
import { emptyTableRow, statusPanel } from '../components/status-panel.js';
import {
  buildVerbatimRows,
  filterVerbatimRows,
  searchVerbatimRows,
  verbatimFilterOptions,
} from '../core/verbatim.js';

const NONE = '—';
const PAGE_SIZE = 20;
let tableQuery = '';
let tableFilters = {};

const joined = (values = []) => values.length ? values.join(' · ') : NONE;

/* Порядок и состав — J-21; `filter` — ключ фильтра по значению из verbatim.js. */
const COLUMNS = [
  { key: 'date', label: 'Дата', text: (row) => formatDate(row.date) },
  { key: 'segment', label: 'Сегмент', filter: 'segment', text: (row) => row.segment ?? NONE },
  { key: 'role', label: 'Роль', filter: 'role', text: (row) => row.role ?? NONE },
  { key: 'cps', label: 'Дирекция', filter: 'cps', text: (row) => joined(row.cps) },
  { key: 'products', label: 'Продукт', filter: 'products', text: (row) => joined(row.products) },
  { key: 'triggers', label: 'Триггер', filter: 'triggers', text: (row) => joined(row.triggers) },
  { key: 'categoryGroup', label: 'ДКО: группа негатива', full: 'Группа категорий основного негатива', filter: 'categoryGroup', text: (row) => row.categoryGroup ?? NONE },
  { key: 'category', label: 'ДКО: категория негатива', full: 'Категория основного негатива', filter: 'category', text: (row) => row.category ?? NONE },
  { key: 'os', label: 'ОС', full: 'Операционная система', filter: 'os', text: (row) => row.os ?? NONE },
  { key: 'appVersion', label: 'Версия приложения', filter: 'appVersion', text: (row) => row.appVersion ?? NONE },
  { key: 'rating', label: 'Оценка', filter: 'rating', text: (row) => String(row.rating) },
  { key: 'comment', label: 'Комментарий', text: (row) => row.comment ?? NONE },
  { key: 'expertise', label: 'Экспертиза УИУКО', full: 'Разбор обращения сотрудником банка, не слова клиента', text: (row) => row.expertise ?? NONE },
  { key: 'domain', label: 'ФО', full: 'Функциональная область', filter: 'domain', text: (row) => row.domain ?? NONE },
  { key: 'problemType', label: 'Тип проблемы', filter: 'problemType', text: (row) => row.problemType ?? NONE },
  { key: 'problem', label: 'Проблема', filter: 'problem', text: (row) => row.problem ?? NONE },
];

export const COLUMN_LABELS = COLUMNS.map(({ label }) => label);

/* J-26: дирекция скрыта, остальные пустые столбцы сохраняются; версия только у АБМ. */
export function visibleColumns(rows, channel = rows.find((row) => row.channel)?.channel) {
  return COLUMNS.filter((column) => column.key !== 'cps' && (column.key !== 'appVersion' || channel === 'АБМ'));
}

/* Popover живёт вне scroll-контейнера таблицы, иначе его обрезает overflow: встаёт под своим заголовком, не выходя за карточку и окно */
export function popoverOffset(trigger, host, panelWidth, viewportWidth) {
  const box = trigger.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  const right = Math.min(hostBox.width, viewportWidth - hostBox.left);
  return { x: Math.max(0, Math.min(box.left - hostBox.left, right - panelWidth)), y: box.bottom - hostBox.top };
}

function placePopover(panel, trigger, host) {
  const { x, y } = popoverOffset(trigger, host, panel.offsetWidth, document.documentElement?.clientWidth ?? Infinity);
  panel.style.setProperty('--popover-x', `${x}px`);
  panel.style.setProperty('--popover-y', `${y}px`);
}

const PANEL_FOCUSABLE = '.control-popover__checkbox, .control-popover__reset, .control-popover__apply';

/* Panel стоит в DOM до таблицы: фокус входит в него при открытии, а Tab за край возвращает к заголовку */
function keepFocusAround(panel, trigger) {
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = panel.querySelectorAll(PANEL_FOCUSABLE);
    const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
    if (document.activeElement !== edge) return;
    event.preventDefault();
    trigger.focus();
  });
}

/* Заголовок колонки — сам фильтр (как фильтры шапки): подпись, число выбранных и стрелка; выбор — чекбоксами */
function filterHeader(column, options, host, onChange, context) {
  const selected = tableFilters[column.filter] ?? [];
  const trigger = element('button', 'verbatim-head__trigger');
  trigger.type = 'button';
  trigger.dataset.filter = column.filter;
  trigger.dataset.active = String(selected.length > 0);
  /* J-43: сокращение в заголовке — расшифровка в подсказке и в имени кнопки */
  const named = column.full ? `${column.label} — ${column.full}` : column.label;
  if (column.full) trigger.title = named;
  trigger.setAttribute('aria-label', `Фильтр: ${named}${selected.length ? `, выбрано ${formatCount(selected.length)}` : ''}`);
  trigger.append(element('span', 'verbatim-head__label', column.label));
  if (selected.length) trigger.append(element('span', 'verbatim-head__count', formatCount(selected.length)));
  trigger.append(icon('chevron-down', 'verbatim-head__icon'));

  const cell = element('span', 'verbatim-head');
  cell.append(trigger);
  /* Panel — вне ячейки: таблица прокручивается по горизонтали; фокус после выбора ставит перерисовка заголовка */
  const { panel, close } = filterPopover({
    item: cell,
    trigger,
    id: `verbatim-filter-${column.filter}`,
    title: column.label,
    options,
    selected,
    choices: column.filter === 'triggers'
      ? (onDraft) => triggerChoices({ options, selected, label: context.label, reference: context.reference, channel: context.state.channel ?? context.slice[0]?.channel, onChange: onDraft })
      : null,
    className: 'verbatim-popover',
    inline: false,
    onApply: (values) => onChange(column.filter, values),
    onReset: () => onChange(column.filter, []),
  });
  /* После bindPopover: panel уже открыт и измеряется, у скрытого ширина 0 */
  trigger.addEventListener('click', () => {
    if (panel.hidden) return;
    placePopover(panel, trigger, host);
    panel.querySelector(PANEL_FOCUSABLE)?.focus();
  });
  keepFocusAround(panel, trigger);
  return { cell, panel, trigger, close };
}

function tableHead(columns, rows, host, onFilter, context) {
  const head = element('thead');
  const titles = element('tr');
  const panels = [];
  const closers = [];
  const triggers = new Map();
  for (const column of columns) {
    const th = element('th', `verbatim-table__col--${column.key}`);
    if (column.filter) {
      const { cell, panel, trigger, close } = filterHeader(column, verbatimFilterOptions(rows, column.filter), host, onFilter, context);
      th.append(cell);
      panels.push(panel);
      closers.push(close);
      triggers.set(column.filter, trigger);
    } else th.append(withFullLabel(element('span', null, column.label), column.full));
    titles.append(th);
  }
  head.append(titles);
  return { head, panels, triggers, closers };
}

/*
  J-44: отзыв с контекстом для письма или чата — цитата, затем признаки строки через « · »
  (ui-texts §10). Пустые признаки не копируются; экспертиза — отдельной строкой, это не слова клиента
*/
export function reviewText(item, label, columns = COLUMNS) {
  const value = (column) => {
    const text = column.text(item);
    return column.key === 'segment' && item.segment ? `${text} (${label('segment', item.segment)})` : text;
  };
  const context = columns
    .filter(({ key }) => key !== 'comment' && key !== 'expertise')
    .map((column) => [column.label, value(column)])
    .filter(([, text]) => text && text !== NONE)
    .map(([name, text]) => `${name}: ${text}`);
  const expertise = columns.some(({ key }) => key === 'expertise') && item.expertise ? `Экспертиза УИУКО: ${item.expertise}` : null;
  return [item.comment ? quoted(item.comment) : null, context.join(' · '), expertise].filter(Boolean).join('\n');
}

export function tableRow(item, label, columns = COLUMNS) {
  const row = element('tr');
  for (const column of columns) {
    const cell = row.appendChild(element('td'));
    const text = column.text(item);
    const tagged = column.key === 'category' && item.category;
    /* Тон тега — у карточки по изменению доли; у строки его нет, поэтому нейтральный */
    if (tagged) cell.append(tag(text, 'neutral'));
    else if (text === NONE) cell.append(emptyValue());
    else cell.textContent = text;
    if (column.key === 'segment' && item.segment) withFullLabel(cell, label('segment', item.segment));
    if (column.key === 'comment' || column.key === 'expertise') {
      cell.className = `verbatim-table__text verbatim-table__text--${column.key}`;
      if (text !== NONE) cell.title = text;
    }
    if (column.key === 'comment') {
      cell.append(copyButton({
        /* Имя называет строку: screen reader не слышит двадцать одинаковых кнопок */
        label: `Скопировать отзыв с контекстом: ${[formatDate(item.date), item.segment].filter(Boolean).join(', ')}`,
        className: 'verbatim-table__copy',
        iconName: 'copy',
        text: () => reviewText(item, label, columns),
      }));
    }
  }
  return row;
}

export function tableCounter(shown, total) {
  return `Показано ${formatCount(Math.min(shown, total))} из ${formatCount(total)}`;
}

/* Выбор, которого нет в новой выборке (сменили канал или период), снимается: иначе таблица пуста без видимой причины */
function keepReachableFilters(rows, columns) {
  const visible = new Set(columns.map(({ filter }) => filter).filter(Boolean));
  tableFilters = Object.fromEntries(Object.entries(tableFilters)
    .filter(([key]) => visible.has(key))
    .map(([key, values]) => [key, values.filter((value) => verbatimFilterOptions(rows, key).includes(value))])
    .filter(([, values]) => values.length));
}

/* Поиск появляется вместе с данными: введённое во время загрузки потерялось бы при перерисовке */
/* J-49: день с графика таблицу не сужает; событие календаря — сужает до своих дней (J-21) */
export function renderVerbatimTable(block, context) {
  const { detailEvent, driver } = context.state;
  const chips = () => [detailEventChip(context), driverChip(context)].filter(Boolean);
  block.setHead({ controls: chips() });
  if (context.slice.length === 0 && !detailEvent) {
    block.setState(EMPTY);
    return;
  }
  /* J-128: выбор в антидрайверах сужает таблицу так же, как «Топ проблем»; чип в шапке снимает его */
  const rows = driverRows(detailRows(context), driver, context.reference);
  if (context.verbatim.status === 'idle') context.requestVerbatim();
  if (context.verbatim.status === 'idle' || context.verbatim.status === 'loading') {
    block.setState(LOADING);
    return;
  }
  if (context.verbatim.status === 'error') {
    block.setState(ERROR, context.verbatim.error);
    return;
  }

  const allRows = buildVerbatimRows(rows, context.verbatim.data, context.reference);
  if (!allRows.length) {
    block.setContent(statusPanel('verbatim-detail__none', {
      title: detailEvent || driver ? 'По выбранному событию или антидрайверу нет комментариев и экспертизы'
        : 'В выбранном срезе нет комментариев и экспертизы',
    }));
    return;
  }
  const columns = visibleColumns(allRows, context.state.channel);
  keepReachableFilters(allRows, columns);
  const { field: search, input } = searchField({
    className: 'verbatim-search', inputClass: 'verbatim-search__input', label: 'Поиск по прямой речи', placeholder: 'Поиск…', value: tableQuery,
    onInput: (value) => {
      tableQuery = value;
      shown = PAGE_SIZE;
      paint();
    },
  });
  block.setHead({ controls: [...chips(), search] });

  const wrap = element('div', 'verbatim-detail');
  const bar = element('div', 'verbatim-detail__bar');
  const status = element('p', 'verbatim-detail__status');
  status.setAttribute('tabindex', '-1');
  const reset = element('button', 'verbatim-detail__reset', 'Сбросить фильтры');
  reset.type = 'button';
  bar.append(status, reset);
  const popovers = element('div', 'verbatim-detail__popovers');
  const table = element('table', 'verbatim-table');
  const scroll = hScroll(table, { label: 'Таблица детализации' });
  const body = element('tbody');
  const paging = element('div', 'verbatim-detail__paging');
  let shown = PAGE_SIZE;
  let closeAll = () => {};

  function paintHead() {
    const { head, panels, triggers, closers } = tableHead(columns, allRows, wrap, (key, values) => {
      tableFilters = { ...tableFilters, [key]: values };
      shown = PAGE_SIZE;
      paintHead().get(key)?.focus();
      paint();
    }, context);
    table.replaceChildren(head, body);
    popovers.replaceChildren(...panels);
    closeAll = () => closers.forEach((close) => close());
    return triggers;
  }

  function paint() {
    const found = searchVerbatimRows(filterVerbatimRows(allRows, tableFilters), tableQuery, context.label);
    body.replaceChildren(...found.slice(0, shown).map((item) => tableRow(item, context.label, columns)));
    status.textContent = tableCounter(shown, found.length);
    reset.hidden = !Object.values(tableFilters).some((values) => values.length);
    /* Последняя порция прячет кнопку под фокусом: фокус — на счётчик строк, как у антидрайверов */
    paging.replaceChildren(...pagingButtons({
      shown, total: found.length, page: PAGE_SIZE, collapsible: false,
      onMore: () => {
        shown += PAGE_SIZE;
        paint();
        return paging.querySelector('.paging-button') ?? status;
      },
    }));
    paging.hidden = !paging.children.length;
    if (!found.length) body.append(emptyTableRow(columns.length, 'Нет строк по поиску и фильтрам', 'verbatim-table__empty'));
  }

  reset.addEventListener('click', () => {
    tableFilters = {};
    shown = PAGE_SIZE;
    paintHead();
    paint();
    input.focus();
  });
  /* Горизонтальная прокрутка уводит заголовок из-под открытого popover — он закрывается */
  scroll.addEventListener('scroll', () => closeAll());
  wrap.append(bar, popovers, scroll, paging);
  paintHead();
  paint();
  block.setContent(wrap);
}
