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
import { fitStep, stepNote } from '../state/group-step.js';
import { searchField } from '../components/search-field.js';
import { emptyTableRow, statusPanel } from '../components/status-panel.js';
import { hScroll, rememberScroll } from '../components/h-scroll.js';
import { emptyValue } from '../components/empty-value.js';
import { tag } from '../components/tag.js';
import { heatCell } from '../components/heat-cell.js';
import { buildTimeSeries } from '../core/timeseries.js';
import { equalDaysPeriod } from '../core/period.js';
import { earliestDate } from '../core/dates.js';
import { holdPageHeight, releasePageHeight } from '../ui/page-height.js';
import { CLASSIFICATION_HINTS, FEW_COMPLAINTS, HEAT_MIN_NEGATIVE, INTENSITY_HINTS, INTENSITY_LABELS, emotionsNoteFor, heatZones, inHeatZone, NEGATIVE_EMOTIONS, SHARP_INTENSITY, NO_CATEGORY_GROUP, NO_DOMAIN, PEAK_RULE, POSITIVE_GROUP, buildProblemCards, damageOf, negativeShare, emotionTone, heatOf } from '../core/verbatim.js';
import { hotStep } from '../core/heat-scale.js';
import { callStats } from '../core/call-stats.js';
import { svgNode } from '../ui/dom.js';

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
    state = { key, shown: PROBLEM_PAGE, side: null, selected: null, feedShown: FEED_PAGE, tilePick: null };
    viewStates.set(block, state);
  }
  return state;
}

/*
  J-128: слева — группы разреза (ФО или группы негатива ДКО), в таблице — значения одним списком по убыванию жалоб.
  ДКО считается как в антидрайверах (J-33, J-34, J-109), урон — формулой ДКО (J-110)
*/
export const CUT_OPTIONS = [
  /* Подсказка разреза — что это за классификация и откуда она (CLASSIFICATION_HINTS ядра) */
  { value: 'domainProblem', label: 'Функ. область и проблематика', title: `Функциональная область и проблематика. ${CLASSIFICATION_HINTS.labeling}`, empty: 'с проблематикой' },
  { value: 'categoryPair', label: 'ДКО', title: `Группа и категория основного негатива. ${CLASSIFICATION_HINTS.dko}`, empty: 'с категорией негатива' },
];
const GROUPINGS = {
  domainProblem: { groupHead: 'Функ. область', groupTitle: 'Функциональная область', nameHead: 'Проблематика', none: NO_DOMAIN, all: 'Все функ. области',
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
  (WebKit — окно приложения, Safari) замена содержимого и фокус нового таба уносили прокрутку вверх
*/
export function keepPagePosition(anchor, action) {
  const view = anchor?.ownerDocument?.defaultView;
  const before = anchor?.getBoundingClientRect?.().top;
  if (!view?.scrollBy || !Number.isFinite(before)) return action();
  holdPageHeight(view);
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
    releasePageHeight(view);
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

/* J-348: накал — по тону эмоции (точная эмоция путается), только в «Для аналитика»: разметка не проверена вручную */
const NEGATIVE_LIST = NEGATIVE_EMOTIONS.map((emotion) => emotion.toLowerCase()).join(', ');
const HEAT_RULE = `Накалённая жалоба — негативный тон (${NEGATIVE_LIST}) с накалом ${quoted(INTENSITY_LABELS[SHARP_INTENSITY])} или ${quoted(INTENSITY_LABELS[3])}. Доля — от размеченных комментариев проблемы, при ${HEAT_MIN_NEGATIVE} и больше комментариях с негативным тоном; при меньшем — «N из M»: накалённые из размеченных комментариев. Без размеченных комментариев — нет данных. Тон и накал — автоматическая разметка`;
const HEAT_TITLE = `Сначала накалённые: по доле накалённых жалоб. ${HEAT_RULE}. Проблемы, где комментариев с негативным тоном меньше ${HEAT_MIN_NEGATIVE}, — в конце`;

const DAMAGE_TITLE = 'На сколько VOC был бы выше без этих жалоб, в пунктах VOC: доля негатива × (5 − VOC)';
const DYNAMICS = {
  count: { label: 'Частотность', title: 'Число жалоб за шаг', of: 'Жалоб' },
  share: { label: 'Доля', title: `Доля негатива за шаг, под ней — число жалоб. ${SHARE_TITLE}`, of: 'Доля негатива' },
  damage: { label: 'Урон', title: `Урон за шаг, под ним — число жалоб. ${DAMAGE_TITLE}`, of: 'Урон' },
};

/* J-142: что показывают колонки шагов; итог за период от выбора не зависит */
/*
  Урон по проблематикам — методика не согласована: в разрезе «ФО и проблематика» таб и колонка «Урон» с меткой «бета»;
  урон ДКО — своя, принятая формула (J-110), без метки
*/
export const DAMAGE_BETA = { text: 'бета', tone: 'neutral', title: 'Методика урона по проблематикам пока не согласована — значения предварительные' };
const damageBeta = () => (selectedCut === 'domainProblem' ? DAMAGE_BETA : null);

function dynamicsTabs(block, context) {
  return segmented({
    label: 'Динамика топа проблем',
    options: Object.entries(DYNAMICS).map(([value, { label, title }]) => ({ value, label, title,
      ...(value === 'damage' && damageBeta() ? { tag: damageBeta() } : {}) })),
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
/* J-348: в «Для аналитика» — ещё «Накалённые» (по доле накалённых жалоб); подпись слева тогда общая — «Сначала:» */
export const ORDER_LABEL_ANALYST = 'Сначала:';
export const HEAT_ORDER = 'Накалённые';
const ORDER_OPTIONS = { domainProblem: ['Проблематики', 'Функ. области'], categoryPair: ['Категории', 'Группы'] };
/* «Для аналитика»: «Сначала: Частые | По ФО | Накалённые» — коротко, тулбар не переносится */
const ORDER_OPTIONS_ANALYST = { domainProblem: ['Частые', 'По функ. области'], categoryPair: ['Частые', 'По группам'] };
function orderTabs(block, context) {
  const analyst = Boolean(context.analyst);
  const [value, group] = (analyst ? ORDER_OPTIONS_ANALYST : ORDER_OPTIONS)[selectedCut];
  const caption = analyst ? ORDER_LABEL_ANALYST : ORDER_LABEL;
  /* Выбор «Накалённые» на главной не живёт: там колонки накала нет */
  if (!analyst && selectedOrder === 'heat') selectedOrder = 'value';
  return segmented({
    caption,
    captionTone: 'secondary',
    label: `Сортировка топа проблем: ${(analyst ? 'сначала' : ORDER_LABEL.slice(0, -1)).toLowerCase()}`,
    options: [
      { value: 'value', label: value, title: `${grouping().nameTitle ?? grouping().nameHead}: сначала частые, по числу жалоб` },
      { value: 'group', label: group, title: `${grouping().groupTitle}: сначала частые, внутри — по числу жалоб` },
      ...(analyst ? [{ value: 'heat', label: HEAT_ORDER, title: HEAT_TITLE }] : []),
    ],
    selected: selectedOrder,
    onSelect: (next) => {
      selectedOrder = next;
      rerenderInPlace(block, context);
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
/* Шаги таблицы динамики: своего переключателя нет — шаг общий у группы аналитики */
const TABLE_STEPS = ['week', 'month'];
/*
  J-?: шаг — общий шаг группы аналитики; дни и кварталы таблице не подходят — она берёт ближайший; выбранный вручную
  шаг подписывает в динамике («по неделям: дни для таблицы слишком мелкие»), автоматический заменяет молча
*/
const STEP_FIT_REASON = { day: 'дни для таблицы слишком мелкие', quarter: 'кварталы для таблицы слишком крупные' };
const groupStepFit = { from: null };
function takeGroupStep(step, auto) {
  /* Без шага группы (блок вне группы аналитики) — недели, как раньше по умолчанию, без подписи замены */
  if (!step) {
    selectedScale = 'week';
    groupStepFit.from = null;
    return;
  }
  /* Автоматический шаг заменяется молча: подпись замены — только у выбранного вручную */
  const fit = fitStep(step, TABLE_STEPS, { auto });
  selectedScale = fit.step;
  groupStepFit.from = fit.fitted ? step : null;
}
const segmentKey = (code) => (!code || code === 'Без сегмента' ? '' : code);


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
/*
  J-348: накал проблемы — доля накалённых жалоб; при малом числе негатива — «N из M» (накалённые из размеченных) без доли, у похвалы и без
  разметки — прочерк «нет данных». Средний накал и база — в подсказке
*/
function heatCellOf(item) {
  const heat = item.positive ? null : item.heat;
  if (!heat) {
    const cell = valueCell(null, 'problem-table__count problem-table__heat');
    cell.title = item.positive ? 'Накал считается только у жалоб' : 'Нет размеченных комментариев: накала нет данных';
    return cell;
  }
  /* «N из M» — та же база, что у доли: накалённые из размеченных комментариев, а не из негатива (иначе «4 из 4» читалось бы как 100 %) */
  const text = heat.share === null ? `${formatCount(heat.sharp)} из ${formatCount(heat.labelled)}` : formatShare(heat.share);
  const cell = valueCell(text, `problem-table__count problem-table__heat${heat.share === null ? ' problem-table__heat--few' : ''}`);
  const average = heat.averageIntensity === null ? '' : `средний накал негатива ${formatNumber(heat.averageIntensity, 1)} из 3`;
  cell.title = [
    `Накалённых жалоб: ${formatCount(heat.sharp)}. Размечено комментариев: ${formatCount(heat.labelled)}, с негативным тоном: ${formatCount(heat.negative)}`,
    average,
    heat.share === null ? `комментариев с негативным тоном меньше ${HEAT_MIN_NEGATIVE} — доля не считается, показано «накалённые из размеченных комментариев»` : '',
  ].filter(Boolean).join('; ');
  return cell;
}

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
/*
  Шаг — пилюля тепловой карты (heatCell, как в антидрайверах и дайджесте): ячейка таблицы
  без заливки, сила значения — свечением, яркостью края и заливкой центра пилюли по уровню heatLevel. Похвала —
  зелёной пилюлей.
  Доля и урон — значение крупно, число жалоб шага под ним тише: частотность видна в любом режиме; в «Частотности»
  значение и есть число жалоб — второй строки нет. Пустой шаг — пилюля без тона с прочерком
*/
/*
  Шкала подсветки — квантили, а не доля от максимума: один выброс не гасит остальные. Ранг значения среди всех
  ненулевых шагов списка от 0 (наименьшее) до 1 (наибольшее), равные значения — средним рангом
*/
export function heatRank(values) {
  const sorted = values.filter((value) => value > 0).sort((left, right) => left - right);
  const last = sorted.length - 1;
  return (value) => {
    if (!(value > 0) || last < 0) return null;
    if (last === 0) return 1;
    let low = sorted.findIndex((item) => item >= value);
    if (low < 0) low = last;
    let high = low;
    while (high < last && sorted[high + 1] === value) high += 1;
    return Math.min(1, Math.max(0, (low + high) / 2 / last));
  };
}
/*
  Уровень подсветки 0…1 — смесь ранга и самого значения: 0,5 · ранг + 0,5 · √(значение / максимум). Ранг растягивает
  низ (один выброс не гасит остальные), корень из значения — верх: 19 заметно ярче 10, а 10 — ярче 5, хотя у всех
  ранг выше половины. Ноль и нет данных — null
*/
export function heatLevel(values) {
  const rank = heatRank(values);
  const max = Math.max(0, ...values.filter((value) => value > 0));
  return (value) => {
    const position = rank(value);
    if (position === null || !(max > 0)) return null;
    return Math.min(1, 0.5 * position + 0.5 * Math.sqrt(value / max));
  };
}
/*
  Уровень задаёт три свойства пилюли: радиус свечения (10–100 %), яркость края (25–100 %) и заливку центра —
  со степенью 1,8, чтобы во всю силу входили только верхние значения (0–42 % тона в центре)
*/
const HEAT_FLOOR = 0.1;
const EDGE_FLOOR = 0.25;
const FILL_MAX = 0.42;
const FILL_GAMMA = 1.8;
/*
  Горячая пилюля (макет «Топ проблем», светлая тема): верхняя треть шкалы — пять ступеней вида, от мягкой (5) у порога
  к самой яркой (1); порог и ступени — общие с картой антидрайверов (core/heat-scale.js). Включает вид тема
  (--pill-hot-on), в тёмной — прежний. Только у жалоб: светлое ядро ступеней — оттенок тона негатива
*/

function bucketCell(bucket, positive, gap, heatLevelOf, metric) {
  const value = stepValue(bucket, positive, gap, metric);
  const main = stepText(value, metric);
  /* В «Доле» и «Уроне» вторая строка у каждого шага, и у пустого («нет жалоб»): пилюли строки одной высоты */
  const withCount = metric !== 'count';
  const cell = element('td', `problem-table__count problem-table__step${withCount ? ' problem-table__step--with-count' : ''}${main === null ? ' problem-table__none' : ''}`);
  /*
    Цветом на дашборде заливаются только средний VOC и урон: в «Частотности» и «Доле» пилюля нейтральная — рамка и
    обычное число, без тона, свечения и горячих ступеней; в «Уроне» — заливка по силе
  */
  const level = value === null || metric !== 'damage' ? null : heatLevelOf(value);
  const strength = level === null ? null : HEAT_FLOOR + (1 - HEAT_FLOOR) * level;
  const pill = heatCell({ tone: level === null ? null : (positive ? 'good' : 'bad'), strength, className: 'problem-step-pill' });
  if (level !== null) {
    const edge = `${Math.round((EDGE_FLOOR + (1 - EDGE_FLOOR) * level) * 100)}%`;
    const fill = `${Math.round(FILL_MAX * level ** FILL_GAMMA * 100)}%`;
    const hot = positive ? null : hotStep(level);
    if (hot) {
      /* Край и заливка обычной пилюли гаснут, где тема включает горячий вид: значения — как базовые */
      pill.classList.add('problem-step-pill--hot', `problem-step-pill--hot-${hot}`);
      pill.style.setProperty('--pill-edge-base', edge);
      pill.style.setProperty('--pill-fill-base', fill);
    } else {
      pill.style.setProperty('--pill-edge', edge);
      pill.style.setProperty('--pill-fill', fill);
    }
  }
  const shown = element('span', 'problem-table__step-main');
  if (main === null) shown.append(emptyValue());
  else shown.append(main);
  pill.append(shown);
  if (withCount) pill.append(element('small', 'problem-table__step-sub', bucket.count ? complaints(bucket.count) : 'нет жалоб'));
  cell.append(pill);
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
  if (text === null) return valueCell(null, className);
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
  row.append(head, textCell(item.group ?? null, 'problem-table__text problem-table__group-name'), total, share);
  /*
    J-139, J-142: урон за период — в пунктах VOC со знаком минус, как у антидрайверов; доля негатива — в подсказке.
    J-129: при малом числе жалоб доля неустойчива — предупреждение в подсказке, подписи нет (J-136)
  */
  const damageCell = valueCell(damage === null ? null : formatImpact(-roundImpact(damage)), 'problem-table__count problem-table__damage');
  if (damage !== null) damageCell.title = [`Доля негатива ${formatNegative(item.negativeShare)}`, pointsCaption(item.negativeShare, base),
    few ? `меньше ${FEW_COMPLAINTS} жалоб — доля неустойчива` : ''].filter(Boolean).join('. ');
  if (columns.analyst) row.append(damageCell, heatCellOf(item));
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
    const cell = bucketCell(bucket, item.positive, columns.bucketGaps[index], columns.heatLevel, columns.metric);
    if (index === 0) cell.classList.add('problem-table__step--first');
    cell.dataset.step = String(index);
    row.append(cell);
  });
  row.addEventListener('click', onSelect);
  return row;
}

/*
  Колонка названий тянется ручкой у её правого края — как колонка названий тепловой карты антидрайверов (J-68):
  длинная проблематика читается целиком. Ширина — от исходной (токен --problem-name-flat) до NAME_WIDTH_MAX и не шире
  половины таблицы; между визитами — в localStorage как удобство зрителя. Стрелки — по 16 px, Home и двойной клик —
  исходная ширина, End — наибольшая
*/
const NAME_WIDTH_KEY = 'voc.problems.nameWidth';
export const NAME_WIDTH_MIN = 240;
export const NAME_WIDTH_MAX = 480;
const NAME_WIDTH_STEP = 16;
const NAME_DRAG_THRESHOLD = 3;
const nameWidth = { value: readNameWidth() };

function readNameWidth() {
  try {
    const stored = Number(globalThis.localStorage?.getItem(NAME_WIDTH_KEY));
    return Number.isFinite(stored) && stored > NAME_WIDTH_MIN ? Math.min(stored, NAME_WIDTH_MAX) : null;
  } catch {
    return null;
  }
}

function storeNameWidth(width) {
  try {
    if (width === null) globalThis.localStorage?.removeItem(NAME_WIDTH_KEY);
    else globalThis.localStorage?.setItem(NAME_WIDTH_KEY, String(width));
  } catch {
    /* Хранилище недоступно (приватное окно) — ширина живёт до перезагрузки */
  }
}

/** Ширина колонки названий в пределах: не уже исходной, не больше максимума и половины видимой таблицы. */
export function clampNameWidth(width, frameWidth = 0) {
  const ceiling = Math.max(NAME_WIDTH_MIN, Math.min(NAME_WIDTH_MAX, frameWidth > 0 ? Math.floor(frameWidth / 2) : NAME_WIDTH_MAX));
  return Math.round(Math.min(ceiling, Math.max(NAME_WIDTH_MIN, width)));
}

function applyNameWidth(table, resizer, width, frameWidth) {
  const shown = clampNameWidth(width ?? NAME_WIDTH_MIN, frameWidth);
  table.style.setProperty('--problem-name-width', shown === NAME_WIDTH_MIN ? '' : `${shown}px`);
  /* Прокрутке тоже: левое затухание начинается за закреплённой колонкой её текущей ширины */
  table.parentElement?.style.setProperty('--problem-name-width', shown === NAME_WIDTH_MIN ? '' : `${shown}px`);
  resizer.setAttribute('aria-valuenow', String(shown));
  resizer.setAttribute('aria-valuemax', String(clampNameWidth(Infinity, frameWidth)));
  resizer.setAttribute('aria-valuetext', `${shown} пикселей`);
  return shown;
}

function nameResizer(table) {
  const resizer = element('div', 'problem-table__resizer');
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', 'Ширина колонки названий');
  resizer.setAttribute('aria-valuemin', String(NAME_WIDTH_MIN));
  resizer.setAttribute('tabindex', '0');
  resizer.title = 'Потяните, чтобы увидеть названия длиннее. Двойной клик — исходная ширина';
  const frameWidth = () => table.parentElement?.getBoundingClientRect?.().width ?? 0;
  let shown = NAME_WIDTH_MIN;
  const set = (width) => {
    nameWidth.value = width === null ? null : clampNameWidth(width, frameWidth());
    shown = applyNameWidth(table, resizer, nameWidth.value, frameWidth());
  };
  /* Клик и выбор строки под ручкой не срабатывают: ручка — не часть строки */
  resizer.addEventListener('click', (event) => event.stopPropagation());
  resizer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = shown;
    resizer.setPointerCapture?.(event.pointerId);
    resizer.dataset.dragging = '';
    let moved = false;
    const move = (moveEvent) => {
      const shift = moveEvent.clientX - startX;
      if (!moved && Math.abs(shift) < NAME_DRAG_THRESHOLD) return;
      moved = true;
      set(startWidth + shift);
    };
    const stop = () => {
      delete resizer.dataset.dragging;
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('lostpointercapture', stop);
      if (resizer.hasPointerCapture?.(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
      if (moved) storeNameWidth(nameWidth.value);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('lostpointercapture', stop);
  });
  resizer.addEventListener('dblclick', () => {
    set(null);
    storeNameWidth(null);
  });
  resizer.addEventListener('keydown', (event) => {
    const next = { ArrowRight: shown + NAME_WIDTH_STEP, ArrowLeft: shown - NAME_WIDTH_STEP, Home: null, End: NAME_WIDTH_MAX }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    set(next);
    storeNameWidth(nameWidth.value);
  });
  /* Ширина таблицы известна после вставки: применяется в следующем кадре, сохранённая — и сразу */
  shown = applyNameWidth(table, resizer, nameWidth.value, 0);
  globalThis.requestAnimationFrame?.(() => { shown = applyNameWidth(table, resizer, nameWidth.value, frameWidth()); });
  return resizer;
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
  const summarySpan = 2 + 2 + (columns.analyst ? 3 : 0) + columns.segments.length + (columns.os ? 4 : 0);
  /*
    Над названием — закреплённая ячейка того же фона, что колонка под ней: подписи частей при горизонтальной прокрутке
    уходят под неё, а не проезжают поверх названий; над группой — пустая обычная ячейка
  */
  /*
    Над одним шагом (месяц по месяцам) подписи группы нет — название в подсказке: даже «Динамика» шире колонки шага
    и раздвинула бы её; один шаг и так равен итогу за период
  */
  const dynamicsCaption = `Динамика · ${DYNAMICS[columns.metric].label.toLowerCase()} ${stepNote(selectedScale, STEP_FIT_REASON[groupStepFit.from] ?? '')}`;
  const dynamicsPart = part(columns.buckets.length > 1 ? dynamicsCaption : '', columns.buckets.length, 'problem-table__part--steps');
  if (columns.buckets.length === 1) dynamicsPart.title = dynamicsCaption;
  parts.append(part('', 1, 'problem-table__part--lead'), part('', 1), part('За период', summarySpan - 2), dynamicsPart);
  head.append(parts);
  /* Шапки названия и группы — с источником классификации: разметка или категория из выгрузки */
  const hint = selectedCut === 'domainProblem' ? CLASSIFICATION_HINTS.labeling : CLASSIFICATION_HINTS.dko;
  const nameCell = th(nameHead, `${nameTitle ?? nameHead}. ${hint}`);
  nameCell.append(columns.resizer);
  /* Шапка группы — по левому краю, над значениями: значения группы стоят у названий */
  const groupCell = th(groupHead, `${groupTitle}. ${hint}`);
  groupCell.classList.add('problem-table__group-head');
  row.append(nameCell, groupCell);
  /* J-139: «было» — за какой период. J-195: период — в подсказке шапки и «было», а не второй строкой шапки */
  const was = columns.previousPeriod ? `было — за ${formatInterval(columns.previousPeriod)}` : null;
  /* J-348: при выбранном накале или тоне числитель — жалобы выбора, база — весь срез: так и названо в подсказках шапки */
  const zoneBase = columns.tilePick ? `. ${PICK_BASE}` : '';
  row.append(th('Жалоб', `Жалоб за период${was ? `; ${was}` : ''}${zoneBase ? `. Только жалобы: ${pickName(columns.tilePick)}` : ''}`),
    th('Доля', `Доля жалоб — от кейсов с обратной связью, где проблема выявлена: без недозвонов, «без категории» и «Невозможно выделить проблему». Треугольник — изменение доли к прошлому периоду${zoneBase}`));
  const coverage = columns.coverage === null ? '' : `. Размечено ${formatNegative(columns.coverage)} оценок 1–4`;
  if (columns.analyst) {
    const damageHead = th('Урон', `${DAMAGE_TITLE}${coverage}${zoneBase}`);
    const beta = damageBeta();
    if (beta) {
      const mark = tag(beta.text, beta.tone);
      mark.title = beta.title;
      damageHead.append(' ', mark);
    }
    row.append(damageHead, th('Накал', `Доля накалённых: выраженный и острый. ${HEAT_RULE}${columns.labelledSince ? `. ${columns.labelledSince}` : ''}${zoneBase ? '. При выбранном накале или тоне — накалённые жалобы выбора от всех размеченных комментариев проблемы' : ''}`));
  }
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
    /* Шапка шага — той же ширины, что колонка пилюль, подпись по центру в строку */
    cell.classList.add('problem-table__step');
    if (index === 0) cell.classList.add('problem-table__step--first');
    cell.dataset.step = String(index);
    row.append(cell);
  });
  head.append(row);
  return head;
}

/* Отзыв ленты: звёзды, пометка «Фрагмент экспертизы», если цитата разметки взята из экспертизы, а не из комментария клиента */
export const EXPERTISE_QUOTE = 'Фрагмент экспертизы';
export function feedEntry(entry, label) {
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
      moreClass: 'verbatim-feed__more', collapseClass: 'verbatim-feed__collapse',
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

/*
  J-348: ряд плиток-сводок над таблицей («Для аналитика») вместо полосы зон накала — «Накал», «Обзвон», «Эмоции».
  Плитка — заголовок, главное число и мини-визуализация, нейтральным приглушённым тоном: цветом на дашборде — только
  средний VOC и урон; негатив в кольце эмоций — приглушённым тоном негатива. Столбик накала и сегмент тона сужают
  «Топ проблем» и ленту (один выбор на ряд, повторное нажатие снимает); «Обзвон» ведёт к «Статистике обзвона»
*/
export const PICK_BASE = 'При выбранном накале или тоне — жалобы выбора от всех оценок среза';
export const TONE_NAMES = { negative: 'Негатив', neutral: 'Нейтрально', positive: 'Позитив' };
const TONE_ORDER = ['negative', 'neutral', 'positive'];
export const pickMatch = (pick) => (pick.zone !== undefined
  ? (row) => inHeatZone(row, pick.zone)
  : (row) => emotionTone(row.emotion ?? null) === pick.tone);
export const pickName = (pick) => (pick.zone !== undefined ? `накал ${quoted(INTENSITY_LABELS[pick.zone])}` : `тон ${quoted(TONE_NAMES[pick.tone])}`);
const samePick = (left, right) => Boolean(left && right && left.zone === right.zone && left.tone === right.tone);

function summaryTile(name, title, hint) {
  const node = element('section', `problem-tile problem-tile--${name}`);
  node.setAttribute('aria-label', title);
  const head = element('p', 'problem-tile__title', title);
  head.title = hint;
  node.append(head);
  return node;
}
const tileEmpty = (node, text) => {
  node.append(statusPanel('problem-tile__empty', { title: text, look: 'quiet' }));
  return node;
};
function tileValue(node, value, caption) {
  const line = element('p', 'problem-tile__value');
  line.append(element('strong', null, value), element('span', 'problem-tile__caption', caption));
  node.append(line);
}

function pickButton(block, context, state, pick, className, label) {
  const button = element('button', className);
  button.type = 'button';
  button.dataset.pick = pick.zone !== undefined ? `zone-${pick.zone}` : `tone-${pick.tone}`;
  const selected = samePick(state.tilePick, pick);
  button.setAttribute('aria-pressed', String(selected));
  button.setAttribute('aria-label', `${label}. ${selected ? 'Снять выбор' : 'Показать в топе и ленте только их'}`);
  button.title = label;
  button.addEventListener('click', () => {
    state.tilePick = selected ? null : pick;
    rerenderInPlace(block, context);
    block.element.querySelector(`.problem-tiles [data-pick='${button.dataset.pick}']`)?.focus();
  });
  return button;
}

/* «Накал»: доля накалённых (выраженный и острый) среди размеченных комментариев жалоб и столбики накала негативного тона словами — «Нет / Слабый / Выраженный / Острый» */
function heatTile(block, context, state, rows) {
  const node = summaryTile('heat', 'Накал', `Доля накалённых: выраженный и острый. ${HEAT_RULE}. Столбики — жалобы с негативным тоном по накалу: ${INTENSITY_LABELS.map((label) => label.toLowerCase()).join(', ')}; нажатие сужает топ и ленту`);
  const heat = heatOf(rows);
  const { zones } = heatZones(rows);
  if (!heat) return tileEmpty(node, 'Эмоции не размечены');
  tileValue(node, heat.share === null ? `${formatCount(heat.sharp)} из ${formatCount(heat.labelled)}` : formatShare(heat.share), 'накалённых');
  const bars = element('div', 'problem-tile__bars');
  const max = Math.max(1, ...zones.map(({ count }) => count));
  for (const { zone, count } of zones) {
    const button = pickButton(block, context, state, { zone }, 'problem-tile__bar', `${INTENSITY_LABELS[zone]} накал (${INTENSITY_HINTS[zone]}): ${complaints(count)}`);
    button.disabled = !count;
    button.style.setProperty('--bar-level', String(Math.round((count / max) * 100) / 100));
    button.append(element('span', 'problem-tile__bar-fill'), element('span', 'problem-tile__bar-label', INTENSITY_LABELS[zone]));
    bars.append(button);
  }
  node.append(bars);
  return node;
}

/* «Обзвон»: мини-воронка «1–3 → попытки → успешные»; счёт — core/call-stats.js, подробно — карточка «Статистика обзвона» */
function callTile(context, rows) {
  const node = summaryTile('calls', 'Обзвон', 'Сниженные оценки 1–3, попытки звонка (экспертиза УИУКО) и успешные звонки за период. Поля «звонок» в выгрузке нет — попытка определяется по экспертизе');
  const { total } = callStats(rows, context.verbatim.data, context.period, context.periodControl?.manifestPeriod ?? context.period);
  if (!total.attempts) return tileEmpty(node, 'Нет данных обзвона');
  tileValue(node, formatShare(total.successShare), 'успешных от попыток');
  const funnel = element('div', 'problem-tile__funnel');
  const steps = [
    ['1–3', total.negative, formatCount(total.negative)],
    ['Попытки', total.attempts, formatShare(total.attemptShare)],
    ['Успешные', total.success, formatShare(total.successShare)],
  ];
  for (const [label, count, text] of steps) {
    const step = element('div', 'problem-tile__step');
    step.style.setProperty('--bar-level', String(total.negative ? Math.round((count / total.negative) * 100) / 100 : 0));
    step.append(element('span', 'problem-tile__step-label', label), element('span', 'problem-tile__step-bar'), element('span', 'problem-tile__step-value', text));
    funnel.append(step);
  }
  node.append(funnel);
  const more = element('button', 'problem-tile__details', 'Подробно');
  more.type = 'button';
  more.setAttribute('aria-label', 'Статистика обзвона по месяцам — ниже на странице');
  more.addEventListener('click', () => document.querySelector('.card--call-stats')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  node.append(more);
  return node;
}

/* «Эмоции»: кольцо по тону размеченных комментариев таблицы; в центре — доля негатива, строкой — три частые негативные эмоции */
const DONUT_RADIUS = 26;
function emotionTile(block, context, state, rows) {
  const node = summaryTile('emotions', 'Эмоции', 'Тон размеченных комментариев таблицы: негатив, нейтрально, позитив. Сегмент или подпись сужают топ и ленту. Точные эмоции — в блоке «Эмоции» ниже: они размечены с меньшей уверенностью');
  const counts = Object.fromEntries(TONE_ORDER.map((tone) => [tone, 0]));
  const emotions = new Map();
  for (const row of rows) {
    const tone = emotionTone(row.emotion ?? null);
    if (tone === null) continue;
    counts[tone] += 1;
    if (tone === 'negative') emotions.set(row.emotion, (emotions.get(row.emotion) ?? 0) + 1);
  }
  const total = TONE_ORDER.reduce((sum, tone) => sum + counts[tone], 0);
  if (!total) return tileEmpty(node, 'Эмоции не размечены');
  const body = element('div', 'problem-tile__donut-row');
  const svg = svgNode('svg', 'problem-tile__donut', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
  const length = 2 * Math.PI * DONUT_RADIUS;
  let offset = 0;
  for (const tone of TONE_ORDER) {
    const part = (counts[tone] / total) * length;
    if (!part) continue;
    svg.append(svgNode('circle', `problem-tile__arc problem-tile__arc--${tone}`, {
      cx: 32, cy: 32, r: DONUT_RADIUS, 'stroke-dasharray': `${part} ${length - part}`, 'stroke-dashoffset': -offset,
    }));
    offset += part;
  }
  const center = element('span', 'problem-tile__donut-center', formatShare((counts.negative / total) * 100));
  const donut = element('div', 'problem-tile__donut-box');
  donut.append(svg, center);
  const legend = element('div', 'problem-tile__legend');
  for (const tone of TONE_ORDER) {
    if (!counts[tone]) continue;
    const share = formatShare((counts[tone] / total) * 100);
    const button = pickButton(block, context, state, { tone }, `problem-tile__tone problem-tile__tone--${tone}`, `${TONE_NAMES[tone]}: ${comments(counts[tone])}, ${share}`);
    button.append(element('span', 'problem-tile__tone-dot'), element('span', null, TONE_NAMES[tone]), element('span', 'problem-tile__tone-share', share));
    legend.append(button);
  }
  body.append(donut, legend);
  node.append(body);
  const top = [...emotions].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru')).slice(0, 3).map(([emotion]) => emotion);
  if (top.length) node.append(element('p', 'problem-tile__top', `Чаще: ${top.join(', ')}`));
  return node;
}

function summaryTiles(block, context, state, { complaintRows, cardRows, current }) {
  const tiles = element('div', 'problem-tiles');
  tiles.append(heatTile(block, context, state, complaintRows), callTile(context, current), emotionTile(block, context, state, cardRows));
  /* Период шапки раньше разметки — подпись под рядом: месяцы без разметки не считаются накалом «Нет» */
  const since = emotionsNoteFor(context);
  if (!since) return tiles;
  const wrap = element('div', 'problem-tiles-wrap');
  wrap.append(tiles, element('p', 'problem-tiles__since', since));
  return wrap;
}

function unavailable(title, detail) {
  return statusPanel('verbatim-unavailable', { title, detail });
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
  /* J-348: «Накалённые» — по доле накалённых; без доли (мало негатива или нет разметки) — в конце, там по числу накалённых и жалоб */
  const heatRank = (item) => item.heat?.share ?? -1;
  const byHeat = (left, right) => heatRank(right) - heatRank(left) || (right.heat?.sharp ?? -1) - (left.heat?.sharp ?? -1) || right.count - left.count;
  const ordered = () => {
    if (selectedOrder === 'group') return [...complaintCards].sort(byGroup).concat(praise);
    if (selectedOrder === 'heat' && analyst) return [...complaintCards].sort(byHeat).concat(praise);
    return complaintCards.concat(praise);
  };
  return { base, complaintCards, ordered };
}

function problemColumns(context, { cards, complaintCards, buckets, previous, compared, base }) {
  const columns = {
    /* Период шапки раньше разметки эмоций — подпись в подсказке «Накала»; месяц начала отдаёт контекст, иначе — по данным */
    labelledSince: emotionsNoteFor(context),
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
  columns.heatLevel = heatLevel(complaintCards.flatMap((item) => item.buckets
    .map((bucket, index) => stepValue(bucket, false, columns.bucketGaps[index], columns.metric) ?? 0)));
  return columns;
}

function emptyProblemRow(table) {
  return emptyTableRow(table.tHead?.lastElementChild?.cells.length ?? 1, 'Нет проблем по поиску', 'problem-table__empty');
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
  /* «Доля» и «Урон» с числом жалоб под значением — колонки шагов и пилюли шире */
  table.classList.toggle('problem-table--with-count', columns.metric !== 'count');
  const body = element('tbody');
  columns.resizer = nameResizer(table);
  table.append(tableHead(context, columns), body);
  /* Наведение на шаг подсвечивает его колонку — шапку и ячейки всех строк */
  const markStep = (step) => {
    for (const cell of table.querySelectorAll('.problem-table__step')) cell.classList.toggle('is-column-hover', step !== undefined && cell.dataset.step === step);
  };
  table.addEventListener('pointerover', (event) => markStep(event.target.closest?.('.problem-table__step')?.dataset.step));
  table.addEventListener('pointerleave', () => markStep());
  /* Аудит 13.11: таблица шире видимой — общая прокрутка с затуханием края (hScroll), колонка не режется посреди слова */
  const scroll = hScroll(table, { className: 'problem-table-scroll', label: 'Таблица топа проблем', fade: 'none' });
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
      moreClass: 'verbatim-problems__more', collapseClass: 'verbatim-problems__collapse',
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
    label: selectedCut === 'categoryPair' ? 'Поиск по категории и группе' : 'Поиск по проблематике и функ. области',
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
  return sideToggle({
    label: 'Отзывы',
    controls: FEED_ID,
    host: content,
    panel: feedSlot,
    hostClass: 'verbatim-problems--no-feed',
    isHidden: () => feedHidden,
    onToggle: () => {
      feedHidden = !feedHidden;
    },
    around: (change) => keepPagePosition(content, change),
  });
}

/* J-146: перерисовка не сбрасывает горизонтальную прокрутку; после выбора шага первый шаг — в видимой области */
function restoreTableScroll(restoreScroll) {
  const tableScroll = restoreScroll();
  if (!tableScroll || !revealSteps) return;
  revealSteps = false;
  /* Первый шаг — сразу за липкой колонкой названий; если шаги и так видны, прокрутка не меняется */
  const first = tableScroll.querySelector('.problem-table__step--first');
  const sticky = tableScroll.querySelector('.problem-table__problem')?.offsetWidth ?? 0;
  if (first && first.offsetLeft - tableScroll.scrollLeft > tableScroll.clientWidth - first.offsetWidth * 2) {
    tableScroll.scrollTo?.({ left: Math.max(0, first.offsetLeft - sticky), behavior: 'smooth' });
  }
}

export function renderVerbatimCards(block, context) {
  const restoreScroll = rememberScroll(block.element, '.problem-table-scroll');
  const state = viewState(block, context);
  block.setHead();
  takeGroupStep(context.step, context.stepIsAuto);
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
  const controls = () => [driverChip(context), cutTabs(block, context), metricTabs()].filter(Boolean);
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
  /*
    J-348: полоса зон — по тем же строкам, что таблица: оценки с жалобой (значение разреза, не «Позитив»), каждая один
    раз; число зоны совпадает с тем, что она открывает. Выбор зоны — у экземпляра блока; зона, которой нет, снимается
  */
  const build = (only) => buildProblemCards(previous, current, context.period, context.verbatim.data, 'frequent',
    { cut: selectedCut, limit: Infinity, reference: context.reference, buckets, ...(only ? { only } : {}) });
  const allCards = build();
  const complaintRows = [...new Set(allCards.filter((card) => !card.positive).flatMap((card) => card.rows))];
  const cardRows = [...new Set(allCards.flatMap((card) => card.rows))];
  /* Выбор плитки (накал или тон), которого нет в новом срезе, снимается */
  const tilePick = state.tilePick;
  if (!context.analyst || (tilePick && !cardRows.some(pickMatch(tilePick)))) state.tilePick = null;
  const strip = context.analyst ? summaryTiles(block, context, state, { complaintRows, cardRows, current }) : null;
  /* Выбор сужает жалобы строк и ленту; базы доли, урона и накала — от всего среза (only в buildProblemCards) */
  const chosen = state.tilePick;
  const cards = chosen === null ? allCards : build(pickMatch(chosen));
  /* Табы остаются и у пустого разреза: иначе из него не вернуться; полоса зон — тоже, иначе выбор зоны не снять */
  if (!cards.length) {
    head();
    const marked = CUT_OPTIONS.find(({ value }) => value === selectedCut).empty;
    const empty = state.tilePick === null
      ? unavailable('Нет размеченной прямой речи', `Для выбранного среза нет комментариев ${marked}.`)
      : unavailable('В выбранном накале или тоне нет размеченных жалоб', 'Нажмите выбранное ещё раз, чтобы снять выбор.');
    if (strip) {
      const wrap = element('div', 'verbatim-problems__list');
      wrap.append(strip, empty);
      block.setContent(wrap);
    } else block.setContent(empty);
    return;
  }

  const { base, complaintCards, ordered } = problemOrder(cards, Boolean(context.analyst));
  const columns = problemColumns(context, { cards, complaintCards, buckets, previous, compared, base });
  columns.tilePick = chosen;
  const { scroll, buttons, feedSlot, refilter } = problemTable(context, state, { cards, ordered, columns, base });
  /*
    J-136: разрез, числа и шаг — в строке поиска, а не в шапке блока: лента справа начинается от шапки и занимает всю
    высоту. Кнопка, которая прячет ленту и отдаёт её место таблице, — в верхней строке колонки ленты
  */
  const toolbar = element('div', 'problem-toolbar');
  toolbar.append(...[problemSearch(refilter), cutTabs(block, context), orderTabs(block, context), metricTabs()].filter(Boolean));
  const column = element('div', 'verbatim-problems__list');
  column.append(toolbar, ...(strip ? [strip] : []), scroll, ...(columns.os ? [versionLegend()] : []), buttons);
  const content = element('div', 'verbatim-problems');
  content.append(column, feedSlot, feedToggle(content, feedSlot));
  /* J-147: метки «Сделано с AI» у «Топ проблем» пока нет — по просьбе заказчика; лента отзывов начинается от заголовка */
  head({ controls: [driverChip(context)].filter(Boolean) });
  block.setContent(content);
  restoreTableScroll(restoreScroll);
}
