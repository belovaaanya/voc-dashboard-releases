/*
  J-151: VOC-дайджест — месяц канала по макету заказчика, собранный из готовых частей дашборда: число со стрелкой
  динамики и кольцом плана — как в карточках метрик, линия полугода — sparkline, доли и урон по месяцам — пилюли
  тепловой карты антидрайверов, вклад триггеров — полосами. Расчёт — `../core/digest.js`. Месяц — из периода шапки.
*/
import { EMPTY } from '../shell/block.js';
import { emptyValue } from '../components/empty-value.js';
import { heatCell } from '../components/heat-cell.js';
import { statusPanel } from '../components/status-panel.js';
import { segmented } from '../components/segmented.js';
import { legendItem, legendList } from '../components/legend.js';
import { sparkline } from '../components/sparkline.js';
import { chartDomain } from '../core/chart-geometry.js';
import { colourScale } from '../core/antidrivers.js';
import { STABILITY_PLAN, buildDigest, buildPlatforms, buildRoles, buildTriggers, defaultMonth, monthsOf } from '../core/digest.js';
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { MONTHS, formatBucket, monthName, formatCount, formatImpact, formatRatings, formatShare, formatVoc, plural } from '../core/format.js';
import { roundDelta, roundImpact, roundVoc } from '../core/round.js';
import { MOBILE_CHANNEL } from '../core/dimensions.js';
import { MINIMUM_RATINGS } from '../core/sufficiency.js';
import { DELTA_SHAPES, GROWTH, countGroupNode, countNode, leadNode, metaRowNode, planCaptionNode, pairNode, planDotNode, valueNode } from './metric-card.js';
import { valueDelta } from '../components/value-delta.js';

const monthIndex = (month) => Number(month.slice(5, 7)) - 1;
const MONTHS_PREPOSITIONAL = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
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

/* Линия полугода — sparkline карточек: VOC с поправкой; подпись — первый и последний месяц */
function trendNode(points) {
  const wrap = element('div', 'digest-trend');
  wrap.append(sparkline(points.map(({ voc }) => voc), { tone: 'neutral', wide: true, label: vocText, glow: true }),
    element('span', 'digest-caption', `${monthShort(points[0].month)} — ${monthShort(points.at(-1).month)}`));
  return wrap;
}

/* J-153: линия сегмента — недели, целиком покрывающие месяц, с коридором плана канала полосой */
const dayMonth = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
function weeklyNode(points, plan) {
  /* Линия недель забирает всю свободную высоту карточки сегмента (`fill`, как на плитках ролей): без пустоты над ней */
  const wrap = element('div', 'digest-trend digest-trend--fill digest-trend--segment');
  const band = plan ? { min: plan.min, max: plan.max } : null;
  /* Недели и план — в базе чисел под итогом страницы, а не подписью в каждой карточке */
  /* Под точками — даты начала недель, ролью оси: видно, что шаг — неделя */
  wrap.append(sparkline(points.map(({ voc }) => voc), { tone: 'neutral', wide: true, fill: true, label: vocText, band, glow: true,
    axis: points.map(({ from }) => dayMonth(from)) }));
  return wrap;
}

/* J-153: антидрайверы ДКО — доля негатива или урон; живёт до закрытия страницы */
let dkoMetric = 'share';

/* Пилюля тепловой карты главной: ниже Q75 таблицы — только рамка, выше — заливка тем сильнее, чем ближе к Q95 */
function heatPill(text, highlight) {
  /* Нет значения — общий прочерк второстепенного цвета (emptyValue), а не белое тире ячейки */
  const content = text === null ? emptyValue() : element('span', 'heatmap-cell__value', text);
  return heatCell({ tone: 'bad', muted: highlight.muted, strength: highlight.muted ? null : highlight.strength, className: 'digest-pill', content });
}

function monthTable(months, rows) {
  const table = element('table', 'digest-table');
  /* Ширины колонок — из colgroup: при table-layout: fixed строка-подзаголовок на всю ширину не задаёт их сама */
  const columns = element('colgroup');
  columns.append(element('col', 'digest-table__name-col'), ...months.map(() => element('col')));
  table.append(columns);
  const head = element('tr');
  head.append(element('th', 'digest-table__name'), ...months.map((month) => element('th', null, MONTHS[monthIndex(month)])));
  const thead = element('thead');
  thead.append(head);
  const body = element('tbody');
  for (const { name, cells, className } of rows) {
    const row = element('tr', className ?? null);
    const title = element('th', 'digest-table__name', name);
    if (!cells.length) title.colSpan = months.length + 1;
    row.append(title);
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
  /* Заголовок страницы — «VOC-дайджест · Месяц ГГГГ» ролью --type-page-title (card--page-head); канал виден в шапке дашборда */
  block.setTitle(digest ? `VOC-дайджест · ${monthTitle(digest.month)}` : 'VOC-дайджест');
  if (!digest) return unavailable(block);
  block.setHead({ marker: planDotNode(digest.voc.voc, digest.voc.plan) });
  const content = element('div', 'digest-summary');

  const main = element('div', 'metric digest-summary__voc');
  main.append(pairNode(vocText(digest.voc.voc), leadNode(digest.voc.delta, { large: true }), 'metric__value--big', { wrap: true }),
    metaRowNode(...(digest.voc.raw === null ? [] : [element('span', 'metric__meta', `${vocText(digest.voc.raw)} без учёта поправки на кэшбек`)]), planCaptionNode(digest.voc.plan)));

  /* J-176: оценки по месяцам — столбиками справа от числа, как урон стабильности, а не подписью строкой */
  const count = element('div', 'digest-summary__count');
  const figure = element('div', 'metric');
  /* Число и дельта — неразрывной парой (valueDelta): «+557» не уходит под число */
  figure.append(valueDelta(valueNode(formatCount(digest.count.value)), leadNode(digest.count.delta, { shape: DELTA_SHAPES.count, growth: GROWTH.volume })),
    metaRowNode(element('span', 'metric__meta', `${plural(digest.count.value, ['оценка', 'оценки', 'оценок'])} за месяц`)));
  count.append(figure, barsNode(digest.count.months.map(({ month, count: value }) => ({ month, size: value, text: formatCount(value) })), ' digest-bars--count'));

  content.append(main, trendNode(digest.trend), count);
  /* База чисел — одна на страницу, как у «VOC ролей»: не повторяется в каждой карточке сегмента */
  /* План уже стоит под VOC итога — в базе его не повторяем */
  const { from, to } = digest.weeks;
  const base = element('p', 'digest-caption digest-summary__base', `Дельты — к прошлому месяцу · сегменты по неделям ${dayMonth(from)} — ${dayMonth(to)}`);
  const wrap = element('div', 'digest-summary__wrap');
  wrap.append(content, base);
  block.setContent(wrap);
}

export const digestSegment = (index) => (block, context) => {
  const digest = digestOf(context);
  const segment = digest?.segments[index];
  block.setTitle(segment ? `VOC ${segment.code}` : 'Сегмент');
  if (!segment || !segment.count) return unavailable(block);
  block.setHead();
  const content = element('div', 'digest-segment');
  const numbers = element('div', 'metric digest-segment__numbers');
  /* Анатомия карточки сегмента главной: число с дельтой, под ним «N оценок» с дельтой одним узлом (countGroupNode) */
  numbers.append(pairNode(vocText(segment.voc), leadNode(segment.delta)),
    metaRowNode(countGroupNode(segment.count, segment.count - segment.countDelta)),
    ...(segment.raw !== null && roundVoc(segment.raw) !== roundVoc(segment.voc) ? [metaRowNode(element('span', 'metric__meta', `${vocText(segment.raw)} без поправки`))] : []));
  /* J-152: тезисов у сегментов пока нет — по просьбе заказчика; вывод считается и вернётся с архивом формулировок */
  const story = element('div', 'digest-segment__story');
  story.append(segment.spread ? spreadNode(segment.spread) : weeklyNode(segment.weekly, digest.voc.plan));
  content.append(numbers, story);
  block.setContent(content);
};

/* Мало оценок у сегмента мобильного канала (D-25): линия недель стояла бы на единицах оценок — показываем оценки 5…1 */
function spreadNode(spread) {
  const table = element('table', 'digest-table digest-spread');
  const head = element('tr');
  head.append(element('th', 'digest-table__name', 'Оценка'), element('th', null, 'Оценок'), element('th', null, 'Доля'));
  const thead = element('thead');
  thead.append(head);
  const body = element('tbody');
  for (const { score, count, share } of spread) {
    /* Оценка — рядом звёзд по её числу, как в отзыве; screen reader слышит «5 звёзд» */
    const name = element('th', 'digest-table__name');
    const stars = element('span', 'digest-spread__stars');
    for (let index = 0; index < score; index += 1) stars.append(icon('star', 'digest-spread__star'));
    stars.append(element('span', 'visually-hidden', `${score} ${plural(score, ['звезда', 'звезды', 'звёзд'])}`));
    name.append(stars);
    const row = element('tr', count ? null : 'digest-spread__row--zero');
    const shareCell = element('td');
    shareCell.append(share === null || share === undefined ? emptyValue() : percent(share));
    row.append(name, element('td', null, formatCount(count)), shareCell);
    body.append(row);
  }
  table.append(thead, body);
  const wrap = element('div', 'digest-trend');
  wrap.append(table, element('span', 'digest-caption', `Мало оценок (порог ${formatCount(MINIMUM_RATINGS)}) — оценки 5…1 вместо линии`));
  return wrap;
}

/*
  Горизонтальные полосы триггеров: строка «название · полоса · VOC триггера · вклад»; над списком — одна шапка колонок.
  Вклад — тоном направления (знак и группа дублируют цвет)
*/
function hbars(items, tone) {
  const list = element('ol', 'digest-hbars');
  for (const { name, size, voc: value, impact, hint } of items) {
    const row = element('li', `digest-hbars__row digest-hbars__row--${tone}`);
    const track = element('span', 'digest-hbars__track');
    const bar = element('span', 'digest-hbars__bar');
    bar.style.setProperty('--bar', String(Math.round(Math.min(1, size) * 100) / 100));
    track.append(bar);
    row.append(element('span', 'digest-hbars__name', name), track, element('span', 'digest-hbars__value', value),
      element('span', 'digest-hbars__value digest-hbars__impact', impact));
    if (hint) row.title = hint;
    /* Шапка колонок скрыта от screen reader — строка называет числа сама */
    row.setAttribute('aria-label', `${name}: VOC ${value}, вклад ${impact}`);
    list.append(row);
  }
  return list;
}

function hbarsHead() {
  const head = element('div', 'digest-hbars__row digest-hbars__head');
  head.setAttribute('aria-hidden', 'true');
  head.append(element('span', 'digest-hbars__name', 'Триггер'), element('span'), element('span', 'digest-hbars__value', 'VOC'),
    element('span', 'digest-hbars__value', 'Вклад'));
  return head;
}

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
  /* Шкала — как у тепловой карты главной (Q75 / Q95 по всем числам карточки): разница в доле видна заливкой */
  const scale = colourScale(digest.groups.flatMap(({ categories }) => categories.flatMap((category) => valuesOf(category).filter((value) => value !== null).map(Math.abs))));
  const text = (value) => (value === null ? null : damage ? formatImpact(roundImpact(value)) : percent(value));
  /* Одна шапка месяцев на всю карточку: группа — строкой-подзаголовком, категории — под ней; пустая ячейка — тихий прочерк */
  const rows = digest.groups.flatMap((group) => [
    { name: `${damage ? formatImpact(roundImpact(group.damage)) : percent(group.share)} — ${group.name}`, className: 'digest-table__group', cells: [] },
    ...group.categories.map((category) => ({
      name: category.name,
      cells: valuesOf(category).map((value) => (value === null ? emptyValue() : heatPill(text(value), scale(Math.abs(value))))),
    })),
  ]);
  const content = element('div', 'digest-dko');
  content.append(monthTable(digest.months.table, rows));
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
    const value = element('span', 'digest-bars__value');
    value.append(text === null ? emptyValue() : text);
    item.append(bar, value, element('span', 'digest-bars__month', monthShort(month)));
    bars.append(item);
  }
  return bars;
}

export function renderDigestStability(block, context) {
  const digest = digestOf(context);
  block.setTitle('ДКО: стабильность');
  const points = digest?.stability ?? [];
  /* Нет урона ни в одном месяце (данных нет или все нули) — пустое состояние карточки, а не ряд пустых столбиков */
  if (!points.some(({ damage }) => damage !== null && roundImpact(damage) !== 0)) return unavailable(block);
  const [previous, current] = points.slice(-2).map(({ damage }) => (damage === null ? null : roundImpact(damage)));
  const shift = current === null || previous === null ? null : current - previous;
  block.setHead({ note: shift === null ? null : leadNode(shift, { shape: { round: roundImpact, format: formatImpact } }) });
  /* «В октябре», а не «В октябрь»: месяц в предложном падеже */
  const month = MONTHS_PREPOSITIONAL[monthIndex(digest.month)];
  const headline = shift === null ? 'Урон сбоев и технических проблем по месяцам'
    : shift > 0 ? `В ${month} — снижение негативного влияния стабильности на VOC`
      : shift < 0 ? `В ${month} — рост негативного влияния стабильности на VOC` : 'Влияние стабильности на VOC без изменений';
  /* J-152: урон по месяцам — серыми столбиками, как на слайде заказчика: высота — модуль урона, число — под столбиком */
  /*
    План руководства (STABILITY_PLAN) — пунктирной линией-порогом на шкале столбиков; шкала вмещает порог с запасом сверху.
    Столбик сильнее порога — тоном «ниже плана», и это продублировано числом под ним
  */
  const scale = Math.max(Math.abs(STABILITY_PLAN), ...points.map(({ damage }) => Math.abs(damage ?? 0))) * 1.15;
  const bars = element('div', 'digest-bars digest-bars--plan');
  bars.style.setProperty('--plan', String(Math.round((Math.abs(STABILITY_PLAN) / scale) * 1000) / 1000));
  for (const { month: key, damage } of points) {
    const below = damage !== null && roundImpact(damage) < STABILITY_PLAN;
    const item = element('div', below ? 'digest-bars__item digest-bars__item--below' : 'digest-bars__item');
    const track = element('span', 'digest-bars__track');
    const bar = element('span', 'digest-bars__bar');
    bar.style.setProperty('--bar', String(Math.round((Math.abs(damage ?? 0) / scale) * 1000) / 1000));
    track.append(bar, element('span', 'digest-bars__plan'));
    const value = element('span', 'digest-bars__value');
    value.append(damage === null ? emptyValue() : formatImpact(roundImpact(damage)));
    item.append(track, value, element('span', 'digest-bars__month', monthShort(key)));
    bars.append(item);
  }
  const content = element('div', 'digest-stability');
  content.append(element('p', 'digest-headline', headline),
    element('p', 'digest-caption digest-stability__plan', `Пунктир — план: урон не сильнее ${formatImpact(STABILITY_PLAN)}`), bars,
    element('p', 'digest-caption', 'Урон группы «Сбои / тех. проблемы» по формуле ДКО, в пунктах VOC'));
  block.setContent(content);
}

/*
  Триггеры: драйверы и антидрайверы месяца — вклад триггера в изменение VOC с поправкой к прошлому месяцу (D-10, та же
  методика, что у «Главного вывода»): пять сильнейших вверх и пять вниз, полосой от нуля в свою сторону, как на слайде
  «Влияние сценариев»
*/
export function renderDigestTriggers(block, context) {
  const digest = digestOf(context);
  block.setTitle('Триггеры: драйверы и антидрайверы');
  if (!digest) return unavailable(block);
  const triggers = buildTriggers({ rows: context.channelRows, month: digest.month, reference: context.reference, label: context.label });
  if (!triggers.drivers.length && !triggers.antidrivers.length) return unavailable(block);
  block.setHead();
  const peak = Math.max(0.0001, ...[...triggers.drivers, ...triggers.antidrivers].map(({ impact }) => Math.abs(impact)));
  const content = element('div', 'digest-triggers');
  /* Изменение VOC, которое раскладывают вклады, — словами, а не голой дельтой со стрелкой в шапке */
  const change = triggers.delta === null ? null : roundDelta(triggers.delta);
  if (change !== null) {
    const text = change > 0 ? `VOC вырос на ${formatVoc(change)} к прошлому месяцу`
      : change < 0 ? `VOC снизился на ${formatVoc(-change)} к прошлому месяцу` : 'VOC не изменился к прошлому месяцу';
    content.append(element('p', 'digest-headline', text));
  }
  content.append(hbarsHead());
  /* Направление группы — словом и стрелкой-иконкой (цвет только дублирует): «Подняли VOC» / «Снизили VOC» */
  for (const [title, items, tone, arrow] of [['Подняли VOC', triggers.drivers, 'up', 'trend-up'], ['Снизили VOC', triggers.antidrivers, 'down', 'trend-down']]) {
    if (!items.length) continue;
    const section = element('section', 'digest-triggers__group');
    const heading = element('h4', `digest-subhead digest-subhead--${tone}`, title);
    heading.append(icon(arrow, 'digest-subhead__icon'));
    section.append(heading);
    const list = hbars(items.map((item) => ({
      name: item.name, size: Math.abs(item.impact) / peak, voc: vocText(item.voc), impact: formatImpact(roundImpact(item.impact)),
      hint: `${item.name}: VOC ${vocText(item.voc)}, ${formatRatings(item.ratings)}`,
    })), tone);
    section.append(list);
    content.append(section);
  }
  content.append(element('p', 'digest-caption', 'VOC — с поправкой за месяц. Вклад — на сколько триггер сдвинул VOC к прошлому месяцу, в пунктах VOC; вклады всех триггеров в сумме дают изменение VOC'));
  block.setContent(content);
}

/* iOS и Android мобильного канала — две широкие линии полугода на одной шкале, с коридором плана месяца */
export function renderDigestPlatforms(block, context) {
  const digest = digestOf(context);
  block.setTitle('iOS / Android');
  /* Карточка есть только у мобильного канала: у других каналов ОС в выгрузке нет, пустая карточка не нужна */
  block.element.hidden = context.state.channel !== MOBILE_CHANNEL;
  if (!digest || block.element.hidden) return unavailable(block);
  const detail = buildPlatforms({ rows: context.channelRows, month: digest.month, reference: context.reference });
  const points = detail.platforms.flatMap(({ months }) => months);
  if (!points.some(({ voc: value }) => value !== null)) return unavailable(block);
  block.setHead();
  const plan = digest.voc.plan;
  const band = plan ? { min: plan.min, max: plan.max } : null;
  const domain = chartDomain(points, [], band);
  const gap = detail.gap === null ? null : roundDelta(detail.gap);
  const before = detail.previousGap === null ? null : roundDelta(detail.previousGap);
  const side = (value) => (value > 0 ? `выше Android на ${formatVoc(value)}` : value < 0 ? `ниже Android на ${formatVoc(-value)}` : 'вровень с Android');
  const headline = gap === null ? 'VOC iOS и Android по месяцам'
    : `iOS ${side(gap)}${before === null ? '' : `, месяцем раньше — ${side(before)}`}`;
  /*
    Обе ОС — на одном графике, потому что их сравнивают: одна шкала, две линии своих тонов (iOS — серая, Android —
    фиолетовая; зелёный на дашборде значит «хорошо»), коридор плана полосой за ними. Значения месяца — в легенде
  */
  const content = element('div', 'digest-platforms');
  content.append(element('p', 'digest-headline', headline));
  const [ios, android] = detail.platforms;
  const tones = { [ios.code]: 'neutral', [android.code]: 'purple' };
  const legendText = (platform) => {
    const last = platform.months.at(-1);
    return `${platform.name} · ${vocText(last.voc)} · ${formatRatings(last.count)}${last.count && last.count < MINIMUM_RATINGS ? ', мало' : ''}`;
  };
  content.append(legendList([
    ...detail.platforms.map((platform) => legendItem(legendText(platform), tones[platform.code], 'line')),
    ...(band ? [legendItem(`План ${formatVoc(plan.min)}–${formatVoc(plan.max)}`, 'positive', 'band')] : []),
  ], 'digest-platforms__legend'));
  const chart = element('div', 'digest-platforms__chart');
  chart.append(...detail.platforms.map((platform, index) => sparkline(platform.months.map(({ voc: value }) => value),
    { tone: tones[platform.code], wide: true, fill: true, domain, band: index === 0 ? band : null, zones: false, glow: true })));
  content.append(chart, element('p', 'digest-caption', `${monthShort(detail.months[0])} — ${monthShort(detail.months.at(-1))} · VOC с поправкой`));
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

/*
  J-172: дельты нет, потому что в прошлом месяце нет оценок, — прочерк с пояснением, а не пустое место. Прочерк — общий
  компонент «нет значения» (emptyValue): один вид на всех страницах; стрелка ↗ / ↘ у дельт — из общего delta()
*/
function roleLead(value, hasPrevious, options) {
  if (hasPrevious) return leadNode(value, options);
  const reason = 'в прошлом месяце оценок нет — сравнить не с чем';
  const dash = emptyValue(reason);
  dash.classList.add('metric__lead');
  dash.title = 'В прошлом месяце оценок нет — сравнить не с чем';
  return dash;
}

/* Топ-3 проблем роли — таблицей: название, жалоб, дельта; числа — столбцами вправо (J-194) */
function problemTable(problems) {
  if (!problems.length) return statusPanel('role-card__none', { title: 'Жалоб с проблемой нет', look: 'quiet' });
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
  Плитка роли: слева шапка карточки — название роли (шапка одна на все карточки — C-02), под ней крупный портрет и внизу
  VOC с дельтой и оценки; через разделитель справа с самого верха — линия VOC с коридором плана и топ-3 проблем таблицей.
  Портрет — в теле плитки, а не 40 px в шапке (J-169): заполняет левую колонку над числом
*/
export const digestRole = (index) => (block, context) => {
  const data = rolesOf(context);
  const role = data?.roles[index];
  block.element.hidden = !role;
  if (!role) return;
  roleTiles.set(index, { block, context });
  block.setTitle(role.role);
  block.setHead();
  const lead = element('div', 'role-card__lead');
  lead.append(roleAvatar(role.role));
  const content = element('div', 'role-card');
  if (!role.count) {
    /* Пустая роль — сразу под портретом: место надписи не зависит от высоты соседней плитки в строке */
    lead.classList.add('role-card__lead--empty');
    lead.append(statusPanel('role-card__none', { title: 'Нет оценок за месяц', look: 'quiet' }));
    content.append(lead);
    block.setContent(content);
    return;
  }
  /* J-163, J-165: VOC — крупным числом 72 px с дельтой справа; оценки — мелкой строкой под ним */
  const vocFigure = element('div', 'metric');
  const hasPrevious = role.countDelta !== null;
  vocFigure.append(pairNode(vocText(role.voc), roleLead(role.delta, hasPrevious)),
    metaRowNode(countNode(role.count), roleLead(role.countDelta, hasPrevious, { shape: DELTA_SHAPES.count, growth: GROWTH.volume })),
    ...(role.raw !== null && roundVoc(role.raw) !== roundVoc(role.voc) ? [metaRowNode(element('span', 'metric__meta', `${vocText(role.raw)} без поправки`))] : []));
  lead.append(vocFigure);
  const side = element('div', 'role-card__side');
  /* Подписи «По неделям · план» над линией нет: шаг и план — в шапке страницы, план ещё и в подсказке линии */
  side.append(roleTrend(role, data), problemTable(role.problems));
  content.append(lead, side);
  block.setContent(content);
};
