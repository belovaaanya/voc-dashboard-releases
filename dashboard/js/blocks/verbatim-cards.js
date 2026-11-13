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
import { hScroll } from '../components/h-scroll.js';
import { emptyValue } from '../components/empty-value.js';
import { buildTimeSeries } from '../core/timeseries.js';
import { equalDaysPeriod } from '../core/period.js';
import { earliestDate } from '../core/dates.js';
import { FEW_COMPLAINTS, NO_CATEGORY_GROUP, NO_DOMAIN, PEAK_RULE, POSITIVE_GROUP, buildProblemCards, damageOf, negativeShare } from '../core/verbatim.js';

let selectedCut = 'domainProblem';
/*
  J-142: итог за период — жалобы с «было» и долей, у аналитика ещё урон; переключатель «Динамика» (только у аналитика)
  меняет только колонки шагов: жалобы, доля негатива или урон. По умолчанию — главная метрика разреза: у ФО и проблематики —
  жалобы, у ДКО — урон; смена разреза возвращает умолчание. Порядок строк — по той же главной метрике разреза
*/
/* J-150: у ДКО по умолчанию в шаге сразу урон и жалобы — их смотрят вместе, переключаться неудобно */
/* Режима «Урон и жалобы» больше нет: число жалоб — подписью в каждом шаге; у ДКО по умолчанию — урон */
const DYNAMICS_DEFAULT = { domainProblem: 'count', categoryPair: 'damage' };
let selectedDynamics = DYNAMICS_DEFAULT.domainProblem;
/*
  Главная облегчена: «Урон», сегменты, ОС с версиями, «Есть ли закономерность?» и режимы динамики «Доля / Урон» —
  только в разделе «Для аналитика» (`context.analyst`). На главной динамика — частотность, выбор аналитика не теряется
*/
const shownDynamics = (context) => (context.analyst ? selectedDynamics : 'count');
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

/*
  Перерисовка по действию внутри блока не двигает страницу: блок остаётся на том же месте экрана. Без scroll anchoring
  (WebKit — окно приложения, Safari) замена содержимого и фокус нового таба уносили прокрутку вверх. На время
  перерисовки страница держит прежнюю высоту, после — блок возвращается на прежнее место
*/
/* Удержание общее на вложенные и частые вызовы: высоту до первого возвращает последний */
const pageHold = { depth: 0, previous: '', held: '' };
export function keepPagePosition(anchor, action) {
  const view = anchor?.ownerDocument?.defaultView;
  const before = anchor?.getBoundingClientRect?.().top;
  if (!view?.scrollBy || !Number.isFinite(before)) return action();
  const root = view.document.documentElement;
  if (pageHold.depth === 0) pageHold.previous = root.style.minHeight;
  pageHold.depth += 1;
  pageHold.held = `${Math.max(root.scrollHeight, Number.parseFloat(root.style.minHeight) || 0)}px`;
  root.style.minHeight = pageHold.held;
  const settle = () => {
    if (!anchor.isConnected) return;
    const shift = anchor.getBoundingClientRect().top - before;
    if (Math.abs(shift) >= 1) view.scrollBy(0, shift);
  };
  const result = action();
  settle();
  /* Фокус нового таба ставит переключатель уже после перерисовки — место проверяется ещё раз перед кадром */
  const release = () => {
    settle();
    pageHold.depth -= 1;
    if (pageHold.depth === 0 && root.style.minHeight === pageHold.held) root.style.minHeight = pageHold.previous;
  };
  if (view.requestAnimationFrame) view.requestAnimationFrame(release);
  else release();
  return result;
}

const rerenderInPlace = (block, context) => keepPagePosition(block.element, () => renderVerbatimCards(block, context));

function cutTabs(block, context) {
  return segmented({
    label: 'Разрез топа проблем',
    options: CUT_OPTIONS.map(({ value, label, title }) => ({ value, label, title })),
    selected: selectedCut,
    onSelect: (value) => {
      selectedCut = value;
      selectedDynamics = DYNAMICS_DEFAULT[value];
      rerenderInPlace(block, context);
    },
  });
}

const SHARE_TITLE = 'Доля значения в потерях (5 − оценка) размеченных оценок 1–4: размеченные отзывы растянуты на весь негатив. Оценка с несколькими проблемами входит в каждую';

const DAMAGE_TITLE = 'На сколько VOC был бы выше без этих жалоб, в пунктах VOC: доля негатива × (5 − VOC)';
const DYNAMICS = {
  count: { label: 'Частотность', title: 'Число жалоб за шаг', of: 'Жалоб' },
  share: { label: 'Доля', title: `Доля негатива за шаг, под ней — число жалоб. ${SHARE_TITLE}`, of: 'Доля негатива' },
  damage: { label: 'Урон', title: `Урон за шаг, под ним — число жалоб. ${DAMAGE_TITLE}`, of: 'Урон' },
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
      rerenderInPlace(block, context);
    },
  });
}

/*
  J-139: сортировка — по частотности значений или их групп. Подпись слева называет, что сортируется: «Сначала частые:
  Проблематики / ФО», у ДКО — «Категории / Группы»; поведение то же
*/
export const ORDER_LABEL = 'Сначала частые:';
const ORDER_OPTIONS = { domainProblem: ['Проблематики', 'ФО'], categoryPair: ['Категории', 'Группы'] };
function orderTabs(block, context) {
  const [value, group] = ORDER_OPTIONS[selectedCut];
  const control = element('div', 'problem-order');
  control.append(element('span', 'problem-order__label', ORDER_LABEL), segmented({
    label: `Сортировка топа проблем: ${ORDER_LABEL.slice(0, -1).toLowerCase()}`,
    options: [
      { value: 'value', label: value, title: `${grouping().nameTitle ?? grouping().nameHead}: сначала частые, по числу жалоб` },
      { value: 'group', label: group, title: `${grouping().groupTitle}: сначала частые, внутри — по числу жалоб` },
    ],
    selected: selectedOrder,
    onSelect: (next) => {
      selectedOrder = next;
      rerenderInPlace(block, context);
    },
  }));
  return control;
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
      rerenderInPlace(block, context);
    },
  });
}

/*
  Колонки сегментов — только ММБ, СБ, КИБ в порядке карточек метрик (J-42, J-120) и только те, что есть в срезе.
  N/A, «Без сегмента» (J-128) и новые коды колонкой не выводятся — их оценки только в общем числе жалоб
*/
const SEGMENT_ORDER = metricSegments();

function segmentColumns(cards) {
  const present = new Set(cards.flatMap((card) => card.segments.map(({ code }) => segmentKey(code))));
  return SEGMENT_ORDER.filter((code) => present.has(code));
}

const formatNegative = (value) => formatShare(value * 100);
/* В пунктах VOC — урон доли: на сколько вырос бы VOC без этих жалоб */
const pointsCaption = (share, base) => {
  const damage = damageOf(share, base);
  return damage === null ? '' : `VOC без этих жалоб — выше примерно на ${formatNumber(roundImpact(damage), 3)}`;
};
/* J-128: пустое значение — серым прочерком, а не цветом числа */
/* Пустое значение — общий прочерк emptyValue (аудит 13.11): один вид на всех страницах */
function valueCell(text, className = 'problem-table__count') {
  if (text !== null) return element('td', className, text);
  const cell = element('td', `${className} problem-table__none`);
  cell.append(emptyValue());
  return cell;
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
  if (positive || bucket.negativeShare === null) return null;
  return metric === 'share' ? bucket.negativeShare : damageOf(bucket.negativeShare, { gap });
}
const stepText = (value, metric) => {
  if (value === null) return null;
  if (metric === 'count') return formatCount(value);
  return metric === 'share' ? formatNegative(value) : formatImpact(-roundImpact(value));
};
/* J-142: шаг подсвечен тоном негатива по силе: чем больше жалоб, доли или урона, тем краснее — как карта антидрайверов */
function bucketCell(bucket, positive, gap, heatMax, metric) {
  const value = stepValue(bucket, positive, gap, metric);
  let cell;
  const main = stepText(value, metric);
  /*
    Доля и урон — значение крупно, число жалоб шага под ним тише: частотность видна в любом режиме. В «Частотности»
    значение и есть число жалоб — второй строки нет. У похвалы доли и урона нет — прочерк и жалобы под ним
  */
  if (metric === 'count' || (main === null && !bucket.count)) cell = valueCell(main, 'problem-table__count problem-table__step');
  else {
    cell = element('td', 'problem-table__count problem-table__step problem-table__step--with-count');
    const value = element('span', main === null ? 'problem-table__step-main problem-table__none' : 'problem-table__step-main', main ?? '');
    if (main === null) value.append(emptyValue());
    cell.append(value,
      element('small', 'problem-table__step-sub', bucket.count ? complaints(bucket.count) : 'нет жалоб'));
  }
  if (value !== null && heatMax > 0) cell.style.setProperty('--step-heat', `${Math.round(Math.min(1, value / heatMax) * 100)}%`);
  return cell;
}

/* J-120: частая версия — номер и сектор её доли; процент — в подсказке. J-190: у каждой ОС своя, доля — от жалоб с этой ОС */
function versionCell(found, os, positive = false) {
  if (!found) return valueCell(null, 'problem-table__version');
  const cell = element('td', 'problem-table__version');
  const body = element('span', 'problem-table__version-body');
  const label = `${os} ${found.value}: ${formatShare(found.share)} ${positive ? 'отзывов' : 'жалоб'} проблемы с ${os}`;
  const pie = sharePie(found.share, { tone: positive ? 'positive' : 'negative', label });
  /* J-195: подсказка — на номере и круге вместе, одна: в маленький круг трудно попасть указателем */
  pie.removeAttribute('title');
  body.append(element('span', null, found.value), pie);
  body.title = `${label}. Закрашенная часть круга — эта доля`;
  cell.append(body);
  return cell;
}

/* J-195: круг у частой версии читали не все — легенда под таблицей, когда колонки версий есть */
export const VERSION_LEGEND = 'доля частой версии среди жалоб проблемы с этой ОС';
function versionLegend() {
  const legend = element('p', 'problem-table__legend');
  const pie = sharePie(30);
  pie.removeAttribute('role');
  pie.setAttribute('aria-hidden', 'true');
  legend.append(pie, element('span', null, `— ${VERSION_LEGEND}`));
  return legend;
}

export const PATTERN_HEAD = 'Есть ли закономерность?';
const NO_PATTERN = new Set(['few', 'none']);

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
  и жирным названием); дальше группа, жалобы и доля с треугольником (J-29), у аналитика — урон, сегменты, iOS / Android
  и частая версия у АБМ, «Есть ли закономерность?»; затем шаги периода
*/
function problemRow(item, { columns, selected, onSelect, base }) {
  const { previousPeriod } = columns;
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
  /* Урон в имени строки — только там, где его колонка видна */
  const shareText = damage === null || !columns.analyst ? '' : `, урон ${formatImpact(-roundImpact(damage))}`;
  /* J-132: значения нет в прошлом периоде — «было —» без стрелки, а не «было 0» с ростом */
  const absent = item.previousCount === 0;
  const was = !Number.isFinite(item.previousCount) ? '' : absent ? ', в прошлом периоде не было' : `, было ${formatCount(item.previousCount)}`;
  button.setAttribute('aria-label', `${item.group ? `${item.group}: ` : ''}${nameOf(item)}. ${complaints(item.count)} за период${was}, ${formatShare(item.currentShare)}${absent ? '' : `, ${trend.label}`}${shareText}. ${comments(item.feed.length)}. Показать комментарии`);
  /* Название длиннее двух строк обрезается многоточием (на внутреннем span: у button clamp работает не везде) — целиком в подсказке */
  const label = element('span', 'problem-table__name-text', nameOf(item));
  label.title = nameOf(item);
  button.append(label);
  head.append(button);

  /*
    J-195: жалобы, «было» и доля — не одной строкой. Число жалоб крупно, «было N» — тише строкой под ним,
    период «было» — в подсказке; доля с треугольником — своей колонкой
  */
  const total = element('td', 'problem-table__count problem-table__total');
  const frequency = element('span', 'problem-table__stack');
  frequency.append(element('strong', null, formatCount(item.count)));
  if (Number.isFinite(item.previousCount)) {
    const previous = element('small', 'problem-table__was', `было ${absent ? '—' : formatCount(item.previousCount)}`);
    previous.title = absent ? 'В прошлом периоде этого значения не было' : `${item.positive ? 'Отзывов' : 'Жалоб'} за ${previousPeriod ? formatInterval(previousPeriod) : 'прошлый период'}`;
    frequency.append(previous);
  }
  total.append(frequency);
  const share = element('td', 'problem-table__count problem-table__share');
  /* J-136: без сравнения треугольник невидим, но место за ним остаётся — доли строк стоят в одну колонку */
  const arrowless = absent ? 'delta--no-arrow' : undefined;
  share.append(delta({ text: formatShare(item.currentShare), direction: trend.direction, tone: trend.tone, caption: absent ? 'в прошлом периоде не было' : trend.label,
    plain: true, triangle: true, className: arrowless }));

  const bySegment = new Map(item.segments.map(({ code, count }) => [segmentKey(code), count]));
  row.append(head, textCell(item.group ?? '—', 'problem-table__text problem-table__group-name'), total, share);
  /*
    J-139, J-142: урон за период — в пунктах VOC со знаком минус, как у антидрайверов; доля негатива — в подсказке.
    J-129: при малом числе жалоб доля неустойчива — предупреждение в подсказке, подписи нет (J-136)
  */
  const damageCell = valueCell(damage === null ? null : formatImpact(-roundImpact(damage)), 'problem-table__count problem-table__damage');
  if (damage !== null) damageCell.title = [`Доля негатива ${formatNegative(item.negativeShare)}`, pointsCaption(item.negativeShare, base),
    few ? `меньше ${FEW_COMPLAINTS} жалоб — доля неустойчива` : ''].filter(Boolean).join('. ');
  if (columns.analyst) row.append(damageCell);
  row.append(...columns.segments.map((code) => countCell(bySegment.get(code))));
  if (columns.os) {
    row.append(countCell(item.os.ios), versionCell(item.versions.ios, 'iOS', item.positive),
      countCell(item.os.and), versionCell(item.versions.and, 'Android', item.positive));
  }
  /*
    J-140: «Когда чаще» — до двух закономерностей; во сколько раз доля жалоб выше обычной — в подсказке.
    J-195: каждая закономерность — своей строкой, колонка по левому краю и отделена от соседней
  */
  /* Колонка «Есть ли закономерность?»: «мало жалоб» и «нет закономерности» — серым прочерком, причина — в подсказке */
  const pattern = !NO_PATTERN.has(item.peak.kind);
  const peak = pattern ? element('td', `problem-table__peak problem-table__peak--${item.peak.kind}`)
    : valueCell(null, `problem-table__peak problem-table__peak--${item.peak.kind}`);
  if (pattern) {
    const lines = element('span', 'problem-table__peak-lines');
    for (const line of item.peak.lines ?? [item.peak.label]) lines.append(element('span', null, line));
    if (item.peak.title) lines.title = `${item.peak.label}. ${item.peak.title}`;
    peak.append(lines);
  } else peak.title = item.peak.kind === 'few' ? `Меньше ${complaints(PEAK_RULE.minComplaints)} — закономерность не ищется` : 'Закономерности нет';
  if (columns.analyst) row.append(peak);
  /* J-142: динамика — после итога за период, правой частью таблицы */
  item.buckets.forEach((bucket, index) => {
    const cell = bucketCell(bucket, item.positive, columns.bucketGaps[index], columns.heatMax, columns.metric);
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
  /* Название и группа — без подписи части; итог — жалобы, доля, урон, сегменты, ОС с версиями и «Когда чаще» */
  const summarySpan = 2 + 2 + (columns.analyst ? 2 : 0) + columns.segments.length + (columns.os ? 4 : 0);
  parts.append(part('', 2, 'problem-table__part--lead'), part('За период', summarySpan - 2),
    part(`Динамика · ${DYNAMICS[columns.metric].label.toLowerCase()} ${selectedScale === 'month' ? 'по месяцам' : 'по неделям'}`, columns.buckets.length, 'problem-table__part--steps'));
  head.append(parts);
  row.append(th(nameHead, nameTitle), th(groupHead, groupTitle));
  /* J-139: «было» — за какой период. J-195: период — в подсказке шапки и «было», а не второй строкой шапки */
  const was = columns.previousPeriod ? `было — за ${formatInterval(columns.previousPeriod)}` : null;
  row.append(th('Жалоб', `Жалоб за период${was ? `; ${was}` : ''}`),
    th('Доля', 'Доля жалоб — от кейсов с обратной связью, где проблема выявлена: без недозвонов, «без категории» и «Невозможно выделить проблему». Треугольник — изменение доли к прошлому периоду'));
  const coverage = columns.coverage === null ? '' : `. Размечено ${formatNegative(columns.coverage)} оценок 1–4`;
  if (columns.analyst) row.append(th('Урон', `${DAMAGE_TITLE}${coverage}`));
  for (const code of columns.segments) row.append(th(code, context.label('segment', code)));
  if (columns.os) {
    const versionHead = (os) => th(`Версия ${os}`, `Частая версия ${os} в жалобах проблемы. Круг — её доля среди жалоб проблемы с ${os}: закрашенная часть — доля`);
    row.append(th('iOS'), versionHead('iOS'), th('Android'), versionHead('Android'));
  }
  /* J-139: колонки «Частый триггер» нет — по просьбе заказчика */
  const peakHead = th(PATTERN_HEAD, `Доля жалоб в день недели, часть месяца или конкретную дату против среза: от ${PEAK_RULE.minComplaints} жалоб, перекос от ${formatNumber(PEAK_RULE.ratio, 1)} раза, у даты — от ${formatNumber(PEAK_RULE.dateRatio, 1)} раза. Времени оценки в выгрузке нет. Прочерк — меньше ${complaints(PEAK_RULE.minComplaints)} или закономерности нет`);
  peakHead.classList.add('problem-table__peak-head');
  if (columns.analyst) row.append(peakHead);
  columns.buckets.forEach((bucket, index) => {
    const cell = th(headCaption(bucket), `${DYNAMICS[columns.metric].of} за ${bucketCaption(bucket)}`);
    if (index === 0) cell.classList.add('problem-table__step--first');
    row.append(cell);
  });
  head.append(row);
  return head;
}

/* Отзыв ленты: звёзды, пометка «Фрагмент экспертизы», если цитата разметки взята из экспертизы, а не из комментария клиента */
export const EXPERTISE_QUOTE = 'Фрагмент экспертизы';
function feedEntry(entry, label) {
  const node = element('article', 'verbatim-feed__item');
  const text = element('p', 'verbatim-feed__quote', quoted(entry.comment));
  const badge = entry.expertise ? [element('p', 'verbatim-feed__kind', EXPERTISE_QUOTE)] : [];
  const source = element('p', 'verbatim-feed__source');
  const date = element('time', null, formatDate(entry.date));
  date.setAttribute('datetime', entry.date);
  source.append(date, ' · ', segmentCode(entry.segment, label));
  const device = [entry.os, entry.version && `версия ${entry.version}`].filter(Boolean).join(' ');
  for (const part of [device, entry.products.join(', '), entry.triggers.join(', ')].filter(Boolean)) source.append(' · ', part);
  node.append(reviewStars(entry.rating), ...badge, text, source);
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

/* Пустой разрез — тоже без проявления: переключение туда и обратно меняет только содержимое (data-steady) */
function unavailable(title, detail) {
  const panel = statusPanel('verbatim-unavailable', { title, detail });
  panel.setAttribute('data-steady', '');
  return panel;
}

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
function problemOrder(cards, analyst) {
  const groupRank = new Map(sideGroups(cards).map(({ name }, index) => [name, index]));
  const byGroup = (left, right) => (groupRank.get(left.group) ?? 0) - (groupRank.get(right.group) ?? 0);
  const base = cards.negative?.base ?? null;
  /* J-142: порядок — по главной метрике разреза: у ДКО — по урону, у ФО и проблематики — по жалобам */
  const rankDamage = (item) => damageOf(item.negativeShare, base) ?? -1;
  const complaintCards = cards.filter((item) => !item.positive);
  /* На главной урона не видно — порядок ДКО по жалобам, как у ФО и проблематики */
  if (selectedCut === 'categoryPair' && analyst) complaintCards.sort((left, right) => rankDamage(right) - rankDamage(left) || right.count - left.count);
  const praise = cards.filter((item) => item.positive);
  /* Похвала — после жалоб: без списка групп слева иначе её не найти */
  const ordered = () => (selectedOrder === 'group'
    ? [...complaintCards].sort(byGroup).concat(praise)
    : complaintCards.concat(praise));
  return { base, complaintCards, ordered };
}

function problemColumns(context, { cards, complaintCards, buckets, previous, compared, base }) {
  const columns = {
    analyst: Boolean(context.analyst),
    metric: shownDynamics(context),
    segments: context.analyst ? segmentColumns(cards) : [],
    os: Boolean(context.analyst) && context.state.channel === CHANNEL_WITH_OS,
    buckets,
    previousPeriod: previous.length ? compared : null,
    coverage: base?.coverage ?? null,
    bucketGaps: buckets.map((_, index) => cards.negative?.buckets?.[index]?.gap ?? 0),
  };
  /* Шкала подсветки шагов — по всем жалобам списка, а не по показанным: «Показать ещё» цвета не меняет */
  columns.heatMax = Math.max(0, ...complaintCards.flatMap((item) => item.buckets
    .map((bucket, index) => stepValue(bucket, false, columns.bucketGaps[index], columns.metric) ?? 0)));
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
  const table = element('table', 'problem-table');
  const body = element('tbody');
  table.append(tableHead(context, columns), body);
  /* Аудит 13.11: таблица шире видимой — общая прокрутка с затуханием края (hScroll), колонка не режется посреди слова */
  const scroll = hScroll(table, { className: 'problem-table-scroll', label: 'Таблица топа проблем' });
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
      /* «Скрыть» убирает строки над кнопкой: кнопка остаётся под указателем, страница не прыгает */
      onCollapse: () => {
        keepPagePosition(buttons, refilter);
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

/* J-146, J-148: кнопка ленты — круг в правом верхнем углу раскладки, общий компонент с календарём событий */
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
    onToggle: () => keepPagePosition(content, () => {
      feedHidden = !feedHidden;
      apply();
    }),
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
  /*
    «Было» и изменение доли — за равное число дней прошлого периода от его начала: неполный месяц не сравнивается
    с полным (equalDaysPeriod). Окно раньше начала выгрузки — сравнения нет
  */
  const dataFrom = context.periodControl?.manifestPeriod?.from ?? (earliestDate(context.rows ?? []) || null);
  const compared = driver?.from ? null : equalDaysPeriod(context.period, context.previousPeriod, dataFrom);
  const previous = compared ? driverRows(context.previousSlice, driver, context.reference)
    .filter(({ appeal_date: date }) => date >= compared.from && date <= compared.to) : [];
  const metricTabs = () => (context.analyst ? dynamicsTabs(block, context) : null);
  const controls = () => [driverChip(context), cutTabs(block, context), metricTabs(), stepTabs(block, context)].filter(Boolean);
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

  const { base, complaintCards, ordered } = problemOrder(cards, Boolean(context.analyst));
  const columns = problemColumns(context, { cards, complaintCards, buckets, previous, compared, base });
  const { scroll, buttons, feedSlot, refilter } = problemTable(context, state, { cards, ordered, columns, base });
  /*
    J-136: разрез, числа и шаг — в строке поиска, а не в шапке блока: лента справа начинается от шапки и занимает всю
    высоту. Кнопка, которая прячет ленту и отдаёт её место таблице, — в верхней строке колонки ленты
  */
  const toolbar = element('div', 'problem-toolbar');
  toolbar.append(...[problemSearch(refilter), cutTabs(block, context), orderTabs(block, context), metricTabs(), stepTabs(block, context)].filter(Boolean));
  const column = element('div', 'verbatim-problems__list');
  column.append(toolbar, scroll, ...(columns.os ? [versionLegend()] : []), buttons);
  const content = element('div', 'verbatim-problems');
  /*
    Переключатели блока перестраивают его целиком, но проявление (D-56) здесь не нужно: поиск, табы и кнопки мигали
    бы при каждом клике, а таблица и лента — с пустого кадра. Меняются только данные; выбор показывает рамка таба
  */
  content.setAttribute('data-steady', '');
  content.append(column, feedSlot, feedToggle(content, feedSlot));
  /* J-147: метки «Сделано с AI» у «Топ проблем» пока нет — по просьбе заказчика; лента отзывов начинается от заголовка */
  head({ controls: [driverChip(context)].filter(Boolean) });
  block.setContent(content);
  restoreTableScroll(block, scrolledLeft);
}
