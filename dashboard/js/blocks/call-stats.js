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
import { element, svgNode, withFullLabel } from '../ui/dom.js';

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

/*
  Ступени воронки (правка пользователя 17.11 — 1 в 1 как «Конверсия опроса» макета): подпись капсом сверху, внизу крупно
  доля от всех оценок (база 100 %, по убыванию), рядом второстепенно — доля от предыдущей ступени, под ними число
*/
const STEPS = {
  rated: { short: 'Оценки', full: 'Все оценки среза — база воронки, 100 %' },
  negative: { short: '1–3', full: 'Сниженные оценки — доля от всех оценок' },
  attempts: { short: 'Попытки звонка', full: 'Сниженные оценки с экспертизой УИУКО — доля от всех оценок, в скобках — от оценок 1–3' },
  success: { short: 'Успешные', full: 'Экспертиза с установленной причиной — доля от всех оценок, в скобках — от попыток' },
  failed: { short: 'Недозвон или отказ', full: 'Экспертиза «выявить / выяснить причину снижения не удалось» — доля от всех оценок, в скобках — от попыток' },
};
const RATINGS = ['оценка', 'оценки', 'оценок'];

function stepNode({ key, count, share, step }, className = '') {
  const { short, full } = STEPS[key];
  const item = element('li', `call-funnel__step call-funnel__step--${key}${className}`);
  item.title = full;
  const caption = element('span', 'call-funnel__label', short);
  caption.setAttribute('aria-hidden', 'true');
  const line = element('span', 'call-funnel__line');
  line.append(share === null ? emptyValue('нет базы') : element('span', 'call-funnel__value', formatShare(share)));
  if (step?.share !== null && step?.share !== undefined) line.append(element('span', 'call-funnel__step-share', `(${formatShare(step.share)} от ${step.of})`));
  const small = element('span', 'call-funnel__count', formatCount(count));
  small.append(element('span', 'visually-hidden', ` ${plural(count, RATINGS)}`));
  item.append(caption, element('span', 'visually-hidden', `${full}: `), line, small);
  return item;
}

/*
  Луч макета («поток · тело», Figma 5366:8608): один контур, размытый на 5, с радиальным градиентом от прозрачного у
  левого края через светло-серый к серому. Высота на ступени — её доля от всех оценок (форма соответствует реальности),
  не тоньше нити; между центрами колонок — плавный переход, после последней ступени — ровный хвост
*/
const FLOW = { width: 600, height: 145, pad: 10, thread: 0.45 };
function flowNode(steps) {
  const { width, height, pad, thread } = FLOW;
  const inner = height - 2 * pad;
  const mid = height / 2;
  const base = steps[0].count;
  const half = steps.map(({ count }) => Math.max(thread, base ? (inner * count) / base : 0) / 2);
  const centers = steps.map((_, index) => pad + ((index + 0.5) * (width - 2 * pad)) / steps.length);
  const edge = (sign) => {
    let path = '';
    for (let index = 1; index < steps.length; index += 1) {
      const [x0, x1] = [centers[index - 1], centers[index]];
      const cx = (x0 + x1) / 2;
      path += ` C${cx} ${mid + sign * half[index - 1]} ${cx} ${mid + sign * half[index]} ${x1} ${mid + sign * half[index]}`;
    }
    return path;
  };
  const last = steps.length - 1;
  let d = `M${pad} ${mid - half[0]} L${centers[0]} ${mid - half[0]}${edge(-1)} L${width - pad} ${mid - half[last]} L${width - pad} ${mid + half[last]} L${centers[last]} ${mid + half[last]}`;
  for (let index = last; index > 0; index -= 1) {
    const [x0, x1] = [centers[index], centers[index - 1]];
    const cx = (x0 + x1) / 2;
    d += ` C${cx} ${mid + half[index]} ${cx} ${mid + half[index - 1]} ${x1} ${mid + half[index - 1]}`;
  }
  d += ` L${pad} ${mid + half[0]} Z`;
  const svg = svgNode('svg', 'call-funnel__flow', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  const defs = svgNode('defs');
  const gradient = svgNode('radialGradient', null, { id: 'call-funnel-flow-fill', cx: 0, cy: 0, r: 1, gradientUnits: 'userSpaceOnUse', gradientTransform: `translate(${pad} ${mid}) scale(${width * 0.625} ${height * 2})` });
  gradient.append(svgNode('stop', 'call-funnel__flow-stop call-funnel__flow-stop--clear', { offset: 0 }),
    svgNode('stop', 'call-funnel__flow-stop call-funnel__flow-stop--mid', { offset: 0.43 }),
    svgNode('stop', 'call-funnel__flow-stop', { offset: 1 }));
  const blur = svgNode('filter', null, { id: 'call-funnel-flow-blur', x: 0, y: 0, width: width, height: height, filterUnits: 'userSpaceOnUse' });
  blur.append(svgNode('feGaussianBlur', null, { stdDeviation: 5 }));
  defs.append(gradient, blur);
  svg.append(defs, svgNode('path', 'call-funnel__flow-body', { d, fill: 'url(#call-funnel-flow-fill)', filter: 'url(#call-funnel-flow-blur)' }));
  return svg;
}

function funnelNode(month) {
  const { steps, branch } = callFunnel(month);
  const layout = element('div', 'call-funnel');
  const list = element('ol', 'call-funnel__steps');
  list.setAttribute('role', 'list');
  list.append(...steps.map((step) => stepNode(step)), stepNode(branch, ' call-funnel__step--branch'));
  layout.append(flowNode(steps), list);
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
