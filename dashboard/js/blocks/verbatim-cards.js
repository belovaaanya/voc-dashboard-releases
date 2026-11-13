import { EMPTY, ERROR, LOADING } from '../shell/block.js';
import { delta } from '../components/delta.js';
import { driverChip } from '../components/driver-chip.js';
import { icon } from '../ui/icons.js';
import { element, withFullLabel } from '../ui/dom.js';
import { formatBucket, formatCount, formatDate, formatImpact, formatInterval, formatNumber, formatShare, plural, quoted } from '../core/format.js';
import { metricSegments } from '../core/dimensions.js';
import { driverRows, normalizeDriver } from '../state/driver-pick.js';
import { roundImpact } from '../core/round.js';
import { segmented } from '../components/segmented.js';
import { sharePie } from '../components/share-pie.js';
import { sideToggle } from '../components/side-toggle.js';
import { pagingButtons } from '../components/paging.js';
import { scaleTabs } from '../components/scale-tabs.js';
import { searchField } from '../components/search-field.js';
import { statusPanel } from '../components/status-panel.js';
import { buildTimeSeries } from '../core/timeseries.js';
import { FEW_COMPLAINTS, NO_CATEGORY_GROUP, NO_DOMAIN, PEAK_RULE, POSITIVE_GROUP, buildProblemCards, damageOf, negativeShare } from '../core/verbatim.js';

let selectedCut = 'domainProblem';
/*
  J-142: итог за период показывает всё сразу — жалобы с «было» и долей, урон; переключатель «Динамика» меняет только
  колонки шагов: жалобы, доля негатива или урон. По умолчанию — главная метрика разреза: у ФО и проблематики —
  жалобы, у ДКО — урон; смена разреза возвращает умолчание. Порядок строк — по той же главной метрике разреза
*/
/* J-150: у ДКО по умолчанию в шаге сразу урон и жалобы — их смотрят вместе, переключаться неудобно */
const DYNAMICS_DEFAULT = { domainProblem: 'count', categoryPair: 'both' };
let selectedDynamics = DYNAMICS_DEFAULT.domainProblem;
/* J-146: после смены динамики таблица сама прокручивается к шагам — иначе смена не видна за правым краем */
let revealSteps = false;
/* J-114: шаг частотности — недели или месяцы; дней нет */
let selectedScale = 'week';
/*
  J-139: списка групп слева нет — две колонки, таблица и отзывы. Вместо него — сортировка: по частотности значений
  (проблематики, категории) или по частотности их групп (ФО, группы негатива ДКО), внутри группы — по значениям
*/
let selectedOrder = 'value';
/* J-128: плоский список значений по убыванию жалоб, по десять */
const PROBLEM_PAGE = 10;
/* J-130: поиск по названию значения и его группы — вхождением строки, как в таблице детализации (D-57); до закрытия страницы */
let problemQuery = '';
export const matchesProblemQuery = (item, query) => {
  const needle = String(query ?? '').trim().toLocaleLowerCase('ru');
  return !needle || `${item.name ?? item.key} ${item.group ?? ''}`.toLocaleLowerCase('ru').includes(needle);
};
const FEED_PAGE = 20;
/* J-136: ленту отзывов справа можно скрыть, чтобы смотреть таблицу во всю ширину; живёт до закрытия страницы */
let feedHidden = false;
const FEED_ID = 'verbatim-problem-feed';
const viewStates = new WeakMap();

function viewState(block, context) {
  const key = JSON.stringify([context.state.channel, context.period, context.state.filters, context.state.includeCashback !== false,
    normalizeDriver(context.state.driver), selectedCut]);
  let state = viewStates.get(block);
  if (state?.key !== key) {
    state = { key, shown: PROBLEM_PAGE, side: null, selected: null, feedShown: FEED_PAGE };
    viewStates.set(block, state);
  }
  return state;
}

/*
  J-128: слева — группы разреза (ФО или группы негатива ДКО), в таблице — значения одним списком по убыванию жалоб.
  ДКО считается как в антидрайверах (J-33, J-34, J-109), урон — формулой ДКО (J-110)
*/
export const CUT_OPTIONS = [
  { value: 'domainProblem', label: 'ФО и проблематика', title: 'Функциональная область и проблематика', empty: 'с проблематикой' },
  { value: 'categoryPair', label: 'ДКО', title: 'Группа и категория основного негатива', empty: 'с категорией негатива' },
];
const GROUPINGS = {
  domainProblem: { groupHead: 'ФО', groupTitle: 'Функциональная область', nameHead: 'Проблематика', none: NO_DOMAIN, all: 'Все ФО',
    unit: 'проблемы' },
  categoryPair: { groupHead: 'Группа негатива', groupTitle: 'Группа категорий основного негатива', nameHead: 'Категория', nameTitle: 'Категория основного негатива', none: NO_CATEGORY_GROUP,
    all: 'Все группы', unit: 'категории' },
};
const grouping = () => GROUPINGS[selectedCut];
const nameOf = (item) => item.name ?? item.key;
/* Ключ выбранной группы — отдельный префикс: не совпадёт с ключом пары */
const GROUP_KEY = '\u001e';
const groupKey = (group) => `${GROUP_KEY}${group}`;

function cutTabs(block, context) {
  return segmented({
    label: 'Разрез топа проблем',
    options: CUT_OPTIONS.map(({ value, label, title }) => ({ value, label, title })),
    selected: selectedCut,
    onSelect: (value) => {
      selectedCut = value;
      selectedDynamics = DYNAMICS_DEFAULT[value];
      renderVerbatimCards(block, context);
    },
  });
}

const SHARE_TITLE = 'Доля значения в потерях (5 − оценка) размеченных оценок 1–4: размеченные отзывы растянуты на весь негатив. Оценка с несколькими проблемами входит в каждую';

const DAMAGE_TITLE = 'На сколько VOC был бы выше без этих жалоб, в пунктах VOC: доля негатива × (5 − VOC)';
const DYNAMICS = {
  count: { label: 'Жалобы', title: 'Число жалоб за шаг', of: 'Жалоб' },
  share: { label: 'Доля', title: `Доля негатива за шаг. ${SHARE_TITLE}`, of: 'Доля негатива' },
  damage: { label: 'Урон', title: `Урон за шаг. ${DAMAGE_TITLE}`, of: 'Урон' },
  both: { label: 'Урон и жалобы', title: `Урон за шаг крупно, число жалоб под ним; подсветка — по урону. ${DAMAGE_TITLE}`, of: 'Урон и жалобы' },
};

/* J-142: что показывают колонки шагов; итог за период от выбора не зависит */
function dynamicsTabs(block, context) {
  return segmented({
    label: 'Динамика топа проблем',
    options: Object.entries(DYNAMICS).map(([value, { label, title }]) => ({ value, label, title })),
    selected: selectedDynamics,
    onSelect: (value) => {
      selectedDynamics = value;
      revealSteps = true;
      renderVerbatimCards(block, context);
    },
  });
}

/* J-139: сортировка — по частотности значений или их групп; подпись группы — по разрезу */
function orderTabs(block, context) {
  const group = selectedCut === 'categoryPair' ? 'По группам' : 'По ФО';
  const value = selectedCut === 'categoryPair' ? 'По категориям' : 'По проблемам';
  return segmented({
    label: 'Сортировка топа проблем',
    options: [
      { value: 'value', label: value, title: `${grouping().nameTitle ?? grouping().nameHead}: по числу жалоб` },
      { value: 'group', label: group, title: `${grouping().groupTitle}: сначала частые, внутри — по числу жалоб` },
    ],
    selected: selectedOrder,
    onSelect: (next) => {
      selectedOrder = next;
      renderVerbatimCards(block, context);
    },
  });
}

/* J-29: ±0,1 п. п. — нейтральный тон, направление и точные доли сохраняются. */
/* J-123: у позитива рост доли — хорошо: тоны меняются местами, направление и подпись те же */
export function shareTrend(shareDelta, { positive = false } = {}) {
  if (shareDelta === null) return { direction: 'flat', tone: 'neutral', label: 'нет данных прошлого периода' };
  /* Разность долей на границе может отличаться на погрешность float. */
  const neutral = Math.abs(shareDelta) <= 0.1 + 1e-12;
  const [rise, fall] = positive ? ['positive', 'negative'] : ['negative', 'positive'];
  if (shareDelta > 0) return { direction: 'up', tone: neutral ? 'neutral' : rise, label: 'доля выросла' };
  if (shareDelta < 0) return { direction: 'down', tone: neutral ? 'neutral' : fall, label: 'доля снизилась' };
  return { direction: 'flat', tone: 'neutral', label: 'доля без изменения' };
}

const complaints = (count) => `${formatCount(count)} ${plural(count, ['жалоба', 'жалобы', 'жалоб'])}`;
const comments = (count) => `${formatCount(count)} ${plural(count, ['комментарий', 'комментария', 'комментариев'])}`;
/* Цитата — `quoted` из format.js: та же, что при копировании отзыва из детализации (J-44) */
export { quoted };

const NO_SEGMENT = 'без сегмента';

/* Оценка отзыва: пять звёзд, заполнено по оценке. */
function reviewStars(rating) {
  const stars = element('span', 'verbatim-card__rating');
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', `Оценка отзыва: ${rating} из 5`);
  for (let index = 1; index <= 5; index += 1) {
    stars.append(icon('star', `verbatim-card__star${index <= rating ? ' verbatim-card__star--filled' : ''}`));
  }
  return stars;
}

/* Сегмент — кодом, полная подпись в подсказке (D-53) */
function segmentCode(code, label) {
  const node = element('span', null, code ?? NO_SEGMENT);
  if (code) withFullLabel(node, label('segment', code));
  return node;
}

const CHANNEL_WITH_OS = 'АБМ';
const SCALE_TABS = [{ value: 'week', label: 'Недели' }, { value: 'month', label: 'Месяцы' }];
const segmentKey = (code) => (!code || code === 'Без сегмента' ? '' : code);

function stepTabs(block, context) {
  return scaleTabs({
    label: 'Шаг частотности проблем',
    options: SCALE_TABS,
    selected: selectedScale,
    onSelect: (value) => {
      selectedScale = value;
      renderVerbatimCards(block, context);
    },
  });
}

/*
  Колонки сегментов — по всем проблемам среза. J-120: порядок как у карточек метрик (J-42) — ММБ, СБ, КИБ;
  прочие сегменты — за ними по убыванию жалоб. J-128: колонки «без сегмента» нет — такие оценки только в общем числе
*/
const SEGMENT_ORDER = metricSegments();
const segmentRank = (key) => (SEGMENT_ORDER.includes(key) ? SEGMENT_ORDER.indexOf(key) : SEGMENT_ORDER.length);

function segmentColumns(cards) {
  const totals = new Map();
  for (const card of cards) for (const { code, count } of card.segments) {
    if (segmentKey(code)) totals.set(segmentKey(code), (totals.get(segmentKey(code)) ?? 0) + count);
  }
  return [...totals].sort((left, right) => segmentRank(left[0]) - segmentRank(right[0])
    || right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))
    .map(([key]) => key);
}

const formatNegative = (value) => formatShare(value * 100);
/* В пунктах VOC — урон доли: на сколько вырос бы VOC без этих жалоб */
const pointsCaption = (share, base) => {
  const damage = damageOf(share, base);
  return damage === null ? '' : `VOC без этих жалоб — выше примерно на ${formatNumber(roundImpact(damage), 3)}`;
};
/* J-128: пустое значение — серым прочерком, а не цветом числа */
function valueCell(text, className = 'problem-table__count') {
  return text === null ? element('td', `${className} problem-table__none`, '—') : element('td', className, text);
}
const countCell = (value) => valueCell(value ? formatCount(value) : null);
const bucketCaption = (bucket) => (selectedScale === 'month' ? formatBucket(bucket.from, 'month') : formatInterval(bucket));
/*
  J-131: шапка шага — коротко, без года: «01–07.05», через границу месяца — «28.04–04.05»; год у периода блока уже есть.
  Полный диапазон — в подсказке заголовка. Месяц — «май 26», как был
*/
const dayMonth = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
export function shortBucket({ from, to }) {
  if (from.slice(0, 7) === to.slice(0, 7)) return from === to ? dayMonth(from) : `${from.slice(8, 10)}–${dayMonth(to)}`;
  return `${dayMonth(from)}–${dayMonth(to)}`;
}
const headCaption = (bucket) => (selectedScale === 'month' ? formatBucket(bucket.from, 'month') : shortBucket(bucket));
/* J-142: значение шага по выбранной динамике; урон — доля негатива шага × разрыв VOC шага */
export function stepValue(bucket, positive, gap, metric = selectedDynamics) {
  if (metric === 'count') return bucket.count || null;
  /* J-150: в режиме «Урон и жалобы» значение шага для подсветки и сравнения — урон */
  if (metric === 'both') return stepValue(bucket, positive, gap, 'damage');
  if (positive || bucket.negativeShare === null) return null;
  return metric === 'share' ? bucket.negativeShare : damageOf(bucket.negativeShare, { gap });
}
const stepText = (value, metric = selectedDynamics) => {
  if (value === null) return null;
  if (metric === 'count') return formatCount(value);
  return metric === 'share' ? formatNegative(value) : formatImpact(-roundImpact(value));
};
/* J-142: шаг подсвечен тоном негатива по силе: чем больше жалоб, доли или урона, тем краснее — как карта антидрайверов */
function bucketCell(bucket, positive, gap, heatMax) {
  const value = stepValue(bucket, positive, gap);
  let cell;
  if (selectedDynamics === 'both') {
    /* J-150: урон крупно, жалобы шага под ним тише; у похвалы урона нет — только жалобы */
    const damage = stepText(value, 'damage');
    const count = bucket.count ? formatCount(bucket.count) : null;
    if (damage === null && count === null) cell = valueCell(null, 'problem-table__count problem-table__step');
    else {
      cell = element('td', 'problem-table__count problem-table__step problem-table__step--both');
      cell.append(element('span', damage === null ? 'problem-table__step-main problem-table__none' : 'problem-table__step-main', damage ?? '—'),
        element('small', 'problem-table__step-sub', count === null ? 'нет жалоб' : complaints(bucket.count)));
    }
  } else cell = valueCell(stepText(value), 'problem-table__count problem-table__step');
  if (value !== null && heatMax > 0) cell.style.setProperty('--step-heat', `${Math.round(Math.min(1, value / heatMax) * 100)}%`);
  return cell;
}

/* J-120: частая версия — номер и сектор её доли среди жалоб проблемы; процент — в подсказке */
function versionCell(found, positive = false) {
  if (!found) return valueCell(null, 'problem-table__version');
  const cell = element('td', 'problem-table__version');
  const body = element('span', 'problem-table__version-body');
  body.append(element('span', null, found.value), sharePie(found.share, { tone: positive ? 'positive' : 'negative', label: `Версия ${found.value}: ${formatShare(found.share)} ${positive ? 'отзывов' : 'жалоб проблемы'}` }));
  cell.append(body);
  return cell;
}

function textCell(text, className = 'problem-table__text') {
  if (text === '—') return valueCell(null, className);
  const cell = element('td', className);
  const value = element('span', null, text);
  value.title = text;
  cell.append(value);
  return cell;
}

/*
  J-114, J-128: строка — значение разреза. Первая колонка — кнопка выбора (лента справа, D-26: выбор — подложкой строки
  и жирным названием); дальше группа, жалобы с долей и треугольником (J-29), урон в его режиме, шаги периода числами,
  сегменты, iOS / Android и частая версия у АБМ, частый триггер и когда чаще
*/
function problemRow(item, { columns, selected, onSelect, base }) {
  const trend = shareTrend(item.shareDelta, { positive: item.positive });
  const row = element('tr', `problem-table__row${selected ? ' is-selected' : ''}${item.positive ? ' problem-table__row--positive' : ''}`);
  row.dataset.problemKey = item.key;
  const head = element('th', 'problem-table__problem');
  head.setAttribute('scope', 'row');
  const button = element('button', 'problem-table__name');
  button.type = 'button';
  button.dataset.problemKey = item.key;
  button.setAttribute('aria-pressed', String(selected));
  button.setAttribute('aria-controls', FEED_ID);
  const few = item.count < FEW_COMPLAINTS;
  const damage = damageOf(item.negativeShare, base);
  const shareText = damage === null ? '' : `, урон ${formatImpact(-roundImpact(damage))}`;
  /* J-132: значения нет в прошлом периоде — «было —» без стрелки, а не «было 0» с ростом */
  const absent = item.previousCount === 0;
  const was = !Number.isFinite(item.previousCount) ? '' : absent ? ', в прошлом периоде не было' : `, было ${formatCount(item.previousCount)}`;
  button.setAttribute('aria-label', `${item.group ? `${item.group}: ` : ''}${nameOf(item)}. ${complaints(item.count)} за период${was}, ${formatShare(item.currentShare)}${absent ? '' : `, ${trend.label}`}${shareText}. ${comments(item.feed.length)}. Показать комментарии`);
  button.append(nameOf(item));
  head.append(button);

  const total = element('td', 'problem-table__total');
  const totalBody = element('div', 'problem-table__total-body');
  const frequency = element('span', 'verbatim-card__frequency');
  frequency.append(element('strong', null, formatCount(item.count)));
  if (Number.isFinite(item.previousCount)) {
    const previous = element('small', null, `было ${absent ? '—' : formatCount(item.previousCount)}`);
    if (absent) previous.title = 'В прошлом периоде этого значения не было';
    frequency.append(previous);
  }
  total.append(totalBody);
  /* J-136: без сравнения треугольник невидим, но место за ним остаётся — доли строк стоят в одну колонку */
  const arrowless = absent ? 'delta--no-arrow' : undefined;
  totalBody.append(frequency, delta({ text: formatShare(item.currentShare), direction: trend.direction, tone: trend.tone, caption: absent ? 'в прошлом периоде не было' : trend.label,
    plain: true, triangle: true, className: arrowless }));

  const bySegment = new Map(item.segments.map(({ code, count }) => [segmentKey(code), count]));
  row.append(head, textCell(item.group ?? '—', 'problem-table__text problem-table__group-name'), total);
  /*
    J-139, J-142: урон за период — в пунктах VOC со знаком минус, как у антидрайверов; доля негатива — в подсказке.
    J-129: при малом числе жалоб доля неустойчива — предупреждение в подсказке, подписи нет (J-136)
  */
  const damageCell = valueCell(damage === null ? null : formatImpact(-roundImpact(damage)), 'problem-table__count problem-table__damage');
  if (damage !== null) damageCell.title = [`Доля негатива ${formatNegative(item.negativeShare)}`, pointsCaption(item.negativeShare, base),
    few ? `меньше ${FEW_COMPLAINTS} жалоб — доля неустойчива` : ''].filter(Boolean).join('. ');
  row.append(damageCell);
  row.append(...columns.segments.map((code) => countCell(bySegment.get(code))));
  if (columns.os) row.append(countCell(item.os.ios), countCell(item.os.and), versionCell(item.version, item.positive));
  /* J-140: «Когда чаще» — до двух закономерностей; во сколько раз доля жалоб выше обычной — в подсказке */
  const peak = textCell(item.peak.label, `problem-table__peak problem-table__peak--${item.peak.kind}`);
  if (item.peak.title) peak.querySelector('span').title = `${item.peak.label}. ${item.peak.title}`;
  row.append(peak);
  /* J-142: динамика — после итога за период, правой частью таблицы */
  item.buckets.forEach((bucket, index) => {
    const cell = bucketCell(bucket, item.positive, columns.bucketGaps[index], columns.heatMax);
    if (index === 0) cell.classList.add('problem-table__step--first');
    row.append(cell);
  });
  row.addEventListener('click', onSelect);
  return row;
}

function tableHead(context, columns) {
  const head = element('thead');
  const row = element('tr');
  const th = (text, title) => {
    const cell = element('th', 'problem-table__head', text);
    cell.setAttribute('scope', 'col');
    if (title) cell.title = title;
    return cell;
  };
  const { groupHead, groupTitle, nameHead, nameTitle } = grouping();
  /* J-142: строка над шапкой — две части таблицы: итог «За период» и «Динамика»; разделитель — у первого шага */
  const parts = element('tr', 'problem-table__parts');
  const part = (text, span, className) => {
    const cell = element('th', `problem-table__part${className ? ` ${className}` : ''}`, text);
    cell.setAttribute('scope', 'colgroup');
    cell.colSpan = span;
    return cell;
  };
  const summarySpan = 2 + 2 + columns.segments.length + (columns.os ? 3 : 0) + 1;
  parts.append(part('', 2, 'problem-table__part--lead'), part('За период', summarySpan - 2),
    part(`Динамика · ${DYNAMICS[selectedDynamics].label.toLowerCase()} ${selectedScale === 'month' ? 'по месяцам' : 'по неделям'}`, columns.buckets.length, 'problem-table__part--steps'));
  head.append(parts);
  row.append(th(nameHead, nameTitle), th(groupHead, groupTitle));
  /* J-139: «было» — за какой период, прямо в шапке колонки: число без даты читали как непонятное */
  const was = columns.previousPeriod ? `было — ${formatInterval(columns.previousPeriod)}` : null;
  const total = th('Жалоб', `Жалоб за период${was ? `; ${was}` : ''}; доля — от кейсов с обратной связью, где проблема выявлена: без недозвонов, «без категории» и «Невозможно выделить проблему»`);
  if (was) total.append(element('small', 'problem-table__head-note', was));
  row.append(total);
  const coverage = columns.coverage === null ? '' : `. Размечено ${formatNegative(columns.coverage)} оценок 1–4`;
  row.append(th('Урон', `${DAMAGE_TITLE}${coverage}`));
  for (const code of columns.segments) row.append(th(code, context.label('segment', code)));
  if (columns.os) row.append(th('iOS'), th('Android'), th('Частая версия', 'Версия приложения, у которой больше всего жалоб, и её доля'));
  /* J-139: колонки «Частый триггер» нет — по просьбе заказчика */
  row.append(th('Когда чаще', `Доля жалоб в день недели, часть месяца или конкретную дату против среза: от ${PEAK_RULE.minComplaints} жалоб, перекос от ${formatNumber(PEAK_RULE.ratio, 1)} раза, у даты — от ${formatNumber(PEAK_RULE.dateRatio, 1)} раза. Времени оценки в выгрузке нет`));
  columns.buckets.forEach((bucket, index) => {
    const cell = th(headCaption(bucket), `${DYNAMICS[selectedDynamics].of} за ${bucketCaption(bucket)}`);
    if (index === 0) cell.classList.add('problem-table__step--first');
    row.append(cell);
  });
  head.append(row);
  return head;
}

function feedEntry(entry, label) {
  const node = element('article', 'verbatim-feed__item');
  const text = element('p', 'verbatim-feed__quote', quoted(entry.comment));
  const source = element('p', 'verbatim-feed__source');
  const date = element('time', null, formatDate(entry.date));
  date.setAttribute('datetime', entry.date);
  source.append(date, ' · ', segmentCode(entry.segment, label));
  const device = [entry.os, entry.version && `версия ${entry.version}`].filter(Boolean).join(' ');
  for (const part of [device, entry.products.join(', '), entry.triggers.join(', ')].filter(Boolean)) source.append(' · ', part);
  node.append(reviewStars(entry.rating), text, source);
  return node;
}

/* J-121: лента группы — комментарии всех её значений, каждая оценка один раз, свежие сверху, как у значения */
const feedOrder = (left, right) => right.date.localeCompare(left.date) || left.rating - right.rating || left.id.localeCompare(right.id);

/*
  J-128: группы для списка слева — по числу жалоб (уникальные оценки, а не сумма значений); «Без ФО» / «Без группы» —
  после групп жалоб, «Позитив» — последней: это не жалобы (J-123). J-129: доля негатива группы — по её уникальным оценкам
*/
function sideGroups(cards) {
  const byGroup = new Map();
  for (const item of cards) {
    if (!byGroup.has(item.group)) byGroup.set(item.group, { name: item.group, items: [], rows: new Set(), feed: new Map() });
    const group = byGroup.get(item.group);
    group.items.push(item);
    for (const row of item.rows) group.rows.add(row);
    for (const entry of item.feed) group.feed.set(entry.id, entry);
  }
  const none = grouping().none;
  return [...byGroup.values()]
    .sort((left, right) => (left.name === POSITIVE_GROUP) - (right.name === POSITIVE_GROUP)
      || (left.name === none) - (right.name === none) || right.rows.size - left.rows.size || left.name.localeCompare(right.name, 'ru'))
    .map(({ name, items, rows, feed }) => ({
      name, items, rows, count: rows.size, positive: name === POSITIVE_GROUP,
      entry: { key: groupKey(name), name, group: null, isGroup: true, feed: [...feed.values()].sort(feedOrder) },
    }));
}

function feedPanel(item, state, label) {
  const panel = element('section', 'verbatim-feed');
  panel.setAttribute('id', FEED_ID);
  panel.setAttribute('aria-label', `Комментарии: ${nameOf(item)}`);
  /* J-125: сверху служебная строка «группа · N комментариев», под ней название на всю ширину ленты — длинная проблема не дробится узким столбиком */
  const title = element('p', 'verbatim-feed__title');
  title.append(element('small', null, [item.isGroup ? `${grouping().groupHead} целиком` : item.group, comments(item.feed.length)].filter(Boolean).join(' · ')), element('span', null, nameOf(item)));
  const list = element('div', 'verbatim-feed__list');
  const paint = () => {
    list.replaceChildren(...item.feed.slice(0, state.feedShown).map((entry) => feedEntry(entry, label)));
    actions.replaceChildren(...pagingButtons({
      shown: state.feedShown, total: item.feed.length, page: FEED_PAGE,
      moreClass: 'verbatim-detail__more verbatim-feed__more', collapseClass: 'verbatim-detail__more verbatim-feed__collapse',
      moreLabel: `Показать ещё комментарии: ${nameOf(item)}`, collapseLabel: `Скрыть дополнительные комментарии: ${nameOf(item)}`,
      onMore: () => {
        const firstNew = state.feedShown;
        state.feedShown += FEED_PAGE;
        paint();
        list.children[firstNew]?.setAttribute('tabindex', '-1');
        return list.children[firstNew];
      },
      onCollapse: () => {
        state.feedShown = FEED_PAGE;
        paint();
        return actions.querySelector('.verbatim-feed__more');
      },
    }));
  };
  const actions = element('div', 'verbatim-problems__actions');
  paint();
  panel.append(title, list, actions);
  return panel;
}

const SKELETON_ENTRY = { comment: '\u00a0', date: '2026-01-01', rating: 3, segment: '\u00a0', products: [], triggers: [] };

/* Скелет — та же раскладка со скрытым содержимым: лента и таблица из пяти строк */
function skeleton() {
  const content = element('div', 'verbatim-problems');
  content.setAttribute('aria-hidden', 'true');
  const feed = element('section', 'verbatim-feed verbatim-feed--skeleton');
  const entries = element('div', 'verbatim-feed__list');
  for (let index = 0; index < 3; index += 1) entries.append(feedEntry(SKELETON_ENTRY, (dimension, code) => code));
  feed.append(element('p', 'verbatim-feed__title', '\u00a0'), entries);
  const table = element('table', 'problem-table problem-table--skeleton');
  const body = element('tbody');
  for (let index = 0; index < PROBLEM_PAGE; index += 1) {
    const row = element('tr', 'problem-table__row');
    row.append(element('td', null, '\u00a0'));
    body.append(row);
  }
  table.append(body);
  const column = element('div', 'verbatim-problems__list');
  column.append(table);
  content.append(column, feed);
  return content;
}

const unavailable = (title, detail) => statusPanel('verbatim-unavailable', { title, detail });

/* Тексты прямой речи грузятся отдельно: до них — скелетон, при ошибке — состояние ошибки */
function waitingForTexts(block, context, head) {
  if (context.verbatim.status === 'idle') context.requestVerbatim();
  if (context.verbatim.status === 'idle' || context.verbatim.status === 'loading') {
    head();
    block.setState(LOADING, skeleton());
    return true;
  }
  if (context.verbatim.status === 'error') {
    block.setState(ERROR, context.verbatim.error);
    return true;
  }
  return false;
}

/* J-139: группа строки — её место в сортировке по группам; «Позитив» и «Без ФО» / «Без группы» — после жалоб (J-123) */
function problemOrder(cards) {
  const groupRank = new Map(sideGroups(cards).map(({ name }, index) => [name, index]));
  const byGroup = (left, right) => (groupRank.get(left.group) ?? 0) - (groupRank.get(right.group) ?? 0);
  const base = cards.negative?.base ?? null;
  /* J-142: порядок — по главной метрике разреза: у ДКО — по урону, у ФО и проблематики — по жалобам */
  const rankDamage = (item) => damageOf(item.negativeShare, base) ?? -1;
  const complaintCards = cards.filter((item) => !item.positive);
  if (selectedCut === 'categoryPair') complaintCards.sort((left, right) => rankDamage(right) - rankDamage(left) || right.count - left.count);
  const praise = cards.filter((item) => item.positive);
  /* Похвала — после жалоб: без списка групп слева иначе её не найти */
  const ordered = () => (selectedOrder === 'group'
    ? [...complaintCards].sort(byGroup).concat(praise)
    : complaintCards.concat(praise));
  return { base, complaintCards, ordered };
}

function problemColumns(context, { cards, complaintCards, buckets, previous, base }) {
  const columns = {
    segments: segmentColumns(cards),
    os: context.state.channel === CHANNEL_WITH_OS,
    buckets,
    previousPeriod: previous.length ? context.previousPeriod ?? null : null,
    coverage: base?.coverage ?? null,
    bucketGaps: buckets.map((_, index) => cards.negative?.buckets?.[index]?.gap ?? 0),
  };
  /* Шкала подсветки шагов — по всем жалобам списка, а не по показанным: «Показать ещё» цвета не меняет */
  columns.heatMax = Math.max(0, ...complaintCards.flatMap((item) => item.buckets
    .map((bucket, index) => stepValue(bucket, false, columns.bucketGaps[index]) ?? 0)));
  return columns;
}

function emptyProblemRow(table) {
  const row = element('tr');
  const cell = element('td', 'problem-table__empty', 'Нет проблем по поиску');
  cell.colSpan = table.tHead?.lastElementChild?.cells.length ?? 1;
  row.append(cell);
  return row;
}

/* Выбор проблемы меняет только слот ленты: таблица и фокус остаются */
function problemTable(context, state, { cards, ordered, columns, base }) {
  const items = () => ordered().filter((item) => matchesProblemQuery(item, problemQuery));
  const visible = () => items().slice(0, state.shown);
  /* Выбор остаётся видимым: иначе — первое показанное значение */
  const keepSelection = () => {
    if (visible().some(({ key }) => key === state.selected)) return;
    state.selected = visible()[0]?.key ?? null;
    state.feedShown = FEED_PAGE;
  };
  keepSelection();
  const scroll = element('div', 'problem-table-scroll');
  const table = element('table', 'problem-table');
  const body = element('tbody');
  table.append(tableHead(context, columns), body);
  scroll.append(table);
  const buttons = element('div', 'verbatim-problems__actions');
  const feedSlot = element('div', 'verbatim-problems__feed');
  const showFeed = () => {
    const item = cards.find(({ key }) => key === state.selected);
    feedSlot.replaceChildren(item ? feedPanel(item, state, context.label) : element('div'));
  };
  const buttonOf = (key) => [...body.querySelectorAll('.problem-table__name')].find((node) => node.dataset.problemKey === key);
  const select = (item) => {
    if (state.selected === item.key) return;
    state.selected = item.key;
    state.feedShown = FEED_PAGE;
    showFeed();
    paint(item.key);
  };
  const refilter = () => {
    state.shown = PROBLEM_PAGE;
    keepSelection();
    showFeed();
    paint();
  };
  const paint = (focusKey = null) => {
    body.replaceChildren(...visible().map((item) => problemRow(item, {
      columns, base, selected: item.key === state.selected, onSelect: () => select(item),
    })));
    if (!visible().length) body.append(emptyProblemRow(table));
    if (focusKey) buttonOf(focusKey)?.focus();
    const { unit } = grouping();
    buttons.replaceChildren(...pagingButtons({
      shown: state.shown, total: items().length, page: PROBLEM_PAGE,
      moreClass: 'verbatim-detail__more verbatim-problems__more', collapseClass: 'verbatim-detail__more verbatim-problems__collapse',
      moreLabel: `Показать ещё ${unit}`, collapseLabel: `Скрыть дополнительные ${unit}`,
      onMore: () => {
        const firstNew = state.shown;
        state.shown += PROBLEM_PAGE;
        paint();
        return buttonOf(items()[firstNew]?.key);
      },
      onCollapse: () => {
        refilter();
        return buttons.querySelector('.verbatim-problems__more');
      },
    }));
  };
  showFeed();
  paint();
  return { scroll, buttons, feedSlot, refilter };
}

/* J-130: поиск — над таблицей: сужает список значений по названию и группе, лента остаётся */
function problemSearch(onChange) {
  return searchField({
    className: 'verbatim-search problem-search', inputClass: 'verbatim-search__input',
    label: selectedCut === 'categoryPair' ? 'Поиск по категории и группе' : 'Поиск по проблематике и ФО',
    placeholder: selectedCut === 'categoryPair' ? 'Поиск по категории…' : 'Поиск по проблематике…',
    value: problemQuery,
    onInput: (value) => {
      problemQuery = value;
      onChange();
    },
  }).field;
}

/* J-146, J-148: кнопка ленты — на линии раздела таблицы и ленты, общий компонент с календарём событий */
function feedToggle(content, feedSlot) {
  const apply = () => {
    content.classList.toggle('verbatim-problems--no-feed', feedHidden);
    content.classList.toggle('side-toggle-host--collapsed', feedHidden);
    feedSlot.hidden = feedHidden;
  };
  const toggle = sideToggle({
    label: 'Отзывы',
    controls: FEED_ID,
    isHidden: () => feedHidden,
    onToggle: () => {
      feedHidden = !feedHidden;
      apply();
    },
  });
  if (feedHidden) apply();
  return toggle;
}

/* J-146: перерисовка не сбрасывает горизонтальную прокрутку; после выбора шага первый шаг — в видимой области */
function restoreTableScroll(block, scrolledLeft) {
  const tableScroll = block.element?.querySelector?.('.problem-table-scroll');
  if (!tableScroll) return;
  tableScroll.scrollLeft = scrolledLeft;
  if (!revealSteps) return;
  revealSteps = false;
  /* Первый шаг — сразу за липкой колонкой названий; если шаги и так видны, прокрутка не меняется */
  const first = tableScroll.querySelector('.problem-table__step--first');
  const sticky = tableScroll.querySelector('.problem-table__problem')?.offsetWidth ?? 0;
  if (first && first.offsetLeft - tableScroll.scrollLeft > tableScroll.clientWidth - first.offsetWidth * 2) {
    tableScroll.scrollTo?.({ left: Math.max(0, first.offsetLeft - sticky), behavior: 'smooth' });
  }
}

export function renderVerbatimCards(block, context) {
  const scrolledLeft = block.element?.querySelector?.('.problem-table-scroll')?.scrollLeft ?? 0;
  const state = viewState(block, context);
  block.setHead();
  const driver = normalizeDriver(context.state.driver);
  /* J-49: выбранный на графике день блок не сужает — только период группы. J-128: выбор антидрайвера — сужает */
  const current = driverRows(context.slice, driver, context.reference);
  /* У ячейки свой интервал: прошлого периода для сравнения доли у неё нет */
  const previous = driver?.from ? [] : driverRows(context.previousSlice, driver, context.reference);
  const controls = () => [driverChip(context), cutTabs(block, context), dynamicsTabs(block, context), stepTabs(block, context)].filter(Boolean);
  const head = (extra = {}) => block.setHead({ controls: controls(), ...extra });
  if (current.length === 0) {
    head();
    if (driver) block.setContent(unavailable('Нет оценок с выбранным антидрайвером', 'Снимите выбор в шапке блока или выберите другую строку.'));
    else block.setState(EMPTY);
    return;
  }
  if (waitingForTexts(block, context, head)) return;

  const buckets = buildTimeSeries([], driver?.from ? { from: driver.from, to: driver.to } : context.period, selectedScale)
    .map(({ from, to }) => ({ from, to }));
  const cards = buildProblemCards(previous, current, context.period, context.verbatim.data, 'frequent',
    { cut: selectedCut, limit: Infinity, reference: context.reference, buckets });
  /* Табы остаются и у пустого разреза: иначе из него не вернуться */
  if (!cards.length) {
    head();
    const marked = CUT_OPTIONS.find(({ value }) => value === selectedCut).empty;
    block.setContent(unavailable('Нет размеченной прямой речи', `Для выбранного среза нет комментариев ${marked}.`));
    return;
  }

  const { base, complaintCards, ordered } = problemOrder(cards);
  const columns = problemColumns(context, { cards, complaintCards, buckets, previous, base });
  const { scroll, buttons, feedSlot, refilter } = problemTable(context, state, { cards, ordered, columns, base });
  /*
    J-136: разрез, числа и шаг — в строке поиска, а не в шапке блока: лента справа начинается от шапки и занимает всю
    высоту. Кнопка, которая прячет ленту и отдаёт её место таблице, — в шапке над лентой
  */
  const toolbar = element('div', 'problem-toolbar');
  toolbar.append(problemSearch(refilter), cutTabs(block, context), orderTabs(block, context), dynamicsTabs(block, context), stepTabs(block, context));
  const column = element('div', 'verbatim-problems__list');
  column.append(toolbar, scroll, buttons);
  const content = element('div', 'verbatim-problems');
  content.append(column, feedSlot, feedToggle(content, feedSlot));
  /* J-147: метки «Сделано с AI» у «Топ проблем» пока нет — по просьбе заказчика; лента отзывов начинается от заголовка */
  head({ controls: [driverChip(context)].filter(Boolean) });
  block.setContent(content);
  restoreTableScroll(block, scrolledLeft);
}
