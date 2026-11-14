import {
  ANOMALY_MIN_WINDOW_VALUES,
  ANOMALY_WINDOW_DAYS,
  MIN_EVENT_RATINGS,
  VOC_METRIC,
  isWorkingDay,
} from '../core/anomalies.js';
import { DATA_LOSS_ALPHA, DATA_LOSS_MIN_ACTIVE_DAYS, DATA_LOSS_MIN_DAILY, DATA_LOSS_MIN_PERIOD_RATINGS, DATA_LOSS_RATIO, DATA_LOSS_VOLUME_DAYS, DATA_LOSS_WINDOW } from '../core/data-loss.js';
import { INCIDENT_MIN_DAYS, INCIDENT_MIN_DAY_RATINGS, INCIDENT_MIN_RATINGS, INCIDENT_PLAN_GAP, INCIDENT_TOP_TRIGGERS } from '../core/calendar-analysis.js';
import { latestDate } from '../core/dates.js';
import { selectionDays } from '../state/chart-selection.js';
import { EMPTY } from '../shell/block.js';
import { calendarAnomalies, hasEvaluatedSlice } from '../core/calendar-analysis.js';
import { CRITICAL_DROP_ALPHA, CRITICAL_DROP_EXACT_RATINGS, CRITICAL_DROP_MIN, CRITICAL_DROP_MIN_WINDOW_RATINGS } from '../core/critical-drop.js';
import { accidentColor } from '../core/incident-events.js';
import { eventDetail, sameDetailEvent } from '../state/detail-event.js';
import {
  ANOMALY_EVENT,
  DATA_LOSS_EVENT,
  EVENT_LANES,
  INCIDENT_EVENT,
  NEW_SLICE_EVENT,
  NEW_SLICE_MIN_DAILY,
  RELEASE_EVENT,
  RELEASE_BASELINE_RATINGS,
  RELEASE_LAG_DAYS,
  ROLLOUT_EVENT,
  SUSTAINED_EVENT,
  coversDay,
  eventType,
  sortEvents,
  workingDaysCaption,
} from '../core/calendar.js';
import { signTone } from '../components/delta.js';
import { focusChip, selectionChip } from '../components/focus-chip.js';
import { statusDot } from '../components/status-dot.js';
import { searchField } from '../components/search-field.js';
import { statusPanel } from '../components/status-panel.js';
import { emptyValue } from '../components/empty-value.js';
import { tag } from '../components/tag.js';
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { bindPopover, popoverPanel } from '../ui/popover.js';
import { formatCount, formatDate, formatDayRange, formatDuration, formatEventTime, formatDelta, formatNumber, formatRatings, formatSigned, formatVoc, plural, quoted } from '../core/format.js';
import { CRITICAL } from '../core/insights.js';
import { ABOVE_PLAN, BELOW_PLAN, IN_PLAN } from '../core/plan.js';
import { roundDelta, roundFrequency, roundShare, roundVoc } from '../core/round.js';
import { DIMENSION_CAPTION, osName } from '../core/dimensions.js';
import { calendarEventsOf, eventSelectionContext, hasFilters, historyOf } from '../state/event-analysis.js';

const NBSP = ' ';

const PLAN_CAPTION = { [BELOW_PLAN]: 'ниже плана', [IN_PLAN]: 'в плане', [ABOVE_PLAN]: 'выше плана' };

/* J-50: одна лента всех событий; чипы сужают её до выбранных типов, без выбора — всё сразу */
const selectedKinds = new WeakMap();
/* Один live-region на блок переживает перерисовку: смена состава ленты после чипа слышна screen reader */
const feedStatus = new WeakMap();
/* Запрос поиска — у своего блока, как выбор типов: перерисовка его не сбрасывает */
const searchQueries = new WeakMap();
const DAY_FORMS = ['день', 'дня', 'дней'];
/* Часть строки события, которая не рвётся: «1 234 оценки», «началась до периода» */
const SHORT_PART = 24;
const daysCaption = (count) => `${formatCount(count)}${NBSP}${plural(count, DAY_FORMS)}`;
/* Порог задержки релиза словами: «3 дня» */
function releaseLag() {
  return daysCaption(RELEASE_LAG_DAYS);
}

/*
  J-48: «Аномалии» переименованы в «Критическое снижение» — так снижения называют пользователи.
  J-138: у каждого типа — пояснение, что считается событием. J-143: пояснения — не в чипах, а в окне по значку «i» у
  заголовка блока, у каждого типа — его цветные метки из ленты (`tags`)
*/
/*
  Ревью 13.11: чипы и окно «Типы событий» — двумя группами: сначала то, что считается из оценок (снижение VOC,
  провал числа оценок, инцидент, новый срез), потом внешние события из листов (авария, релизы, раскатки).
  «Критическое снижение» → «Крит. снижение VOC», «Пропажа данных» → «Провал оценок»; раскатка подписана каналом
*/
export const KIND_GROUPS = [{ value: 'ratings', label: 'По оценкам' }, { value: 'external', label: 'Внешние события' }];

/*
  Главная облегчена (раздел «Для аналитика», J-228): на ней — снижение VOC, аварии, релизы и раскатки;
  провал оценок, новый срез и инцидент — только при `context.analyst`. Выбор типа, сделанный в разделе аналитика,
  на главной не применяется к скрытым типам
*/
const MAIN_KINDS = new Set([ANOMALY_EVENT, INCIDENT_EVENT, RELEASE_EVENT, ROLLOUT_EVENT]);

/** Типы событий страницы: в разделе аналитика — все, на главной — без продвинутых. */
export function kindsOf(context) {
  return context.analyst ? KINDS : KINDS.filter(({ value }) => MAIN_KINDS.has(value));
}

/*
  Иконка типа (неделя 16–22.11): один цвет на тип — красный снижения VOC, бирюзовый провала оценок, малиновый
  инцидента, фиолетовый нового среза, оранжевый аварии, зелёный релиза, серый раскатки. Цвет тега строки (план,
  тяжесть аварии) остаётся своим: иконка говорит «что это», тег — «насколько»
*/
const KIND_ICON = Object.fromEntries(EVENT_LANES.map(({ kind, tone }) => [kind, tone]));

/** Подпись типа: у раскатки — с каналом («Раскатка НИБ»), остальные — как в `KINDS`. */
export function kindLabel({ label, channelLabel }, channel) {
  return channelLabel && channel ? `${label} ${channel}` : label;
}

export const KINDS = [
  { value: ANOMALY_EVENT, group: 'ratings', label: 'Крит. снижение VOC', tags: [{ label: 'Снижение VOC ниже плана', color: 'negative' }, { label: 'Снижение VOC', color: 'orange' }] },
  { value: DATA_LOSS_EVENT, group: 'ratings', label: 'Провал оценок', tags: [{ label: 'Провал оценок', color: 'data-loss' }] },
  { value: SUSTAINED_EVENT, group: 'ratings', label: 'Инцидент', tags: [{ label: 'Инцидент 3\u00a0дн', color: 'negative' }] },
  { value: NEW_SLICE_EVENT, group: 'ratings', label: 'Новый срез', tags: [{ label: 'Новый срез', color: 'purple' }] },
  { value: INCIDENT_EVENT, group: 'external', label: 'Авария', tags: [{ label: 'Авария', color: 'negative' }] },
  { value: RELEASE_EVENT, group: 'external', label: 'Релизы АБМ', tags: [{ label: 'Релиз АБМ', color: 'neutral' }, { label: 'Релиз без оценок', color: 'data-loss' }, { label: 'Релиз: оценки через 5\u00a0дн', color: 'data-loss' }] },
  { value: ROLLOUT_EVENT, group: 'external', label: 'Раскатка', channelLabel: true, tags: [{ label: 'Раскатка', color: 'neutral' }] },
];

/*
  Неделя 16–22.11: пояснение типа — формула, а не абзац: «что / с чем сравнивается / отсечка / объём» для расчётных
  типов, «источник / что показываем / не сравнивается» для внешних. Числа — из констант расчёта, текст их не дублирует
*/
const percent = (share) => `${formatNumber(share * 100, 0)}\u00a0%`;
const days = (count, forms) => `${formatCount(count)}\u00a0${plural(count, forms)}`;
const WORKING = ['рабочий день', 'рабочих дня', 'рабочих дней'];
const CALENDAR = ['календарный день', 'календарных дня', 'календарных дней'];
const PAST = ['прошлый день', 'прошлых дня', 'прошлых дней'];
const RATED = ['день с оценками', 'дня с оценками', 'дней с оценками'];
const times = (count) => `${formatCount(count)}\u00a0${plural(count, ['раз', 'раза', 'раз'])}`;
export const KIND_RULES = {
  [ANOMALY_EVENT]: [
    ['Что', 'VOC разреза за день: канал, сегмент, триггер, продукт, ОС'],
    ['Сравнение', `средняя всех оценок за ${days(ANOMALY_WINDOW_DAYS, WORKING)} до дня (пн–пт, праздники не выделяются); выходной — за ${days(ANOMALY_WINDOW_DAYS, CALENDAR)}`],
    ['Отсечка', `ниже на ≥\u00a0${formatNumber(CRITICAL_DROP_MIN, 1)} и p\u00a0<\u00a0${percent(CRITICAL_DROP_ALPHA)}; у дня до ${formatRatings(CRITICAL_DROP_EXACT_RATINGS)} — значимо и без его самой низкой оценки`],
    ['Мин. объём', `в окне ≥\u00a0${formatRatings(CRITICAL_DROP_MIN_WINDOW_RATINGS)} и ≥\u00a0${days(ANOMALY_MIN_WINDOW_VALUES, RATED)}; разрез ≥\u00a0${formatRatings(MIN_EVENT_RATINGS)} за период`],
    ['Цвет тега', 'красный — ниже плана, жёлтый — в плане, мятный — выше плана, оранжевый — плана нет'],
  ],
  [DATA_LOSS_EVENT]: [
    ['Что', 'число оценок разреза за день: срез, ОС, сегмент, продукт, триггер, роль'],
    ['Сравнение', `средняя за ${days(DATA_LOSS_WINDOW, PAST)} того же типа (будни — с буднями, выходные и праздники — с выходными), с поправкой на просадку остального канала в этот день`],
    ['Отсечка', `≤\u00a0${formatNumber(DATA_LOSS_RATIO * 100, 0)}\u00a0% ожидания (в ${times(Math.round(1 / DATA_LOSS_RATIO))} меньше) или 0 и p\u00a0<\u00a0${percent(DATA_LOSS_ALPHA)} с поправкой Бенджамини — Хохберга на все разрезы дня`],
    ['Мин. объём', `разрез ≥\u00a0${formatRatings(DATA_LOSS_MIN_PERIOD_RATINGS)} за ${days(DATA_LOSS_VOLUME_DAYS, CALENDAR)} до дня; в среднем ≥\u00a0${formatCount(DATA_LOSS_MIN_DAILY)} в день, оценки в ≥\u00a0${formatCount(DATA_LOSS_MIN_ACTIVE_DAYS)} днях из ${formatCount(DATA_LOSS_WINDOW)}`],
    ['Не считается', `копия пропажи всего среза в тот же день; уровень, продержавшийся ${days(DATA_LOSS_WINDOW, PAST)}, — новая норма; версии приложения — в «Релизах АБМ»`],
  ],
  [SUSTAINED_EVENT]: [
    ['Что', 'VOC триггера за рабочий день'],
    ['Сравнение', 'нижняя граница плана канала этого дня (рабочие — пн–пт, праздники не выделяются)'],
    ['Отсечка', `ниже на >\u00a0${formatNumber(INCIDENT_PLAN_GAP, 2)}, ${days(INCIDENT_MIN_DAYS, WORKING)} подряд и дольше`],
    ['Мин. объём', `триггер из топ-${formatCount(INCIDENT_TOP_TRIGGERS)} по оценкам за всю выгрузку канала; день — от ${formatRatings(INCIDENT_MIN_DAY_RATINGS)} триггера, серия — от ${formatRatings(INCIDENT_MIN_RATINGS)}`],
  ],
  [NEW_SLICE_EVENT]: [
    ['Что', 'триггер, роль, сегмент или продукт, которых раньше не было'],
    ['Сравнение', 'вся история среза до дня'],
    ['Отсечка', `первый день с ≥\u00a0${formatRatings(NEW_SLICE_MIN_DAILY)}; до него — меньше ${formatCount(NEW_SLICE_MIN_DAILY)} в сумме`],
    ['Не считается', 'значение первого дня выгрузки, заглушки «Без сопоставления», «Без сегмента», «Без разметки»'],
  ],
  [INCIDENT_EVENT]: [
    ['Источник', 'лист аварий incidents'],
    ['Что показываем', 'начало, конец, длительность, доля затронутых, продукт'],
    ['Каналы', 'все, кроме Альфа-Мобайла (физлица)'],
    ['Сравнение', 'не сравнивается; цвет — доля затронутых × длительность'],
  ],
  [RELEASE_EVENT]: [
    ['Источник', 'строка листа rollouts с версией приложения; первые оценки версии — из выгрузки'],
    ['Сравнение', 'дата релиза против дня первых оценок версии'],
    ['Отсечка', `сигнал — оценок нет через ${releaseLag()} после релиза или они пришли позже`],
    ['Без строки в листе', `версия новее уже виденных на своей ОС (сравниваются версии от ${formatRatings(RELEASE_BASELINE_RATINGS)} или с релизом)`],
  ],
  [ROLLOUT_EVENT]: [
    ['Источник', 'строка листа rollouts без версии приложения, канал ленты или все каналы'],
    ['Что показываем', 'дата, фича, число пинов'],
    ['Сравнение', 'не сравнивается'],
  ],
};

const NEW_SLICE_CAPTION = { trigger: 'Новый триггер', role: 'Новая роль', segment: 'Новый сегмент', product: 'Новый продукт' };
/* Подпись разреза пропажи данных: весь срез — как у снижения VOC, версия — ключом «iOS 15.1.1» */
const LOSS_CAPTION = { ...DIMENSION_CAPTION, role: 'Роль', app_version: 'Версия' };

/* Ревью 13.11: «iOS» и «Android» понятны без подписи «ОС:» — у остальных разрезов подпись остаётся */
function sliceCaption(dimension, name) {
  return dimension === 'os' ? name : `${DIMENSION_CAPTION[dimension]}: ${name}`;
}

/** Аномалия или серия словами (R-27, R-43, R-44); состав строки — `docs/blocks-insights.md`. */
export function insightText(insight, { label, state }) {
  const isVoc = insight.metric === VOC_METRIC;
  const { label: title, color } = eventType(insight);
  const slice = insight.dimension === 'channel'
    ? (hasFilters(state.filters) ? 'Весь срез' : 'Канал целиком')
    : sliceCaption(insight.dimension, label(insight.dimension, insight.key));

  const notes = [];
  /* Серия ниже плана уже названа тегом: вторая строка число дней не повторяет */
  const seriesInTag = !insight.calendar && insight.severity === CRITICAL && (insight.belowPlanDays ?? 1) === insight.streak;
  if (insight.streak > 1 && !seriesInTag) notes.push(`${workingDaysCaption(insight.streak)} подряд`);
  if (insight.startsBeforePeriod) notes.push('началась до периода');
  if (insight.planStatus && insight.severity !== CRITICAL) notes.push(PLAN_CAPTION[insight.planStatus]);
  notes.push(formatRatings(isVoc ? insight.ratings : insight.value));

  const anomalyDelta = isVoc ? formatDelta(roundDelta(insight.delta)) : formatSigned(roundFrequency(insight.delta), 1);
  const forms = insight.windowKind === 'calendar' ? ['календарный день', 'календарных дня', 'календарных дней'] : ['рабочий день', 'рабочих дня', 'рабочих дней'];
  const windowDays = `${insight.windowValues} ${plural(insight.windowValues, forms)}`;
  const dayVoc = insight.dayVoc ?? (isVoc ? insight.value : null);
  const value = dayVoc === null ? 'VOC —' : `VOC ${formatVoc(roundVoc(dayVoc))}`;
  const vocDelta = insight.vocDelta ?? null;
  const delta = insight.calendar || vocDelta === null ? null : formatDelta(roundDelta(vocDelta));
  const compared = delta === null
    ? 'предыдущего рабочего дня с оценками нет'
    : `${delta} к ${formatDate(insight.previousDay)}`;
  const window = `${isVoc ? 'VOC' : 'число'} ${anomalyDelta} к среднему за ${windowDays}`;
  const date = formatDayRange(insight.from ?? insight.date, insight.date);

  return {
    date,
    title,
    color,
    /* Комментарий агента читает только «Главный вывод»; календарь его не показывает (R-43) */
    comment: insight.comment ?? null,
    detail: [slice, ...notes].join(' · '),
    value,
    delta,
    /* У события частотности тон строки — про упоминания, а не про VOC: дельта VOC без цвета, иначе строка спорит сама с собой */
    deltaTone: isVoc ? signTone(vocDelta) : 'neutral',
    window,
    sentence: `${date}. ${title}. ${[slice, ...notes].join(', ')}. ${value}${insight.calendar ? '' : `, ${compared}`}; ${window}`,
  };
}

/*
  J-25: эффект — доля затронутых пользователей, а не падение VOC. Неделя 16–22.11: в источнике доля шагом 10 %, поэтому
  ровно 0 — «<10 %», а не «0 %»; до 1 % — «<1 %» (страховка, шагом 10 % не бывает); пусто — доля не указана; меньше 0
  и больше 100 % — ошибка источника, число не показывается, чтобы его не приняли за долю
*/
export const EFFECT_STEP_NOTE = 'В источнике доля шагом 10 %';

export function effectCaption(effect) {
  if (effect === null || effect === undefined) return 'Затронуто: доля не указана';
  if (!Number.isFinite(effect) || effect < 0 || effect > 1) return 'Затронуто: доля некорректна в источнике';
  if (effect === 0) return `Затронуто: <10${NBSP}% пользователей`;
  const percent = roundShare(effect * 100);
  if (percent < 1) return `Затронуто: <1${NBSP}% пользователей`;
  return `Затронуто: ${formatNumber(percent, Number.isInteger(percent) ? 0 : 1)}${NBSP}% пользователей`;
}

/** Строка раскатки или аварии (R-45): тип по правилу, во второй строке — фича или эффект с описанием. */
function channelEventText(event, context) {
  const { label: title, color } = eventType(event);
  const scope = event.channel === null ? ['все каналы'] : [];
  const parts = event.kind === ROLLOUT_EVENT
    ? [event.feature ?? 'Фича без названия', ...(Number.isFinite(event.users) ? [`${formatCount(event.users)}${NBSP}${plural(event.users, ['пин', 'пина', 'пинов'])}`] : []),
      ...(event.app_version ? [`Версия ${event.app_version}`] : []), ...(event.os ? [osName(event.os)] : []), ...scope]
    : [effectCaption(event.effect),
      `Канал аварии: ${event.channel ?? 'все каналы'}${event.channel && context?.state?.channel && event.channel !== context.state.channel ? ' (другой канал)' : ''}`,
      ...(event.product ? [`Продукт: ${event.product}`] : []), ...(event.description ? [event.description] : [])];
  const date = event.started_at ? `${formatEventTime(event.started_at)} – ${formatEventTime(event.ended_at)}` : formatDate(event.date);
  return {
    date,
    title,
    color,
    comment: null,
    detail: parts.join(' · '),
    value: null,
    delta: null,
    deltaTone: 'neutral',
    window: event.kind === ROLLOUT_EVENT ? 'Раскатка фичи из листа rollouts' : `Авария из листа incidents${Number.isFinite(event.duration_seconds) ? `. Длительность: ${formatDuration(event.duration_seconds)}` : ''}${event.effect === 0 ? `. ${EFFECT_STEP_NOTE}` : ''}`,
    sentence: `${date}. ${title}. ${parts.join(', ')}.`,
  };
}

/* J-191: релиз — версия, дата релиза и первые оценки; сигнал — оценок нет или они пришли с задержкой */
function releaseText(event) {
  const { label: title, color } = eventType(event);
  const date = formatDate(event.date);
  const first = event.firstDate ? formatDate(event.firstDate) : null;
  const since = {
    'no-date': `оценки с ${first}, даты релиза в листе нет`,
    missing: `оценок нет ${daysCaption(event.waited)} после релиза`,
    pending: 'оценок пока нет',
    late: `оценки с ${first}, через ${daysCaption(event.lag)} после релиза`,
    early: `оценки с ${first}, раньше релиза`,
    ok: event.fromHistoryStart ? `оценки есть с начала выгрузки, ${first}` : `оценки с ${first}`,
  }[event.status];
  const parts = [`Версия ${event.key}`, since, ...(event.ratings ? [formatRatings(event.ratings)] : []),
    ...(event.feature ? [event.feature] : []), ...(event.channel === null ? ['все каналы'] : [])];
  const value = event.value === null ? null : `VOC ${formatVoc(roundVoc(event.value))}`;
  const window = event.releaseDate
    ? `Релиз ${date} из листа rollouts; первые оценки по версии — ${first ?? 'ещё не пришли'}. Сигнал — оценок нет через ${releaseLag()} после релиза или они пришли позже. Оценки и VOC — с первого дня до конца периода`
    : `Первые оценки по версии — ${first}; строки релиза в листе rollouts нет. Оценки и VOC — с первого дня до конца периода`;
  const detail = parts.join(' · ');
  return { date, title, color, comment: null, detail, value, delta: null, deltaTone: 'neutral', window, sentence: `${date}. ${title}. ${parts.join(', ')}.${value ? ` ${value}.` : ''}` };
}

/* J-191: пропажа данных — разрез, сколько оценок было в день и сколько стало */
function dataLossText(event, context) {
  const { label: title, color } = eventType(event);
  const date = event.streak > 1 ? formatDayRange(event.from, event.date) : formatDate(event.date);
  const slice = event.dimension === 'channel'
    ? (hasFilters(context.state?.filters) ? 'Весь срез' : 'Канал целиком')
    : event.dimension === 'os' ? event.key
      : `${LOSS_CAPTION[event.dimension]}: ${event.dimension === 'app_version' ? event.key : context.label(event.dimension, event.key)}`;
  const before = formatNumber(Math.round(event.before));
  const after = event.full ? 'нет оценок' : `${formatNumber(Math.round(event.after))} в день`;
  const parts = [slice, `было ≈${before} в день, стало ${after}`, ...(event.startsBeforePeriod ? ['началась до периода'] : []), ...(event.ongoing ? ['продолжается'] : [])];
  const window = `Продолжительность: ${daysCaption(event.streak)}. Обычный поток — средняя за 10 прошлых дней того же типа без пропажи: будни — по будням, выходные и праздники — по выходным`;
  const detail = parts.join(' · ');
  return { date, title, color, comment: null, detail, value: null, delta: null, deltaTone: 'neutral', window, sentence: `${date}. ${title}. ${parts.join(', ')}. ${window}` };
}

/* J-138: новый срез — что появилось, сколько оценок с ним в периоде и их VOC */
function newSliceText(event, context) {
  const { label: title, color } = eventType(event);
  const date = formatDate(event.date);
  const name = context.label(event.dimension, event.key);
  const detail = [`${NEW_SLICE_CAPTION[event.dimension]}: ${name}`, formatRatings(event.ratings)].join(' · ');
  const value = `VOC ${formatVoc(roundVoc(event.value))}`;
  const window = `Поток с ${date}: ${formatRatings(event.dayRatings)} за день; раньше ${NEW_SLICE_SUBJECT[event.dimension]} в выгрузке не было или были единичные оценки. Оценки и VOC — с этого дня до конца периода`;
  return { date, title, color, comment: null, detail, value, delta: null, deltaTone: 'neutral', window, sentence: `${date}. ${title}. ${detail}. ${value}. ${window}` };
}

const NEW_SLICE_SUBJECT = { trigger: 'этого триггера', role: 'этой роли', segment: 'этого сегмента', product: 'этого продукта' };

export function eventText(event, context) {
  if (event.kind === NEW_SLICE_EVENT) return newSliceText(event, context);
  if (event.kind === RELEASE_EVENT) return releaseText(event);
  if (event.kind === DATA_LOSS_EVENT) return dataLossText(event, context);
  if (event.kind === SUSTAINED_EVENT) {
    const { label: title, color } = eventType(event);
    const date = formatDayRange(event.from, event.date);
    const detail = [`Триггер: ${context.label('trigger', event.key)}`,
      ...(event.startsBeforePeriod ? ['начался до периода'] : []), formatRatings(event.ratings)].join(' · ');
    const value = `VOC ${formatVoc(roundVoc(event.value))}`;
    const window = `Продолжительность: ${workingDaysCaption(event.streak)}. Ниже нижней границы плана более чем на 0,05; триггер входит в топ-15 по числу оценок за всю выгрузку канала. План последнего дня: ${formatVoc(roundVoc(event.plan.min))}.`;
    return { date, title, color, detail, value, delta: null, window, sentence: `${date}. ${title}. ${detail}. ${value}. ${window}` };
  }
  return event.kind === ROLLOUT_EVENT || event.kind === INCIDENT_EVENT ? channelEventText(event, context) : insightText(event, context);
}

/*
  J-143: значок «i» у заголовка — окно «Типы событий»: у каждого типа его метки цветом, как в ленте, и коротко —
  что считается событием. Окно — общий popover каркаса: Escape и клик вне закрывают
*/
function kindsHelp(channel, kinds) {
  const item = element('span', 'insight-help');
  const trigger = element('button', 'insight-help__trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Что значат типы событий');
  trigger.title = 'Что значат типы событий';
  trigger.append(icon('info', 'insight-help__icon'));
  const panel = popoverPanel({ id: 'insight-kinds-help', title: 'Типы событий', className: 'insight-help__panel', align: 'end' });
  for (const group of KIND_GROUPS) {
    panel.append(element('h3', 'insight-help__group', group.label));
    const list = element('dl', 'insight-help__list');
    for (const kind of kinds.filter((item) => item.group === group.value)) {
      const label = kindLabel(kind, channel);
      const term = element('dt', 'insight-help__term');
      /* Метка раскатки в ленте — с каналом, как чип */
      term.append(...kind.tags.map(({ label: text, color }) => tag(kind.channelLabel ? label : text, color)));
      term.setAttribute('aria-label', label);
      /* Формула типа — строки «ключ — значение» в две колонки */
      const rules = element('dd', 'insight-help__rules');
      for (const [key, value] of KIND_RULES[kind.value]) rules.append(element('span', 'insight-help__key', key), element('span', 'insight-help__value', value));
      list.append(term, rules);
    }
    panel.append(list);
  }
  item.append(trigger, panel);
  bindPopover(item, trigger, panel);
  return item;
}

function kindChips(block, context, counts, kinds) {
  const chosen = selectedKinds.get(block) ?? new Set();
  const group = element('div', 'insight-kinds');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Типы событий');
  /* Две группы — строкой каждая, с подписью: из оценок и внешние события */
  const rows = new Map(KIND_GROUPS.map(({ value, label }) => {
    const row = element('div', 'insight-kinds__group');
    const caption = element('span', 'insight-kinds__caption', label);
    /* Имя группы — её видимая подпись: screen reader читает его один раз */
    caption.id = `insight-kinds-${value}`;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-labelledby', caption.id);
    row.append(caption);
    group.append(row);
    return [value, row];
  }));
  for (const kind of kinds) {
    const { value } = kind;
    const label = kindLabel(kind, context.state.channel);
    const pressed = chosen.has(value);
    const count = counts.get(value) ?? 0;
    const chip = element('button', 'insight-kind');
    chip.type = 'button';
    chip.dataset.kind = value;
    chip.setAttribute('aria-pressed', String(pressed));
    /* Тип без событий выбрать нельзя; выбранный остаётся доступным, чтобы его снять */
    chip.disabled = !pressed && count === 0;
    /* Чип — та же иконка типа, что в строке ленты: чип читается как легенда ленты */
    chip.append(statusDot(KIND_ICON[value], 'event-sm'), element('span', 'insight-kind__label', label), element('span', 'insight-kind__count', formatCount(count)));
    chip.setAttribute('aria-label', `${label}, ${formatCount(count)} ${plural(count, ['событие', 'события', 'событий'])}`);
    chip.addEventListener('click', (event) => {
      const next = new Set(chosen);
      if (pressed) next.delete(value);
      else next.add(value);
      selectedKinds.set(block, next);
      /* Другой состав — другой список: читать его с начала */
      block.element.querySelector('.insight-list')?.scrollTo?.(0, 0);
      renderInsights(block, context);
      /* J-98: фокус возвращается только клавиатуре (detail 0): после клика мышью кольцо фокуса на чипе читалось как жирная обводка */
      if (event?.detail > 0) return;
      /* Снятый тип без событий становится недоступным: фокус — на первый доступный чип, а не на body */
      const again = block.element.querySelector(`.insight-kind[data-kind="${value}"]`);
      (again && !again.disabled ? again : [...block.element.querySelectorAll('.insight-kind')].find((node) => !node.disabled))?.focus?.();
    });
    rows.get(kind.group).append(chip);
  }
  return group;
}

function eventRow(block, context, event, index) {
  const text = eventText(event, context);
  const detailEvent = eventDetail(event, context.state.channel);
  const sameEvent = sameDetailEvent(context.state.detailEvent, detailEvent);
  /* J-60: выбранный день сужает ленту, но строки не обводит — нажатой остаётся только строка события из детализации */
  const selected = Boolean(context.state.detailEvent) && sameEvent;
  const row = element('button', `insight-row hover-row insight-row--${event.tone}`);
  row.type = 'button';
  if (event.kind === INCIDENT_EVENT) row.style.setProperty('--accident-tone', accidentColor(event.effect, event.duration_seconds));
  /* Клик по серии выбирает её последний день (R-44) */
  row.setAttribute('data-focus-date', event.date);
  row.setAttribute('data-insight-index', String(index));
  row.setAttribute('aria-pressed', String(selected));
  row.setAttribute('aria-label', text.sentence);
  row.title = text.window;

  /* Тег — тип строки в одну строку, как в макете; длинный тип уходит под дату целиком, а не рвётся */
  const headline = element('span', 'insight-row__headline');
  const type = element('span', 'insight-row__type');
  type.append(tag(text.title, text.color));
  headline.append(element('span', 'insight-row__date', text.date), type);
  /*
    Ревью 13.11: у всех строк одна структура — текст слева, VOC справа в своей колонке. Части строки после первой
    («103 оценки», «началась до периода») не рвутся: переносится только длинное имя разреза
  */
  const detail = element('span', 'insight-row__detail');
  const [lead, ...rest] = text.detail.split(' · ');
  const slice = element('span', 'insight-row__slice', lead);
  /* Неразрывны только короткие части (число оценок, «началась до периода»); описание аварии переносится как текст */
  for (const part of rest) slice.append(' ', part.length <= SHORT_PART ? element('span', 'insight-row__part', `· ${part}`) : `· ${part}`);
  detail.append(slice);
  if (text.value !== null) {
    /* Нет оценок за день — общий прочерк «нет значения» (аудит 13.11), а не своё тире */
    const value = text.value === 'VOC —'
      ? element('span', 'insight-row__value', 'VOC ')
      : element('span', 'insight-row__value', text.value);
    if (text.value === 'VOC —') value.append(emptyValue('нет оценок за день'));
    value.title = text.value === 'VOC —'
      ? 'За день события в этом разрезе нет оценок — VOC не рассчитывается.'
      : 'VOC разреза за день события.';
    detail.append(value);
  }
  const marker = element('span', 'insight-row__marker');
  marker.append(statusDot(KIND_ICON[event.kind] ?? text.color, 'event'));
  row.append(marker, headline);
  row.append(detail);
  row.addEventListener('click', () => {
    context.setState({ ...context.state, focus: sameEvent ? null : event.date, days: [], detailEvent: sameEvent ? null : detailEvent });
    /* Индекс — в полном списке: выбор даты сужает список, а строка остаётся той же */
    const again = block.element.querySelector(`[data-focus-date="${event.date}"][data-insight-index="${index}"]`);
    again?.focus({ preventScroll: true });
    again?.scrollIntoView?.({ block: 'nearest' });
  });
  return row;
}

const NO_DROPS = 'Критических снижений нет';

/** J-20: выходные участвуют; отсутствие VOC и истории объясняется отдельно. */
export function noAnomaliesText(context) {
  const history = context.rows.length ? historyOf(context) : [];
  const dates = [...new Set(history.map(({ appeal_date }) => appeal_date))];
  const current = dates.filter((date) => date >= context.period.from && date <= context.period.to);
  if (!current.length) return ['Нет оценок в периоде', 'Для поиска снижений VOC нужны оценки в выбранном периоде.'];
  if (!hasEvaluatedSlice(windowParams(context, history))) return ['Мало истории', `Для сравнения нужны хотя бы два дня и ${formatRatings(CRITICAL_DROP_MIN_WINDOW_RATINGS)} в предыдущем окне.`];
  return [NO_DROPS, 'Ни в одном разрезе VOC не упал значимо: будни сравниваются с 10 рабочими днями, выходные — с 10 календарными.'];
}

/* Те же оценки и конец данных, что у `calendarAnomalies`: текст объясняет именно этот вердикт */
function windowParams({ rows, reference, period }, history, day = null) {
  return { rows: history, reference, period, day, dataEnd: latestDate(rows) };
}

/** Выбранный день без событий (R-41): почему пусто — выходной, день вне периода или ровный день. Лента общая (J-50). */
export function noDayEventsText(context) {
  const { focus } = context.state;
  const title = `Нет событий за ${formatDate(focus)}`;
  if (focus < context.period.from || focus > context.period.to) return [title, 'События ищутся в периоде блока, а выбранный день лежит вне его.'];
  const history = context.rows.length ? historyOf(context) : [];
  if (!history.some(({ appeal_date }) => appeal_date === focus)) return [title, 'За выбранный день нет оценок, релизов, раскаток и аварий.'];
  if (!hasEvaluatedSlice(windowParams(context, history, focus))) return [title, `Релизов, раскаток и аварий нет; для поиска снижений VOC мало истории — в предыдущем окне нужны два дня и ${formatRatings(CRITICAL_DROP_MIN_WINDOW_RATINGS)}.`];
  return [title, isWorkingDay(focus)
    ? 'В этот день VOC не упал значимо к предыдущим 10 рабочим дням, релизов, раскаток и аварий нет.'
    : 'В этот день VOC не упал значимо к предыдущим 10 календарным дням, релизов, раскаток и аварий нет.'];
}

const resetAction = (text, onClick) => ({ className: 'insight-search__reset', text, onClick });

function noDayEvents(context) {
  /* Событие, выбранное в разделе «Для аналитика», на главной не показывается: строка это объясняет, а не «событий нет» */
  const hidden = context.state.detailEvent?.kind && !kindsOf(context).some(({ value }) => value === context.state.detailEvent.kind);
  const [title, detail] = hidden
    ? [`Выбранное событие ${formatDate(context.state.focus ?? context.state.detailEvent.days?.at(-1))} — в разделе «Для аналитика»`, 'На главной этот тип событий не показывается. Сбросьте дату или откройте раздел «Для аналитика».']
    : noDayEventsText(context);
  return statusPanel('insight-unavailable', {
    title,
    detail,
    action: resetAction('Сбросить дату', () => context.setState({ ...context.state, focus: null, days: [], detailEvent: null })),
  });
}

/** При выбранной дате календарь показывает её события и серии, которые её покрывают (R-41, R-44); индекс строки — в полном списке. */
export function eventsOfFocus(events, focus) {
  const indexed = events.map((event, index) => ({ event, index }));
  const days = Array.isArray(focus) ? focus : focus ? [focus] : [];
  return days.length ? indexed.filter(({ event }) => days.some((day) => coversDay(event, day))) : indexed;
}

/** Пустая лента за период: причина та же, что у снижений VOC (нет оценок, мало истории), иначе — событий нет ни одного типа. */
export function noEventsText(context) {
  const [title, detail] = noAnomaliesText(context);
  /* На главной перечисляются только её типы: провалы оценок, инциденты и новые срезы там не ищутся (J-228) */
  const rest = context.analyst ? 'релизов, раскаток, аварий, инцидентов и провалов оценок нет' : 'релизов, раскаток и аварий нет';
  return title === NO_DROPS ? ['Событий нет', `За период VOC значимо не падал; ${rest}.`] : [title, detail];
}

function noEvents(context) {
  const [title, detail] = noEventsText(context);
  return statusPanel('insight-unavailable', { title, detail });
}

/* «ммб» находит «ММБ», «платежи» — «Платёж висит»: без регистра и различия е/ё */
/* Знак минус U+2212 (J-36) ищется и обычным дефисом с клавиатуры */
const normalized = (text) => text.toLocaleLowerCase('ru').replaceAll('ё', 'е').replaceAll('−', '-');

/** Поиск по событиям (R-26): дата, тип, разрез, фича или описание аварии; каждое слово запроса должно найтись. */
export function searchInsights(events, query, context) {
  const words = normalized(query).split(/\s+/).filter(Boolean);
  if (!words.length) return events;
  return events.filter((event) => {
    const text = eventText(event, context);
    /* Код разреза — тоже: подпись сегмента полная, а ищут «ммб» (D-53) */
    const haystack = normalized([text.date, ...(event.days ?? [event.date]).map(formatDate), text.title, text.detail, event.key ?? ''].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}

function eventSearch(block, onInput) {
  return searchField({
    className: 'insight-search-field', inputClass: 'insight-search', label: 'Поиск по событиям', placeholder: 'Поиск: ММБ, платежи…',
    value: searchQueries.get(block) ?? '',
    onInput: (value) => {
      searchQueries.set(block, value);
      onInput();
    },
  }).field;
}

function noChosenKinds(onReset) {
  return statusPanel('insight-unavailable', {
    title: 'Нет событий выбранных типов',
    detail: 'Снимите выбор типа или выберите другой.',
    action: resetAction('Показать все события', onReset),
  });
}

function nothingFound(query, onReset) {
  return statusPanel('insight-unavailable', {
    title: 'Ничего не найдено',
    detail: `По запросу ${quoted(query.trim())} событий нет.`,
    action: resetAction('Сбросить поиск', onReset),
  });
}

function daysChip(context) {
  const days = selectionDays(context.state);
  const dates = days.map(formatDate).join(', ');
  return selectionChip({
    caption: 'Дни',
    value: formatCount(days.length),
    label: `Сбросить выбранные дни: ${dates}`,
    title: dates,
    onClear: () => context.setState({ ...context.state, focus: null, days: [], detailEvent: null }),
  });
}

export function renderInsights(block, context) {
  block.setTitle('Календарь событий');
  if (!context.rows.length) {
    block.setHead();
    block.setState(EMPTY);
    return;
  }
  context = eventSelectionContext(context);
  /* Лента — от свежей даты; серия и инцидент стоят по последнему дню (J-50) */
  const kinds = kindsOf(context);
  const shownKinds = new Set(kinds.map(({ value }) => value));
  const all = sortEvents(calendarEventsOf(context).filter(({ kind }) => shownKinds.has(kind)), 'chronology');
  const { focus } = context.state;
  const days = selectionDays(context.state);
  const inDays = eventsOfFocus(all, days);
  const counts = new Map(kinds.map(({ value }) => [value, inDays.filter(({ event }) => event.kind === value).length]));
  const chosen = new Set([...(selectedKinds.get(block) ?? [])].filter((kind) => shownKinds.has(kind)));
  const ofDay = chosen.size ? inDays.filter(({ event }) => chosen.has(event.kind)) : inDays;
  const content = element('div', 'insights');
  const toolbar = element('div', 'insights__toolbar');
  /* Ввод перестраивает только список: поле поиска не теряет фокус и курсор */
  const listHost = element('div', 'insights__results');
  /* Тип события — по правилу, без комментария агента: пометки «Сделано с AI» в календаре нет (R-43, D-33) */
  block.setHead({ help: kindsHelp(context.state.channel, kinds), controls: context.state.days?.length ? daysChip(context) : focus ? focusChip(context) : null });
  let status = feedStatus.get(block);
  if (!status) {
    status = element('span', 'visually-hidden');
    status.setAttribute('role', 'status');
    feedStatus.set(block, status);
  }
  const fill = () => {
    const matched = new Set(searchInsights(ofDay.map(({ event }) => event), searchQueries.get(block) ?? '', context));
    const found = ofDay.filter(({ event }) => matched.has(event));
    status.textContent = `В ленте ${formatCount(found.length)} ${plural(found.length, ['событие', 'события', 'событий'])}`;
    if (chosen.size && inDays.length && ofDay.length === 0) {
      listHost.replaceChildren(noChosenKinds(() => {
        selectedKinds.set(block, new Set());
        renderInsights(block, context);
      }));
      return;
    }
    if (days.length && ofDay.length === 0) {
      if (context.state.days?.length) {
        listHost.replaceChildren(statusPanel('insight-unavailable', { title: 'За выбранные дни событий нет', extra: [daysChip(context)] }));
      } else listHost.replaceChildren(noDayEvents(context));
      return;
    }
    if (all.length === 0) {
      listHost.replaceChildren(noEvents(context));
      return;
    }
    if (found.length === 0) {
      listHost.replaceChildren(nothingFound(searchQueries.get(block) ?? '', () => {
        searchQueries.delete(block);
        renderInsights(block, context);
        block.element.querySelector('.insight-search')?.focus();
      }));
      return;
    }
    const list = element('div', 'insight-list scroll-area');
    found.forEach(({ event, index }) => list.append(eventRow(block, context, event, index)));
    listHost.replaceChildren(list);
  };
  toolbar.append(eventSearch(block, fill));
  content.append(kindChips(block, context, counts, kinds), status, toolbar, listHost);
  /* Список прокручивается внутри карточки (D-55): перерисовка сохраняет прокрутку; выросший список браузер может поджать к концу */
  const scrolled = block.element.querySelector('.insight-list')?.scrollTop ?? 0;
  fill();
  block.setContent(content);
  const list = block.element.querySelector('.insight-list');
  if (list) list.scrollTop = scrolled;
}
