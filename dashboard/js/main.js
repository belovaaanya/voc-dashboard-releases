/*
  Сборка каркаса и реестр блоков.

  Блок — модуль `blocks/<id>.js` с функцией `render(block, context)`. Реестр
  ниже — единственное место, где блок объявляется, и все блоки получают **один
  и тот же** объект контекста: разойтись в том, что считает срез, они не могут
  по построению. Контракт контекста — docs/ui-shell.md.

  Добавить блок = новый файл и одна строка в BLOCKS. Строки без `render` —
  места следующих слайсов.
*/

import { EMPTY, ERROR, LOADING, NO_DATA, READY, createBlock } from './shell/block.js';
import { renderVocChannel } from './blocks/voc-channel.js';
import { renderDynamics } from './blocks/dynamics.js';
import { renderAntidrivers } from './blocks/antidrivers.js';
import { renderInsights } from './blocks/insights.js';
import { calendarReady, conclusionReady } from './state/event-analysis.js';
import { renderDistribution } from './blocks/distribution.js';
import { conclusionPlaceholder, detachConclusion, renderConclusion } from './blocks/conclusion.js';
import { renderVerbatimCards } from './blocks/verbatim-cards.js';
import { renderVerbatimTable } from './blocks/verbatim-table.js';
import { renderCallStats } from './blocks/call-stats.js';
import { digestMonthControl, digestSegment, renderDigestDko, renderDigestPlatforms, renderDigestStability, renderDigestSummary, renderDigestTriggers, renderOtherRoles, renderRoles, digestRole } from './blocks/digest.js';
import { vocSegment } from './blocks/voc-segment.js';
import { renderPlanDays } from './blocks/plan-days.js';
import { renderEmotions } from './blocks/emotions.js';
import { channelsOf, metricSegments } from './core/dimensions.js';
import { renderEmptyHeader, renderHeader } from './shell/header.js';
import { DEV_LABEL, SECTIONS, renderSideNav } from './shell/side-nav.js';
import { DEV, blockShown, blockStatus, pageStatus } from './core/features.js';
import { isDeveloperMode, setDeveloperAllowed } from './state/developer-mode.js';
import { tag } from './components/tag.js';
import { alignHeaderAmbient } from './shell/header-ambient.js';
import { sideToggle } from './components/side-toggle.js';
import { statusPanel } from './components/status-panel.js';
import { mountFeedback } from './shell/feedback.js';
import { createLabels } from './core/labels.js';
import { SOURCE_EMPTY, loadVerbatim as loadVerbatimFile, startLoading } from './io/loader.js';
import { developerAllowed } from './io/desktop.js';
import { defaultPeriod, metricsBase } from './core/period.js';
import { createSelector } from './state/selection.js';
import { holdPageHeight as holdPage, releasePageHeight as releasePage } from './ui/page-height.js';
import { sameInputs, staleInputs, watchInputs } from './shell/inputs.js';
import { ROLE_SLOTS } from './core/digest.js';
import { groupStep, isAutoStep } from './state/group-step.js';
import { ANALYST_PAGE, DEFAULT_PAGE, LOCAL_PERIOD_BLOCKS, onStateChange, opensTable, readState, syncState, toSearch, viewOf, withFilter, writeState } from './state/url-state.js';
import { SHARED_PERIOD, resolveState } from './state/resolve-state.js';
import { validateVerbatim } from './core/verbatim.js';

const NEXT_SLICE = 'Блок появится в следующем слайсе — здесь только каркас.';

const BLOCKS = [
  { id: 'voc-channel', title: 'VOC канала', host: 'metrics', modifier: 'card--metric card--metric-big', compact: true, render: renderVocChannel },
  { id: 'voc-segment-1', title: 'VOC сегмента', host: 'metrics', modifier: 'card--metric card--metric-segment', compact: true, render: vocSegment(0) },
  { id: 'voc-segment-2', title: 'VOC сегмента', host: 'metrics', modifier: 'card--metric card--metric-segment', compact: true, render: vocSegment(1) },
  { id: 'voc-segment-3', title: 'VOC сегмента', host: 'metrics', modifier: 'card--metric card--metric-segment', compact: true, render: vocSegment(2) },
  { id: 'plan-days', title: 'Дни относительно плана', host: 'metrics', modifier: 'card--metric card--metric-plan-days', compact: true, render: renderPlanDays },
  { id: 'distribution', title: 'Распределение оценок', host: 'metrics', modifier: 'card--distribution', render: renderDistribution },
  { id: 'summary', title: 'Главный вывод', host: 'metrics', modifier: 'card--summary', render: renderConclusion, ready: conclusionReady, placeholder: conclusionPlaceholder, detach: detachConclusion },
  { id: 'dynamics', title: 'Динамика VOC', host: 'main', modifier: 'card--dynamics card--fill card--wide-head', render: renderDynamics },
  { id: 'antidrivers', title: 'Антидрайверы', host: 'drivers', modifier: 'card--antidrivers', render: renderAntidrivers, heavy: true },
  { id: 'verbatim-cards', title: 'Топ проблем', host: 'problems', modifier: 'card--verbatim', heavy: true, render: renderVerbatimCards, verbatim: true },
  { id: 'insights', title: 'Календарь событий', host: 'rail-main', modifier: 'card--insights card--fill', render: renderInsights, ready: calendarReady },
  /* J-151: таблица прямой речи — на странице «Обратная связь» */
  /* Неделя 16–22.11: таблица прямой речи — внизу «Для аналитика», только в этом режиме; на главной её нет (цитаты — в «Топ проблем») */
  /* Неделя 16–22.11: статистика обзвона по месяцам — над таблицей прямой речи, только «Для аналитика» */
  { id: 'call-stats', title: 'Статистика обзвона', host: 'full', modifier: 'card--call-stats', page: ANALYST_PAGE, render: renderCallStats, verbatim: true },
  /* J-348: эмоции — таблица и лента отзывов, только «Для аналитика», над таблицей прямой речи */
  { id: 'emotions', title: 'Эмоции', host: 'full', modifier: 'card--emotions', page: ANALYST_PAGE, render: renderEmotions, verbatim: true },
  { id: 'verbatim-table', title: 'Прямая речь: детализация', host: 'full', modifier: 'card--verbatim-table', page: ANALYST_PAGE, render: renderVerbatimTable, verbatim: true },
  /* J-151: VOC-дайджест — месяц канала по макету */
  { id: 'digest-summary', title: 'VOC-дайджест', host: 'digest-top', modifier: 'card--digest-summary card--page-head card--bare', render: renderDigestSummary, page: 'digest' },
  { id: 'digest-segment-1', title: 'Сегмент', host: 'digest-segments', modifier: 'card--digest-segment', render: digestSegment(0), page: 'digest' },
  { id: 'digest-segment-2', title: 'Сегмент', host: 'digest-segments', modifier: 'card--digest-segment', render: digestSegment(1), page: 'digest' },
  { id: 'digest-segment-3', title: 'Сегмент', host: 'digest-segments', modifier: 'card--digest-segment', render: digestSegment(2), page: 'digest' },
  { id: 'digest-dko', title: 'ДКО: антидрайверы', host: 'digest-dko', modifier: 'card--digest-dko', render: renderDigestDko, page: 'digest' },
  { id: 'digest-triggers', title: 'Триггеры: драйверы и антидрайверы', host: 'digest-side', modifier: 'card--digest-triggers', render: renderDigestTriggers, page: 'digest' },
  { id: 'digest-stability', title: 'ДКО: стабильность', host: 'digest-side', modifier: 'card--digest-stability', render: renderDigestStability, page: 'digest' },
  { id: 'digest-os', title: 'iOS / Android', host: 'digest-dko', modifier: 'card--digest-os', render: renderDigestPlatforms, page: 'digest' },
  { id: 'roles', title: 'VOC ролей', host: 'roles', modifier: 'card--roles card--page-head card--bare', render: renderRoles, page: 'roles' },
  /* J-197: плитка на роль, сетка 2×2 — по слоту на каждую из ROLE_SLOTS ролей */
  ...Array.from({ length: ROLE_SLOTS }, (_, index) => ({ id: `role-${index + 1}`, title: 'Роль', host: 'roles', modifier: 'card--role card--avatar-head', render: digestRole(index), page: 'roles' })),
  /* Оценки ролей вне четырёх плиток — тихой строкой внизу страницы ролей */
  { id: 'roles-other', title: 'Другие роли', host: 'roles', modifier: 'card--roles-other card--bare', render: renderOtherRoles, page: 'roles' },
];
/*
  J-?: видимый заголовок главной — «Для продакта», в паре с «Для аналитика»: «Главная» на главной ничего не различала.
  Пункт меню «Главная» и маршрут прежние; заголовок вкладки браузера — по заголовку страницы
*/
const PRODUCT_TITLE = 'Для продакта';
const BASE_DOCUMENT_TITLE = 'Дашборд VOC для PO B2B';
function pageTitleOf(page) {
  const text = page === DEFAULT_PAGE ? PRODUCT_TITLE : SECTIONS.find(({ id }) => id === page)?.label ?? PRODUCT_TITLE;
  if (typeof document !== 'undefined') document.title = `${text} · ${BASE_DOCUMENT_TITLE}`;
  return text;
}

/* J-151: страница блока; без поля — «Главная» */
/* Блок с `page: ANALYST_PAGE` — только в режиме «Для аналитика» (вид главной); остальные — на своей странице */
/* J-?: блок «в разработке» вне режима разработчика не показывается нигде (core/features.js) */
const shownOn = (spec, page) => blockShown(spec.id, isDeveloperMode())
  && (spec.page === ANALYST_PAGE ? page === ANALYST_PAGE : (spec.page ?? DEFAULT_PAGE) === viewOf(page));

/*
  J-?: статус карточек. Вне режима разработчика карточка блока «в разработке» скрыта целиком; в режиме — метка
  «В разработке» у такого блока и у первой карточки страницы «в разработке» (её шапки страницы)
*/
function applyFeatureStatus(blocks) {
  const developer = isDeveloperMode();
  const pageHeads = new Set();
  for (const spec of BLOCKS) {
    const page = spec.page ?? DEFAULT_PAGE;
    const pageHead = !pageHeads.has(page);
    pageHeads.add(page);
    const block = blocks.get(spec.id);
    block.element.hidden = !blockShown(spec.id, developer);
    const dev = blockStatus(spec.id) === DEV || (pageHead && page !== ANALYST_PAGE && pageStatus(page) === DEV);
    block.setStatusLabel(developer && dev ? tag(DEV_LABEL, 'orange') : null);
  }
}
/* `heavy`: расчёт дольше кадра — на кадрах жеста таймлайна стоит прежнее содержимое, блок обновляется по отпусканию (docs/ui-shell.md#скорость) */
const waitsForGesture = (spec, live) => live && spec.heavy;
/* Оценки канала до переключателя кэшбека: дайджест показывает VOC и с поправкой, и без */
const channelRowsCache = new WeakMap();
function channelRowsOf(rows, channel) {
  const saved = channelRowsCache.get(rows);
  if (saved?.channel === channel) return saved.rows;
  const picked = rows.filter((row) => row.channel === channel);
  channelRowsCache.set(rows, { channel, rows: picked });
  return picked;
}

/*
  J-40: группа аналитики, строка-заголовок над двумя карточками (J-?; J-357 разрезал на три): «Динамика, события и
  антидрайверы» и «Топ проблем» с лентой. J-?: у каждой карточки свои период и шаг — в её шапке, а не в строке группы:
  период `dynamics` и `step` — графика, календаря и антидрайверов (выбор — в шапке «Динамики VOC»), `problems` и
  `problems-step` — «Топ проблем».
  J-128: выбор антидрайвера сужает «Топ проблем»; день графика — нет (J-49)
*/
const ANALYSIS_TITLE = 'Динамика и проблемы';
const ANALYSIS_BLOCKS = ['dynamics', 'insights', 'antidrivers'];
const PROBLEMS_PERIOD = 'problems';
/* Колонки внутри группы: заголовок блока там — h3 под заголовком группы */
const GROUPED_HOSTS = ['main', 'rail-main', 'drivers', 'problems'];

const TEXT_BLOCKS = BLOCKS.filter((spec) => spec.verbatim);

/* Скелет своей композиции держит высоту колонки; без своего — общий */
function showPlaceholder(spec, block) {
  if (spec.placeholder) {
    spec.placeholder(block);
    return;
  }
  block.setHead();
  block.setState(LOADING);
}

/* rAF срабатывает до кадра, таймер из него — уже после отрисовки; в скрытой вкладке rAF стоит, кадра нет */
function afterPaint(callback) {
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (typeof requestAnimationFrame === 'function' && !hidden) requestAnimationFrame(() => setTimeout(callback, 0));
  else setTimeout(callback, 0);
}

/* Шапка закреплена: прокрутка к фокусу оставляет цель под ней, если не отступить на её высоту */
function keepScrollClearOfHeader(header) {
  const sync = () => document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
  new ResizeObserver(sync).observe(header);
}

/*
  J-136: календарь событий справа можно скрыть, чтобы график шёл во всю ширину карточки; кнопка — в
  строке графика, выбор живёт до закрытия страницы. Графики сами перерисовываются по новой ширине (ResizeObserver)
*/
let eventsHidden = false;
/* J-148: кнопка календаря — та же, что у ленты отзывов: круг в правом верхнем углу строки группы, свёрнутый календарь — полоса «События» */
function eventsToggle(row) {
  return sideToggle({
    label: 'События',
    controls: 'rail-main',
    host: row,
    panel: row.querySelector('#rail-main'),
    hostClass: 'group-row--no-rail',
    isHidden: () => eventsHidden,
    onToggle: () => {
      eventsHidden = !eventsHidden;
    },
  });
}

function groupFromSlot(spec) {
  const group = createBlock(spec);
  const slot = document.getElementById(spec.id);
  group.element.querySelector('.card__body').append(...slot.children);
  slot.replaceWith(group.element);
  return group;
}


const HOST_IDS = ['header', 'page-meta', 'metrics', 'main', 'rail-main', 'drivers', 'problems', 'full',
  'digest-top', 'digest-segments', 'digest-dko', 'digest-side', 'roles'];

function pageHosts() {
  const hosts = Object.fromEntries(HOST_IDS.map((id) => [id, document.getElementById(id)]));
  hosts.nav = document.getElementById('side-nav');
  return hosts;
}

/* Карточки групп и блоков в скелете; `setAll` ставит всем одно служебное состояние */
function mountCards(hosts) {
  /* J-40: строка-заголовок группы аналитики; периоды и шаги — в шапках её карточек (J-?) */
  const analysis = groupFromSlot({ id: 'analysis', title: ANALYSIS_TITLE, modifier: 'card--group card--analysis' });

  const blocks = new Map();
  for (const spec of BLOCKS) {
    const block = createBlock({ ...spec, level: GROUPED_HOSTS.includes(spec.host) ? 3 : 2 });
    blocks.set(spec.id, block);
    hosts[spec.host].append(block.element);
  }

  const setAll = (state, detail) => {
    analysis.setHead();
    for (const block of blocks.values()) {
      /* Отложенный блок мог остаться без действий (`inert`) до кадра, который ошибка отменила */
      const body = block.element.querySelector('.card__body');
      if (body) body.inert = false;
      block.setHead();
      block.setState(state, detail);
    }
  };

  for (const spec of BLOCKS) showPlaceholder(spec, blocks.get(spec.id));
  return { analysis, blocks, setAll };
}

/* Приложение без листов: пустой дашборд с кнопкой «Обновить данные»; считать и фильтровать нечего */
function showEmptyApp(hosts, cards, manifest) {
  renderEmptyHeader(hosts.header);
  renderSideNav(hosts.nav, null);
  cards.setAll(NO_DATA);
  mountFeedback(document.querySelector('.page'), manifest);
}

/* Шапка тоже строится из данных, поэтому при их отсутствии несёт только диагностику */
function showLoadError(hosts, cards, error) {
  hosts.header.replaceChildren(statusPanel('shell-head__notice', { title: 'Данные не загрузились — дашборд показан без шапки' }));
  cards.setAll(ERROR, error.message);
}

/* Достроенное по умолчанию состояние дописывается в URL: пересланная ссылка обязана быть полной (D-31) */
const currentLocation = () => window.location.search || window.location.pathname;

function keepUrlComplete(state) {
  if (toSearch(state) !== currentLocation()) syncState(state);
}

/* Один контекст на отрисовку: все блоки получают одну ссылку на срез (контракт — docs/ui-shell.md) */
function sliceContext(env, { state, period, eligible, dimensions }, { setState, verbatim, requestVerbatim }) {
  const select = createSelector({ rows: eligible, state, period, dimensions, reference: env.reference });
  const current = select();
  const context = {
    /* Режим «Для аналитика»: та же главная, блоки сами решают, что показать (docs/ui-shell.md) */
    analyst: state.page === ANALYST_PAGE,
    /* J-?: режим разработчика — блок не ссылается на скрытые блоки «в разработке» (`blockShown`) */
    developer: isDeveloperMode(),
    rows: eligible,
    slice: current.rows,
    previousSlice: current.previous,
    state,
    period,
    previousPeriod: current.previousPeriod,
    reference: env.reference,
    label: env.label,
    dimensions,
    segments: env.segments,
    select,
    setState,
    verbatim,
    requestVerbatim,
    channelRows: channelRowsOf(env.rows, state.channel),
    /* Аудитория и опрос (лист audience) — воронка «Конверсии опроса»; без фильтров среза, нет листа — [] */
    audience: env.reference?.audience ?? [],
    /* J-?: с какого месяца канал размечен по эмоциям («YYYY-MM» или null) — блок подписывает, если период шире */
    emotions: { labelledFrom: env.reference?.emotions?.labelled_from?.[state.channel] ?? null },
  };
  return context;
}

/* Боковое меню и шапка страницы: их действия пишут состояние через тот же setState, что и блоки */
function renderNav(env, context) {
  const { hosts, source } = env;
  const { state, setState } = context;
  renderSideNav(hosts.nav, { manifest: source.manifest, source: source.source, dataError: source.dataError, rowsInSlice: context.slice.length,
    page: state.page,
    onNavigate: (page) => {
      const sameView = viewOf(page) === viewOf(state.page);
      setState({ ...state, page });
      /* Новая страница читается с начала; «Главная» ↔ «Для аналитика» — та же страница, прокрутка остаётся */
      if (!sameView) globalThis.scrollTo?.({ top: 0 });
    } });
}

function renderPageHeader(env, context) {
  const { hosts, source, channels, label, reference } = env;
  const { state, setState, period, dimensions } = context;
  renderHeader(hosts.header, {
    /* J-?: строка заголовка страницы — вне закреплённой шапки, прокручивается со страницей */
    metaHost: hosts['page-meta'],
    /* J-168: на странице ролей фильтры, кэшбек и база дельт не действуют — в шапке только канал и период */
    slim: state.page === 'roles',
    /* Заголовок страницы — имя пункта меню; на экране — у вида главной, у остальных его называет первая карточка */
    pageTitle: { text: pageTitleOf(state.page), visible: viewOf(state.page) === DEFAULT_PAGE },
    /* Дайджест считается по всему каналу за календарный месяц: в шапке канал и «Месяц», без фильтров и периода */
    month: state.page === 'digest' ? digestMonthControl(context, (month) => setState({ ...state, month })) : null,
    channels,
    dimensions,
    state,
    period,
    label,
    reference,
    manifest: source.manifest,
    source: source.source,
    dataError: source.dataError,
    rowsInSlice: context.slice.length,
    /* J-65: база дельт карточек метрик — одна строка шапки вместо подписи в каждой карточке */
    comparedTo: viewOf(state.page) === DEFAULT_PAGE ? metricsBase(context.previousPeriod, context.rows) : null,
    onChannelChange: (channel) => setState({ ...state, channel, days: [], detailEvent: null, driver: null }),
    /* Новый общий период снимает local period блоков: иначе блок молча остаётся на старом */
    onPeriodChange: (nextPeriod) =>
      setState({ ...state, preset: nextPeriod.preset, from: nextPeriod.from, to: nextPeriod.to, local: {}, days: [], detailEvent: null, driver: null, step: null, problemsStep: null }),
    onFilterChange: (dimension, values) =>
      setState({ ...state, filters: withFilter(state.filters, dimension, values), detailEvent: null }),
    onCashbackChange: (includeCashback) => setState({ ...state, includeCashback, detailEvent: null }),
    onFiltersReset: () => setState({ ...state, filters: {}, detailEvent: null }),
  });
}

/* Чей `state.local` читает контекст группы — для входов, блокам не виден */
const periodIds = new WeakMap();
const periodOf = (context, id) => (periodIds.set(context, id), context);

/* Блок со своим периодом получает контекст того же среза, но со своим периодом и своим select */
function localContext(env, { localPeriods, eligible, dimensions }, context, id) {
  const { state, setState } = context;
  /* Выбор периода сохранённой шапки — поверх текущего состояния, а не состояния её отрисовки */
  const latest = env.latest;
  const local = localPeriods[id] ?? null;
  /* Период группы снимает событие из календаря, иначе таблица осталась бы на его днях */
  /* J-?: ручной шаг карточки — для её периода (J-181): новый период снова получает автоматический */
  const selectionReset = id === SHARED_PERIOD ? { days: [], focus: null, detailEvent: null, driver: null, step: null }
    : id === PROBLEMS_PERIOD ? { problemsStep: null } : { detailEvent: null };
  const periodControl = {
    manifestPeriod: env.source.manifest.period,
    local: Boolean(local),
    onChange: (next) => setState({ ...latest(), ...selectionReset, local: { ...latest().local, [id]: { preset: next.preset, from: next.from, to: next.to } } }),
    onReset: local ? () => setState({ ...latest(), ...selectionReset, local: Object.fromEntries(Object.entries(latest().local).filter(([key]) => key !== id)) }) : null,
  };
  if (!local) return periodOf({ ...context, periodControl }, id);
  const localSelect = createSelector({ rows: eligible, state, period: local, dimensions, reference: env.reference });
  const localSlice = localSelect();
  return periodOf({
    ...context,
    slice: localSlice.rows,
    previousSlice: localSlice.previous,
    period: local,
    previousPeriod: localSlice.previousPeriod,
    select: localSelect,
    periodControl,
  }, id);
}

/* Период и шаг карточки группы: свой local period и свой параметр шага в URL */
/* `shared`: период и шаг общие у нескольких блоков карточки — выбор только в шапке одного из них */
function cardContext(env, resolved, context, { periodId, stepKey, shared = false }) {
  const baseContext = localContext(env, resolved, context, periodId);
  return periodOf({
    ...baseContext,
    /* J-360: период карточки — пилюлей, как период в шапке дашборда */
    periodControl: { ...baseContext.periodControl, pill: true, shared },
    step: groupStep(context.state[stepKey], baseContext.period, context.analyst),
    /* Автоматический шаг блоки подбирают себе молча; подпись замены — только у выбранного вручную */
    stepIsAuto: isAutoStep(context.state[stepKey]),
    setStep: (step) => context.setState({ ...env.latest(), [stepKey]: step }),
    stepKey,
  }, periodId);
}

/*
  J-40, J-?: график, календарь и антидрайверы — один период `dynamics` и один шаг, выбор в шапке «Динамики VOC»;
  «Топ проблем» — свой период и шаг в своей шапке; таблица «Обратная связь» — по шапке дашборда
*/
function groupContexts(env, resolved, context) {
  /* Период и шаг общие у графика, календаря и антидрайверов: выбор — в шапке «Динамики VOC», у остальных его нет */
  const analysisContext = cardContext(env, resolved, context, { periodId: SHARED_PERIOD, stepKey: 'step', shared: true });
  const problemsContext = cardContext(env, resolved, context, { periodId: PROBLEMS_PERIOD, stepKey: 'problemsStep' });
  const contextFor = (id) => {
    if (ANALYSIS_BLOCKS.includes(id)) return analysisContext;
    if (id === 'verbatim-cards') return problemsContext;
    return LOCAL_PERIOD_BLOCKS.includes(id) ? localContext(env, resolved, context, id) : context;
  };
  return { analysisContext, contextFor };
}

/* J-?: в строке группы — только заголовок; кнопка календаря событий — в строке первой карточки */
function paintGroupHeads({ analysis }) {
  const analysisRow = analysis.element.querySelector('.group-row');
  /* Кнопка календаря — в строке карточки, одна на строку */
  if (analysisRow?.querySelector('#rail-main') && !analysisRow.querySelector(':scope > .side-toggle')) analysisRow.append(eventsToggle(analysisRow));
}

/* Блок с теми же входами стоит; блок с `ready` не из кэша рисуется следующим кадром, скелет — только у первой отрисовки */
function renderBlocks(blocks, { only, mayDefer, page, live }, contextFor, context, paint) {
  const deferred = [];
  /* J-151: карточки скрытых страниц не считаются и не висят в загрузке — пусты, пока страницу не откроют */
  for (const spec of only.filter((item) => !shownOn(item, page))) {
    const block = blocks.get(spec.id);
    if (block.element.querySelector('.state--loading')) {
      paint.forget(spec.id);
      block.setHead();
      block.setContent(document.createElement('div'));
    }
  }
  for (const spec of only.filter((item) => shownOn(item, page))) {
    const block = blocks.get(spec.id);
    /* Копии контекста делят с общим состояние и тексты — сверка входов не строит срез своего периода */
    if (paint.current(spec.id, context)) continue;
    const blockContext = contextFor(spec.id);
    const body = block.element.querySelector('.card__body');
    if (mayDefer && ((spec.ready && !spec.ready(blockContext)) || waitsForGesture(spec, live))) {
      if (paint.painted(spec.id)) {
        /* Прежнее содержимое до кадра — без действий: его обработчики помнят прошлый срез */
        if (body) body.inert = true;
        spec.detach?.(block);
        paint.expire(spec.id);
      } else showPlaceholder(spec, block);
      deferred.push(spec);
      continue;
    }
    if (body?.inert) body.inert = false;
    paint.draw(spec.id, blockContext, (watched) => {
      if (spec.render) spec.render(block, watched);
      else block.setState(watched.slice.length ? READY : EMPTY, watched.slice.length ? NEXT_SLICE : undefined);
    }, { local: periodIds.get(blockContext), texts: Boolean(spec.verbatim) });
    if (live) paint.markLive(spec.id);
  }
  return deferred;
}

/* Части страницы рисуются заново, только если прочитанное прошлой отрисовкой изменилось (docs/ui-shell.md) */
function createPainter(latest) {
  const inputs = new Map();
  const drawnLive = new Set();
  const draw = (id, context, paintPart, options) => {
    inputs.delete(id);
    const watch = watchInputs(context, { ...options, latest });
    paintPart(watch.context);
    inputs.set(id, watch.seal());
  };
  const paint = (id, context, paintPart, options) => {
    if (!sameInputs(inputs.get(id), context)) draw(id, context, paintPart, options);
  };
  Object.assign(paint, {
    draw,
    current: (id, context) => sameInputs(inputs.get(id), context),
    painted: (id) => inputs.has(id),
    expire: (id) => inputs.set(id, staleInputs()),
    forget: (id) => inputs.delete(id),
    markLive: (id) => drawnLive.add(id),
    isLive: (id) => drawnLive.has(id),
    /* Нарисованное на кадре жеста держит шкалу жеста: отпускание того же состояния рисует его заново */
    expireLive: () => {
      for (const id of drawnLive) inputs.set(id, staleInputs());
      drawnLive.clear();
    },
    clear: () => inputs.clear(),
  });
  return paint;
}

/* Отрисовка разрешённого состояния: контекст, страница, шапка и блоки; возвращает отложенные блоки */
function paintPage(env, resolved, context, { only, withHeader, mayDefer, live }) {
  const { state } = context;
  const { paint } = env;
  /* J-151: видна одна страница; блоки других страниц не считаются. «Для аналитика» показывает вид главной */
  const view = viewOf(state.page);
  for (const node of document.querySelectorAll('.page-view')) node.hidden = node.dataset.page !== view;
  /* Колонки только режима аналитика (таблица прямой речи) на главной не видны */
  for (const node of document.querySelectorAll('[data-mode="analyst"]')) node.hidden = state.page !== ANALYST_PAGE;
  if (withHeader) {
    paint('#nav', context, (watched) => renderNav(env, watched));
    paint('#header', context, (watched) => renderPageHeader(env, watched));
  }
  const groups = groupContexts(env, resolved, context);
  if (withHeader) paintGroupHeads(env.cards);
  return renderBlocks(env.cards.blocks, { only, mayDefer, page: state.page, live }, groups.contextFor, context, paint);
}

/*
  Прокрутка к таблице по старой ссылке: блоки выше дорисовываются кадрами позже и сдвигают её вниз, поэтому прокрутка
  повторяется, пока место таблицы не простоит секунду (не дольше 5 с: скелеты выше сначала выше готовых блоков); своя
  прокрутка зрителя её останавливает. Отступ под липкую шапку даёт scroll-padding-top у html
*/
function scrollToTable(target) {
  if (!target?.scrollIntoView) return;
  const stopOn = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
  let last = null;
  let still = 0;
  let timer = null;
  const stop = () => {
    clearTimeout(timer);
    for (const type of stopOn) globalThis.removeEventListener?.(type, stop);
  };
  const started = Date.now();
  const step = () => {
    target.scrollIntoView({ block: 'start' });
    const top = Math.round(target.getBoundingClientRect().top);
    still = top === last ? still + 1 : 0;
    if (still >= 4 || Date.now() - started > 5000) return stop();
    last = top;
    timer = setTimeout(step, 250);
  };
  for (const type of stopOn) globalThis.addEventListener?.(type, stop, { once: true, passive: true });
  step();
}

function startDashboard(env) {
  const { source, rows, reference, cards } = env;
  let verbatim = { status: 'idle', data: null, error: null };
  let failed = false;
  let verbatimPromise = null;
  /* Отложенный кадр устаревает, если до него прошла новая полная отрисовка: она запланировала свой */
  let generation = 0;
  /* Состояние последней полной отрисовки: его видят обработчики сохранённых блоков */
  let current = null;
  env.latest = () => current;
  env.paint = createPainter(env.latest);

  function requestVerbatim() {
    if (verbatim.status !== 'idle') return verbatimPromise;
    verbatim = { status: 'loading', data: null, error: null };
    verbatimPromise ??= Promise.resolve()
      .then(() => loadVerbatimFile(source))
      .then((data) => {
        validateVerbatim(data);
        verbatim = { status: 'ready', data, error: null };
      })
      .catch((error) => {
        verbatim = { status: 'error', data: null, error: error.message };
      })
      .finally(() => renderRest(TEXT_BLOCKS));
    return verbatimPromise;
  }

  /*
    J-187: на время перерисовки страница держит прежнюю высоту. Скелет отложенной карточки ниже её содержимого:
    без scroll anchoring (WebKit — окно приложения, Safari) укоротившаяся страница прижимала прокрутку вверх.
    Удержание снимается после догрузки; новая перерисовка до неё продлевает текущее
  */
  let heightHeld = false;
  const holdPageHeight = () => {
    if (heightHeld) return;
    heightHeld = true;
    holdPage();
  };
  const releasePageHeight = () => {
    if (!heightHeld) return;
    heightHeld = false;
    releasePage();
  };

  /* Адрес до жеста таймлайна: жест — одна запись истории (docs/ui-shell.md, `setState`) */
  let gestureFrom = null;
  /* Возвращает true, если запись жеста снята: состояние до жеста нарисует popstate */
  const writeGesture = (next, gesture) => {
    if (gestureFrom === null || !gesture) {
      gestureFrom = gesture === 'move' ? currentLocation() : null;
      writeState(next);
      return false;
    }
    const back = gesture === 'end' && toSearch(next) === gestureFrom;
    if (back) window.history.back();
    else syncState(next);
    if (gesture === 'end') gestureFrom = null;
    return back;
  };

  /* Новые данные встают на место прежних без проявления и скелета (D-56): движение — только у нажатого контрола */
  const setState = (next, { gesture = null } = {}) => {
    holdPageHeight();
    if (gesture !== 'move') env.paint.expireLive();
    if (!writeGesture(next, gesture)) renderSafely(next, { live: gesture === 'move' });
  };

  function render(requested, options) {
    const resolved = resolveState(requested, { rows, reference, channels: env.channels, fallbackPeriod: env.fallbackPeriod, manifestPeriod: source.manifest.period });
    keepUrlComplete(resolved.state);
    if (options.withHeader) current = resolved.state;
    const context = sliceContext(env, resolved, { setState, verbatim, requestVerbatim });
    return paintPage(env, resolved, context, options);
  }

  /*
    Период живёт в URL и правится руками (D-31), поэтому вывернутый диапазон приходит и после загрузки — на popstate.
    Ядро на нём падает намеренно, и падение обязано стать состоянием ошибки, а не необработанным исключением
  */
  function renderSafely(state, { only = BLOCKS, withHeader = true, mayDefer = true, live = false } = {}) {
    try {
      if (mayDefer) generation += 1;
      const deferred = render(state, { only, withHeader, mayDefer, live });
      failed = false;
      const scheduled = generation;
      if (live) return;
      if (deferred.length) afterPaint(() => {
        if (scheduled !== generation) return;
        renderRest(deferred);
        releasePageHeight();
      });
      else if (mayDefer) releasePageHeight();
    } catch (error) {
      failed = true;
      releasePageHeight();
      env.paint.clear();
      env.paint.expireLive();
      cards.setAll(ERROR, error.message);
    }
  }

  /* Догрузка перерисовывает только свои блоки; после ошибки того же состояния все уже в ошибке — не смешиваем с содержимым */
  function renderRest(only) {
    if (failed) return;
    renderSafely(readState(), { only, withHeader: false, mayDefer: false });
  }

  /* Старая ссылка на страницу «Обратная связь» — «Для аналитика», прокрученная к таблице прямой речи */
  const toTable = opensTable(globalThis.location?.search ?? '');
  renderSafely(readState());
  if (toTable) scrollToTable(document.getElementById('full'));
  onStateChange((state) => {
    gestureFrom = null;
    /* Back посреди жеста: жест кончился без отпускания — шапки, нарисованные в нём, следующий жест рисует заново */
    env.paint.expireLive();
    renderSafely(state);
  });
}

function main() {
  const hosts = pageHosts();
  keepScrollClearOfHeader(hosts.header);
  alignHeaderAmbient(hosts.header);
  const cards = mountCards(hosts);

  /* Загрузку обычно уже запустил boot.js */
  /* J-?: режим разработчика решается до первой отрисовки; без ответа среды — обычный режим */
  Promise.all([startLoading(), developerAllowed().catch(() => false)])
    .then(([{ source, rows, reference }, developer]) => {
      setDeveloperAllowed(developer);
      applyFeatureStatus(cards.blocks);
      if (!Array.isArray(rows)) throw new Error('ratings: ожидался массив объектов (data-model §7)');
      if (source.source === SOURCE_EMPTY) {
        showEmptyApp(hosts, cards, source.manifest);
        return;
      }
      startDashboard({
        hosts, cards, source, rows, reference,
        label: createLabels(reference),
        channels: channelsOf(rows),
        segments: metricSegments(),
        /* Период по умолчанию — из манифеста, а не из часов машины (D-41) */
        fallbackPeriod: defaultPeriod(source.manifest.period),
      });
      /* Обратная связь — только в десктопном приложении; страница не ждёт ответа приложения */
      mountFeedback(document.querySelector('.page'), source.manifest);
    })
    .catch((error) => showLoadError(hosts, cards, error));
}

main();
