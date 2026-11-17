/*
  Статистика обзвона — «Для аналитика», над таблицей прямой речи (неделя 16–22.11). Срез и период — шапки дашборда;
  экспертиза — из lazy `verbatim`, как у таблицы прямой речи. Расчёт — `core/call-stats.js`.
  Вид (правка пользователя: «числа друг за другом — сложно понять логику»): воронка выбранного месяца лучом «Конверсии
  опроса» — оценки → 1–3 → попытки → успешные, крупно доля от предыдущей ступени; недозвон или отказ — приглушённым
  ответвлением от попыток. Справа — столбики по месяцам (попытки от 1–3, успешные от попыток), клик выбирает месяц.
  Точные числа — таблица под «Подробнее». Цвет нейтральный: заливкой подсвечиваются только VOC и урон
*/

import { EMPTY, ERROR, LOADING } from '../shell/block.js';
import { emptyValue } from '../components/empty-value.js';
import { hScroll } from '../components/h-scroll.js';
import { legendItem, legendList } from '../components/legend.js';
import { CALL_COLUMNS, callFunnel, callStats, defaultCallMonth } from '../core/call-stats.js';
import { earliestDate, latestDate } from '../core/dates.js';
import { MONTHS, formatCount, formatDate, formatShare, monthName, plural } from '../core/format.js';
import { element, withFullLabel } from '../ui/dom.js';
import { BEAM_HEADROOM, beamNode, flowHeight } from './conversion.js';

/* Выбранный месяц воронки — до закрытия страницы; нет его в периоде — последний полный (`defaultCallMonth`) */
let selectedMonth = null;

/* Звонка в выгрузке нет: подсказка шапки и строка под таблицей называют приближение */
export const CALL_NOTE = 'Поля «звонок» в выгрузке нет: попытка — сниженная оценка с экспертизой УИУКО, '
  + 'недозвон и отказ одной фразой экспертизы не различить.';

const capitalized = (text) => text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);
const shortDate = (iso) => formatDate(iso).slice(0, 5);

/** Подпись месяца: «Ноябрь 2026», незаконченный — «Ноябрь 2026 · по 16.11», начатый с середины — «· с 05.10». */
export function monthLabel({ month, from, to, partial }) {
  const name = `${capitalized(monthName(month))} ${month.slice(0, 4)}`;
  if (!partial) return name;
  const edges = [from.slice(8) !== '01' ? `с ${shortDate(from)}` : null, to < monthLast(month) ? `по ${shortDate(to)}` : null];
  return [name, ...edges.filter(Boolean)].join(' · ');
}

function monthLast(month) {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
}

function cell(column, values) {
  const td = element('td', column.share ? 'call-stats__share' : null);
  const value = values[column.key];
  if (!column.share) td.textContent = formatCount(value);
  else td.append(value === null ? emptyValue('нет базы') : formatShare(value));
  return td;
}

function headCell(column) {
  const th = element('th', column.share ? 'call-stats__share' : null, column.label);
  th.scope = 'col';
  return withFullLabel(th, column.full);
}

function bodyRow(name, values, className) {
  const row = element('tr', className);
  const title = element('th', 'call-stats__month', name);
  title.scope = 'row';
  row.append(title, ...CALL_COLUMNS.map((column) => cell(column, values)));
  return row;
}

function statsTable({ months, total }) {
  const table = element('table', 'call-stats');
  const head = element('tr');
  const month = element('th', 'call-stats__month', 'Месяц');
  month.scope = 'col';
  head.append(month, ...CALL_COLUMNS.map(headCell));
  const thead = element('thead');
  thead.append(head);
  const body = element('tbody');
  body.append(...months.map((item) => bodyRow(monthLabel(item), item)));
  /* Итог — только когда месяцев больше одного: иначе он повторяет строку */
  if (months.length > 1) body.append(bodyRow('Итого за период', total, 'call-stats__total'));
  table.append(thead, body);
  return table;
}

/* Ступени воронки: подпись капсом, крупно доля от предыдущей ступени, мелко число; полное — в подсказке и доступном имени */
const STEPS = {
  rated: { short: 'Оценки', full: 'Все оценки среза — база воронки' },
  negative: { short: '1–3', full: 'Сниженные оценки — доля от всех оценок' },
  attempts: { short: 'Попытки звонка', full: 'Сниженные оценки с экспертизой УИУКО — доля от оценок 1–3' },
  success: { short: 'Успешные', full: 'Экспертиза с установленной причиной — доля от попыток' },
  failed: { short: 'Недозвон или отказ', full: 'Экспертиза «выявить / выяснить причину снижения не удалось» — доля от попыток' },
};
const RATINGS = ['оценка', 'оценки', 'оценок'];
/* Колонки луча — четыре ступени поровну; ответвление стоит пятой колонкой вне луча (call-stats.css) */
const FUNNEL_COLUMNS = [1, 1, 1, 1];
/* Поток проявляется у левого края и к хвосту светлеет — как узкая «Конверсия опроса» */
const FUNNEL_KEYS = [[0, 0], [0.12, 0.8], [0.55, 0.65], [0.85, 0.6], [1, 0.3]];
/*
  Ширина полосы — от оценок 1–3, а не от всех оценок: сниженных единицы процентов, и от всех оценок обзвон сжался бы в
  нить сразу за базой. Оценки — широкий контекст, как MAU и опрос у «Конверсии опроса»; доля 1–3 названа числом
*/
const CONTEXT_HEIGHT = 1.05;

function stepNode({ key, count, share }, className = '') {
  const { short, full } = STEPS[key];
  const item = element('li', `call-funnel__step call-funnel__step--${key}${className}`);
  item.title = full;
  const caption = element('span', 'call-funnel__label', short);
  caption.setAttribute('aria-hidden', 'true');
  const value = share === null ? emptyValue('нет базы') : element('span', 'call-funnel__value', formatShare(share));
  const small = element('span', 'call-funnel__count', formatCount(count));
  small.append(element('span', 'visually-hidden', ` ${plural(count, RATINGS)}`));
  item.append(caption, element('span', 'visually-hidden', `${full}: `), value, small);
  return item;
}

function funnelNode(month) {
  const { steps, branch } = callFunnel(month);
  const layout = element('div', 'call-funnel');
  layout.style.setProperty('--beam-headroom', BEAM_HEADROOM);
  const negative = steps.find(({ key }) => key === 'negative').count;
  const heights = steps.map(({ key, count }) => (key === 'rated' ? CONTEXT_HEIGHT : flowHeight(count, negative)));
  const beam = beamNode(steps, true, { heights, columns: FUNNEL_COLUMNS, keys: FUNNEL_KEYS, threadFrom: 'success', id: 'call-funnel-beam' });
  const list = element('ol', 'call-funnel__steps');
  list.setAttribute('role', 'list');
  list.append(...steps.map((step) => stepNode(step)), stepNode(branch, ' call-funnel__step--branch'));
  layout.append(beam, list);
  return layout;
}

const shortMonth = (month) => MONTHS[Number(month.month.slice(5, 7)) - 1];
const shareWord = (value) => (value === null ? 'нет базы' : formatShare(value));

/* Столбики по месяцам: попытки от 1–3 и успешные от попыток на одной шкале 0–100 %; месяц — кнопка выбора воронки */
function trendNode(months, chosen, onChoose) {
  const wrap = element('div', 'call-trend');
  wrap.append(legendList([legendItem('Попытки от 1–3', 'faint', 'bar'), legendItem('Успешные от попыток', 'quiet', 'bar')], 'call-trend__legend'));
  const bars = element('div', 'call-trend__months');
  bars.setAttribute('role', 'group');
  bars.setAttribute('aria-label', 'Месяц воронки');
  for (const month of months) {
    const button = element('button', 'call-trend__month');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(month.month === chosen));
    const label = `${monthLabel(month)}: попытки от 1–3 — ${shareWord(month.attemptShare)}, успешные от попыток — ${shareWord(month.successShare)}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    const pair = element('span', 'call-trend__pair');
    for (const [key, value] of [['attempts', month.attemptShare], ['success', month.successShare]]) {
      const bar = element('span', `call-trend__bar call-trend__bar--${key}`);
      bar.style.setProperty('--bar', (value ?? 0) / 100);
      pair.append(bar);
    }
    const name = element('span', 'call-trend__name', shortMonth(month));
    const edge = month.partial && month.to < monthLast(month.month) ? element('span', 'call-trend__edge', `по ${shortDate(month.to)}`) : null;
    button.append(pair, name);
    if (edge) button.append(edge);
    button.addEventListener('click', () => onChoose(month.month));
    bars.append(button);
  }
  wrap.append(bars);
  return wrap;
}

/* Раскрытая таблица остаётся раскрытой при выборе другого месяца: перерисовка не сворачивает её */
let detailsOpen = false;

function detailsNode(stats) {
  const details = element('details', 'call-stats__details');
  details.open = detailsOpen;
  details.addEventListener('toggle', () => { detailsOpen = details.open; });
  details.append(element('summary', 'call-stats__summary', 'Подробнее по месяцам'), hScroll(statsTable(stats), { label: 'Статистика обзвона' }));
  return details;
}

export function renderCallStats(block, context) {
  block.setHead();
  if (context.slice.length === 0) {
    block.setState(EMPTY);
    return;
  }
  if (context.verbatim.status === 'idle') context.requestVerbatim();
  if (context.verbatim.status === 'idle' || context.verbatim.status === 'loading') {
    block.setState(LOADING);
    return;
  }
  if (context.verbatim.status === 'error') {
    block.setState(ERROR, context.verbatim.error);
    return;
  }
  const stats = callStats(context.slice, context.verbatim.data, context.period, { from: earliestDate(context.rows), to: latestDate(context.rows) });
  if (!stats.months.length) {
    block.setState(EMPTY);
    return;
  }
  const paint = () => {
    const chosen = stats.months.find(({ month }) => month === selectedMonth) ?? stats.months.find(({ month }) => month === defaultCallMonth(stats.months));
    block.setHead({ note: `за ${monthLabel(chosen).toLocaleLowerCase('ru')}` });
    const view = element('div', 'call-stats-view');
    const top = element('div', 'call-stats-view__top');
    top.append(funnelNode(chosen));
    /* Динамика — когда месяцев больше одного: один столбик выбирать не из чего */
    if (stats.months.length > 1) {
      top.append(trendNode(stats.months, chosen.month, (month) => {
        selectedMonth = month;
        paint().querySelector('.call-trend__month[aria-pressed="true"]')?.focus();
      }));
    }
    view.append(top, element('p', 'call-stats__note', CALL_NOTE), detailsNode(stats));
    block.setContent(view);
    return view;
  };
  paint();
}
