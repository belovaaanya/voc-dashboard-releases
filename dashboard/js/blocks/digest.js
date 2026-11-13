/*
  J-151: VOC-дайджест — месяц канала по макету заказчика, собранный из готовых частей дашборда: число со стрелкой
  динамики и кольцом плана — как в карточках метрик, линия полугода — sparkline, доли и урон по месяцам — пилюли
  тепловой карты антидрайверов. Расчёт — `../digest.js`. Месяц и тема детализации живут в URL (`month`, `topic`).
*/
import { EMPTY } from '../shell/block.js';
import { segmented } from '../components/segmented.js';
import { sparkline } from '../components/sparkline.js';
import { chartDomain } from '../core/chart-geometry.js';
import { buildDigest, buildRoles, buildTopic, defaultMonth, monthsOf } from '../core/digest.js';
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { MONTHS, formatBucket, monthName, formatCount, formatImpact, formatShare, formatVoc, plural } from '../core/format.js';
import { roundImpact, roundVoc } from '../core/round.js';
import { DELTA_SHAPES, GROWTH, countNode, figureNode, leadNode, metaRowNode, planCaptionNode, planDotNode } from './metric-card.js';

const monthIndex = (month) => Number(month.slice(5, 7)) - 1;
export const monthTitle = (month) => `${capitalized(monthName(month))} ${month.slice(0, 4)}`;
const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const monthShort = (month) => formatBucket(`${month}-01`, 'month');
const percent = (share) => (share === null || share === undefined ? '—' : formatShare(share * 100));
const vocText = (value) => (value === null ? '—' : formatVoc(roundVoc(value)));

/* Дайджест месяца считается один раз на отрисовку страницы: шесть блоков читают один результат */
const cache = new WeakMap();
function digestOf(context) {
  const rows = context.channelRows;
  const month = selectedMonth(context);
  const key = JSON.stringify([context.state.channel, month]);
  const saved = cache.get(rows);
  if (saved?.key === key && saved.reference === context.reference) return saved.digest;
  const digest = month ? buildDigest({ rows, month, reference: context.reference, channel: context.state.channel }) : null;
  cache.set(rows, { key, reference: context.reference, digest });
  return digest;
}

/* J-176: месяц дайджеста — месяц конца периода шапки; своего выбора месяца у карточки нет */
export function selectedMonth(context) {
  const months = monthsOf(context.channelRows);
  const fromPeriod = context.period?.to?.slice(0, 7);
  if (months.includes(fromPeriod)) return fromPeriod;
  return months.includes(context.state.month) ? context.state.month : defaultMonth(context.channelRows);
}

function picker(label, options, selected, onChange) {
  const wrap = element('label', 'digest-select');
  wrap.append(element('span', 'visually-hidden', label));
  const select = element('select', 'digest-select__input');
  for (const { value, text } of options) {
    const option = element('option', null, text);
    option.value = value;
    option.selected = value === selected;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  wrap.append(select);
  return wrap;
}


/* Линия полугода — sparkline карточек: VOC с поправкой; подпись — первый и последний месяц */
function trendNode(points) {
  const wrap = element('div', 'digest-trend');
  wrap.append(sparkline(points.map(({ voc }) => voc), { tone: 'neutral', wide: true, label: vocText }),
    element('span', 'digest-caption', `${monthShort(points[0].month)} — ${monthShort(points.at(-1).month)}`));
  return wrap;
}

/* J-153: линия сегмента — недели, целиком покрывающие месяц, с коридором плана канала полосой */
const dayMonth = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
function weeklyNode(points, plan) {
  const wrap = element('div', 'digest-trend');
  const band = plan ? { min: plan.min, max: plan.max } : null;
  wrap.append(sparkline(points.map(({ voc }) => voc), { tone: 'neutral', wide: true, label: vocText, band }),
    element('span', 'digest-caption', `недели ${dayMonth(points[0].from)} — ${dayMonth(points.at(-1).to)}${plan ? ` · план ${formatVoc(plan.min)}–${formatVoc(plan.max)}` : ''}`));
  return wrap;
}

/* J-153: антидрайверы ДКО — доля негатива или урон; живёт до закрытия страницы */
let dkoMetric = 'share';

/* Пилюля тепловой карты антидрайверов: чем сильнее значение, тем краснее (шкала — максимум своей таблицы) */
function heatPill(text, strength) {
  const pill = element('span', strength > 0 ? 'heatmap-cell tone-pill heatmap-cell--bad digest-pill' : 'heatmap-cell tone-pill digest-pill');
  if (strength > 0) pill.style.setProperty('--heat-strength', `${Math.round(Math.min(1, strength) * 100)}%`);
  pill.append(element('span', 'heatmap-cell__value', text));
  return pill;
}

function monthTable(months, rows) {
  const table = element('table', 'digest-table');
  const head = element('tr');
  head.append(element('th', 'digest-table__name'), ...months.map((month) => element('th', null, MONTHS[monthIndex(month)])));
  const thead = element('thead');
  thead.append(head);
  const body = element('tbody');
  for (const { name, cells, className } of rows) {
    const row = element('tr', className ?? null);
    row.append(element('th', 'digest-table__name', name));
    for (const cell of cells) {
      const td = element('td');
      td.append(cell);
      row.append(td);
    }
    body.append(row);
  }
  table.append(thead, body);
  return table;
}

function unavailable(block) {
  block.setHead();
  block.setState(EMPTY);
}

export function renderDigestSummary(block, context) {
  const digest = digestOf(context);
  const name = context.label('channel', context.state.channel);
  block.setTitle(digest ? `${name} · ${monthTitle(digest.month)}` : name);
  if (!digest) return unavailable(block);
  block.setHead({ marker: planDotNode(digest.voc.voc, digest.voc.plan) });
  const content = element('div', 'digest-summary');

  const main = element('div', 'metric digest-summary__voc');
  main.append(figureNode(vocText(digest.voc.voc), leadNode(digest.voc.delta, { large: true }), 'metric__value--big'),
    metaRowNode(element('span', 'metric__meta', `${vocText(digest.voc.raw)} без учёта поправки на кэшбек`), planCaptionNode(digest.voc.plan)));

  /* J-176: оценки по месяцам — столбиками справа от числа, как урон стабильности, а не подписью строкой */
  const count = element('div', 'digest-summary__count');
  const figure = element('div', 'metric');
  figure.append(figureNode(formatCount(digest.count.value), leadNode(digest.count.delta, { shape: DELTA_SHAPES.count, growth: GROWTH.volume })),
    metaRowNode(element('span', 'metric__meta', `${plural(digest.count.value, ['оценка', 'оценки', 'оценок'])} за месяц`)));
  count.append(figure, barsNode(digest.count.months.map(({ month, count: value }) => ({ month, size: value, text: formatCount(value) })), ' digest-bars--count'));

  content.append(main, trendNode(digest.trend), count);
  block.setContent(content);
}

export const digestSegment = (index) => (block, context) => {
  const digest = digestOf(context);
  const segment = digest?.segments[index];
  block.setTitle(segment ? `VOC ${segment.code}` : 'Сегмент');
  if (!segment || !segment.count) return unavailable(block);
  block.setHead();
  const content = element('div', 'digest-segment');
  const numbers = element('div', 'metric digest-segment__numbers');
  numbers.append(figureNode(vocText(segment.voc), leadNode(segment.delta)),
    metaRowNode(countNode(segment.count), leadNode(segment.countDelta, { shape: DELTA_SHAPES.count, growth: GROWTH.volume })),
    ...(segment.raw !== null && roundVoc(segment.raw) !== roundVoc(segment.voc) ? [metaRowNode(element('span', 'metric__meta', `${vocText(segment.raw)} без поправки`))] : []));
  /* J-152: тезисов у сегментов пока нет — по просьбе заказчика; вывод считается и вернётся с архивом формулировок */
  const story = element('div', 'digest-segment__story');
  story.append(weeklyNode(segment.weekly, digest.voc.plan));
  content.append(numbers, story);
  block.setContent(content);
};

export function renderDigestDko(block, context) {
  const digest = digestOf(context);
  block.setTitle('ДКО: антидрайверы');
  if (!digest?.groups.length) return unavailable(block);
  const damage = dkoMetric === 'damage';
  block.setHead({ controls: [segmented({
    label: 'Числа антидрайверов дайджеста',
    options: [{ value: 'damage', label: 'Урон', title: 'На сколько VOC был бы выше без этих жалоб, в пунктах VOC' }, { value: 'share', label: 'Доля', title: 'Доля негатива' }],
    selected: dkoMetric,
    onSelect: (value) => {
      dkoMetric = value;
      renderDigestDko(block, context);
    },
  })] });
  /* Подсветка — по силе показанного числа: шкала — максимум таблицы по модулю */
  const valuesOf = (category) => (damage ? category.damages : category.shares);
  const peak = Math.max(0, ...digest.groups.flatMap(({ categories }) => categories.flatMap((category) => valuesOf(category).filter((value) => value !== null).map(Math.abs))));
  const text = (value) => (value === null ? '—' : damage ? formatImpact(roundImpact(value)) : percent(value));
  const content = element('div', 'digest-dko');
  for (const group of digest.groups) {
    const section = element('section', 'digest-dko__group');
    section.append(element('h4', 'digest-dko__title', `${damage ? formatImpact(roundImpact(group.damage)) : percent(group.share)} — ${group.name}`),
      monthTable(digest.months.table, group.categories.map((category) => ({
        name: category.name,
        cells: valuesOf(category).map((value) => heatPill(text(value), value !== null && peak ? Math.abs(value) / peak : 0)),
      }))));
    content.append(section);
  }
  block.setContent(content);
}

/* Серые столбики по месяцам (J-152): высота — доля от наибольшего, число и месяц — под столбиком */
function barsNode(points, className = '') {
  const peak = Math.max(0.0001, ...points.map(({ size }) => size));
  const bars = element('div', `digest-bars${className}`);
  for (const { month, size, text } of points) {
    const item = element('div', 'digest-bars__item');
    const bar = element('span', 'digest-bars__bar');
    bar.style.setProperty('--bar', String(Math.round((size / peak) * 100) / 100));
    item.append(bar, element('span', 'digest-bars__value', text), element('span', 'digest-bars__month', monthShort(month)));
    bars.append(item);
  }
  return bars;
}

export function renderDigestStability(block, context) {
  const digest = digestOf(context);
  block.setTitle('ДКО: стабильность');
  const points = digest?.stability ?? [];
  if (!points.some(({ damage }) => damage !== null)) return unavailable(block);
  const [previous, current] = points.slice(-2).map(({ damage }) => (damage === null ? null : roundImpact(damage)));
  const shift = current === null || previous === null ? null : current - previous;
  block.setHead({ note: shift === null ? null : leadNode(shift, { shape: { round: roundImpact, format: formatImpact } }) });
  const month = monthName(digest.month);
  const headline = shift === null ? 'Урон сбоев и технических проблем по месяцам'
    : shift > 0 ? `В ${month} — снижение негативного влияния стабильности на VOC`
      : shift < 0 ? `В ${month} — рост негативного влияния стабильности на VOC` : 'Влияние стабильности на VOC без изменений';
  /* J-152: урон по месяцам — серыми столбиками, как на слайде заказчика: высота — модуль урона, число — под столбиком */
  const bars = barsNode(points.map(({ month, damage }) => ({ month, size: Math.abs(damage ?? 0), text: damage === null ? '—' : formatImpact(roundImpact(damage)) })));
  const content = element('div', 'digest-stability');
  content.append(element('p', 'digest-headline', headline), bars,
    element('p', 'digest-caption', 'Урон группы «Сбои / тех. проблемы» по формуле ДКО, в пунктах VOC'));
  block.setContent(content);
}

export function renderDigestTopic(block, context) {
  const digest = digestOf(context);
  block.setTitle('Детализация');
  const topic = digest?.topics.includes(context.state.topic) ? context.state.topic : digest?.defaultTopic;
  if (!topic) return unavailable(block);
  block.setHead({ controls: [picker('Тема детализации', digest.topics.map((name) => ({ value: name, text: name })), topic,
    (value) => context.setState({ ...context.state, topic: value }))] });
  const detail = buildTopic({ rows: context.channelRows, month: digest.month, reference: context.reference, topic });
  const peak = Math.max(0.0001, ...detail.shares.map(({ share }) => share ?? 0));
  const content = element('div', 'digest-topic');
  content.append(element('p', 'digest-headline', `${topic}: доля негатива`),
    monthTable(detail.shares.map(({ month }) => month), [{ name: 'Доля', cells: detail.shares.map(({ share }) => heatPill(percent(share), (share ?? 0) / peak)) }]),
    monthTable(detail.months, [
      ...detail.problems.map((problem) => ({ name: problem.name, cells: problem.counts.map((count) => element('span', null, count ? formatCount(count) : '')) })),
      { name: 'Всего жалоб', className: 'digest-table__total', cells: detail.totals.map((count) => element('span', null, formatCount(count))) },
    ]));
  block.setContent(content);
}

/*
  VOC ролей — шапка страницы (канал, месяц, база чисел, шаг линии) и плитки четырёх ролей сеткой 2×2. Части — те же,
  что у сегментов дайджеста. Слотов ролей — `ROLE_SLOTS`
*/
/* J-166: портреты ролей от заказчика; роль без портрета — круг с иконкой */
const ROLE_PORTRAITS = {
  'Альфа-Босс': 'img/roles/alfa-boss.webp',
  'Фин.эксперт': 'img/roles/fin-expert.webp',
  'Предприниматель': 'img/roles/predprinimatel.webp',
  'Бухгалтер': 'img/roles/buhgalter.webp',
};

const rolesCache = new WeakMap();
/* J-168: месяц ролей — месяц конца периода шапки: своего выбора месяца у страницы нет */
/* J-174: из фильтров шапки страница ролей учитывает только ОС (iOS / Android у АБМ) */
const osRowsCache = new WeakMap();
function roleRows(context) {
  const selected = context.state.filters?.os ?? [];
  const dimension = context.dimensions?.find(({ key }) => key === 'os');
  if (!selected.length || !dimension) return context.channelRows;
  const key = selected.join('|');
  const saved = osRowsCache.get(context.channelRows);
  if (saved?.key === key) return saved.rows;
  const rows = context.channelRows.filter((row) => dimension.values(row, context.reference).some((value) => selected.includes(value)));
  osRowsCache.set(context.channelRows, { key, rows });
  return rows;
}

function rolesOf(context) {
  const rows = roleRows(context);
  const month = selectedMonth(context);
  if (!month) return null;
  const key = JSON.stringify([context.state.channel, month]);
  const saved = rolesCache.get(rows);
  if (saved?.key === key && saved.reference === context.reference) return saved.roles;
  const roles = buildRoles({ rows, month, reference: context.reference, channel: context.state.channel });
  rolesCache.set(rows, { key, reference: context.reference, roles });
  return roles;
}

/*
  Шаг линии ролей — недели месяца или месяцы полугода; переключатель в шапке страницы, выбор живёт до закрытия
  страницы, как «Урон / Доля» ДКО. Переключение перерисовывает шапку и все плитки ролей
*/
const ROLE_SCALES = [
  { value: 'weeks', label: 'Недели', title: 'VOC по неделям выбранного месяца' },
  { value: 'months', label: 'Месяцы', title: 'VOC по месяцам: полгода по выбранный месяц' },
];
let roleScale = 'weeks';
const roleTiles = new Map();

function planText(plan) {
  return plan ? ` · план ${formatVoc(plan.min)}–${formatVoc(plan.max)}` : '';
}

export function renderRoles(block, context) {
  const data = rolesOf(context);
  const os = context.dimensions?.some(({ key }) => key === 'os') ? context.state.filters?.os ?? [] : [];
  const name = [context.label('channel', context.state.channel), ...(os.length ? [os.join(', ')] : [])].join(' · ');
  block.setTitle(data ? `VOC ролей · ${name} · ${monthTitle(data.month)}` : `VOC ролей · ${name}`);
  if (!data?.roles.length) return unavailable(block);
  block.setHead({ controls: [segmented({
    label: 'Шаг линии ролей',
    options: ROLE_SCALES,
    selected: roleScale,
    onSelect: (value) => {
      roleScale = value;
      renderRoles(block, context);
      for (const [index, tile] of roleTiles) if (tile.block.element.isConnected) digestRole(index)(tile.block, tile.context);
    },
  })] });
  const span = roleScale === 'months'
    ? `месяцы ${monthShort(data.months[0])} — ${monthShort(data.months.at(-1))}`
    : `недели ${dayMonth(data.weeks.from)} — ${dayMonth(data.weeks.to)}`;
  block.setContent(element('p', 'digest-caption roles-caption', `Дельты — к прошлому месяцу · ${span}${planText(data.plan)}`));
}

/* J-172: дельты нет, потому что в прошлом месяце нет оценок, — тире с пояснением, а не пустое место */
function roleLead(value, hasPrevious, options) {
  if (hasPrevious) return leadNode(value, options);
  const dash = element('span', 'metric__lead metric__meta', '—');
  dash.title = 'В прошлом месяце оценок нет — сравнить не с чем';
  return dash;
}

/* Топ-3 проблем роли — таблицей: название, жалоб, дельта; числа — столбцами вправо (J-194) */
function problemTable(problems) {
  if (!problems.length) return element('p', 'role-card__none', 'Жалоб с проблемой нет');
  const table = element('table', 'role-card__problems');
  table.append(element('caption', 'visually-hidden', 'Топ-3 проблем роли по числу жалоб'));
  const head = element('tr');
  for (const [text, className] of [['Проблема', null], ['Жалоб', 'role-card__number'], ['Дельта', 'role-card__number']]) {
    const cell = element('th', className, text);
    cell.scope = 'col';
    head.append(cell);
  }
  const thead = element('thead');
  thead.append(head);
  const body = element('tbody');
  for (const { name, count, delta } of problems) {
    const row = element('tr');
    const lead = element('td', 'role-card__number');
    lead.append(roleLead(delta, delta !== null, { shape: DELTA_SHAPES.count, growth: GROWTH.bad }));
    row.append(element('td', 'role-card__problem-name', name), element('td', 'role-card__number', formatCount(count)), lead);
    body.append(row);
  }
  table.append(thead, body);
  return table;
}

/* Портрет роли — круг; роль без портрета — круг с иконкой (J-166) */
function roleAvatar(role) {
  const avatar = element('span', 'role-card__avatar');
  const portrait = ROLE_PORTRAITS[role];
  if (portrait) {
    avatar.classList.add('role-card__avatar--portrait');
    /* Портрет — оформление: роль уже названа заголовком карточки */
    const image = element('img', 'role-card__portrait');
    Object.assign(image, { src: portrait, alt: '', loading: 'lazy', decoding: 'async', width: 400, height: 400 });
    avatar.append(image);
  } else avatar.append(icon('users', 'role-card__avatar-icon'));
  return avatar;
}

/* Линия роли: недели месяца с датами начала недель или месяцы полугода; план — в подписи */
function roleTrend(role, data) {
  const months = roleScale === 'months';
  const points = months ? role.monthly : role.weekly;
  const values = points.map(({ voc }) => voc);
  const band = data.plan ? { min: data.plan.min, max: data.plan.max } : null;
  const wrap = element('div', 'digest-trend digest-trend--fill');
  wrap.title = `VOC ${months ? 'по месяцам' : 'по неделям'}${band ? `; полоса — план ${formatVoc(band.min)}–${formatVoc(band.max)}` : ''}`;
  /* J-194: шкала круглым шагом, как у графика динамики — коридор плана полосой, а не фоном плитки */
  wrap.append(sparkline(values, { tone: 'neutral', wide: true, fill: true, label: vocText, band, domain: chartDomain(points, [], band),
    axis: points.map((point) => (months ? monthShort(point.month) : dayMonth(point.from))) }));
  return wrap;
}

/*
  Плитка роли: слева шапка карточки — портрет и название роли (J-169, шапка одна на все карточки — C-02), под ней внизу
  VOC с дельтой и оценки; через разделитель справа с самого верха — линия VOC с коридором плана и топ-3 проблем таблицей
*/
export const digestRole = (index) => (block, context) => {
  const data = rolesOf(context);
  const role = data?.roles[index];
  block.element.hidden = !role;
  if (!role) return;
  roleTiles.set(index, { block, context });
  block.setTitle(role.role);
  block.setHead({ marker: roleAvatar(role.role) });
  const lead = element('div', 'role-card__lead');
  const content = element('div', 'role-card');
  if (!role.count) {
    lead.append(element('p', 'role-card__none', 'Нет оценок за месяц'));
    content.append(lead);
    block.setContent(content);
    return;
  }
  /* J-163, J-165: VOC — крупным числом 72 px с дельтой справа; оценки — мелкой строкой под ним */
  const vocFigure = element('div', 'metric');
  const hasPrevious = role.countDelta !== null;
  vocFigure.append(figureNode(vocText(role.voc), roleLead(role.delta, hasPrevious)),
    metaRowNode(countNode(role.count), roleLead(role.countDelta, hasPrevious, { shape: DELTA_SHAPES.count, growth: GROWTH.volume })),
    ...(role.raw !== null && roundVoc(role.raw) !== roundVoc(role.voc) ? [metaRowNode(element('span', 'metric__meta', `${vocText(role.raw)} без поправки`))] : []));
  lead.append(vocFigure);
  const side = element('div', 'role-card__side');
  /* Подписи «По неделям · план» над линией нет: шаг и план — в шапке страницы, план ещё и в подсказке линии */
  side.append(roleTrend(role, data), problemTable(role.problems));
  content.append(lead, side);
  block.setContent(content);
};
