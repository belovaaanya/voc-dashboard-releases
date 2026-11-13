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
import { conclusionPlaceholder, renderConclusion } from './blocks/conclusion.js';
import { renderVerbatimCards } from './blocks/verbatim-cards.js';
import { renderVerbatimTable } from './blocks/verbatim-table.js';
import { digestSegment, renderDigestDko, renderDigestStability, renderDigestSummary, renderDigestTopic, renderRoles, digestRole } from './blocks/digest.js';
import { vocSegment } from './blocks/voc-segment.js';
import { renderPlanDays } from './blocks/plan-days.js';
import { tally } from './blocks/tally.js';
import { channelsOf, metricSegments } from './core/dimensions.js';
import { renderEmptyHeader, renderHeader } from './shell/header.js';
import { renderSideNav } from './shell/side-nav.js';
import { sideToggle } from './components/side-toggle.js';
import { mountFeedback } from './shell/feedback.js';
import { createLabels } from './core/labels.js';
import { SOURCE_EMPTY, loadVerbatim as loadVerbatimFile, startLoading } from './io/loader.js';
import { defaultPeriod, metricsBase } from './core/period.js';
import { createSelector } from './state/selection.js';
import { CARD_BODIES, revealDashboard, snapshotCards } from './ui/motion.js';
import { ROLE_SLOTS } from './core/digest.js';
import { LOCAL_PERIOD_BLOCKS, onStateChange, readState, syncState, toSearch, withFilter, writeState } from './state/url-state.js';
import { SHARED_PERIOD, resolveState } from './state/resolve-state.js';
import { validateVerbatim } from './core/verbatim.js';

const NEXT_SLICE = 'Блок появится в следующем слайсе — здесь только каркас.';

const BLOCKS = [
  { id: 'voc-channel', title: 'VOC канала', host: 'metrics', modifier: 'card--metric card--metric-big', compact: true, render: renderVocChannel },
  { id: 'voc-segment-1', title: 'VOC сегмента', host: 'metrics', modifier: 'card--metric card--metric-segment', compact: true, render: vocSegment(0) },
  { id: 'voc-segment-2', title: 'VOC сегмента', host: 'metrics', modifier: 'card--metric card--metric-segment', compact: true, render: vocSegment(1) },
  { id: 'voc-segment-3', title: 'VOC сегмента', host: 'metrics', modifier: 'card--metric card--metric-segment', compact: true, render: vocSegment(2) },
  { id: 'plan-days', title: 'Дни относительно плана', host: 'metrics', modifier: 'card--metric card--metric-plan-days', compact: true, render: renderPlanDays },
  { id: 'share-low', title: 'Доля оценок 1–3', host: 'metrics', modifier: 'card--metric card--metric-tally', compact: true, render: tally('shareLow') },
  { id: 'summary', title: 'Главный вывод', host: 'rail-top', modifier: 'card--summary', render: renderConclusion, ready: conclusionReady, placeholder: conclusionPlaceholder },
  { id: 'distribution', title: 'Распределение оценок', host: 'rail-top', modifier: 'card--distribution card--fill', render: renderDistribution },
  { id: 'dynamics', title: 'Динамика VOC', host: 'main', modifier: 'card--dynamics card--fill', render: renderDynamics },
  { id: 'antidrivers', title: 'Антидрайверы', host: 'drivers', modifier: 'card--antidrivers', render: renderAntidrivers },
  { id: 'verbatim-cards', title: 'Топ проблем', host: 'problems', modifier: 'card--verbatim', render: renderVerbatimCards, verbatim: true },
  { id: 'insights', title: 'Календарь событий', host: 'rail-main', modifier: 'card--insights card--fill', render: renderInsights, ready: calendarReady },
  /* J-151: таблица прямой речи — на странице «Обратная связь» */
  { id: 'verbatim-table', title: 'Прямая речь: детализация', host: 'full', modifier: 'card--verbatim-table', page: 'feedback', render: renderVerbatimTable, verbatim: true },
  /* J-151: VOC-дайджест — месяц канала по макету */
  { id: 'digest-summary', title: 'VOC-дайджест', host: 'digest-top', modifier: 'card--digest-summary card--bare', render: renderDigestSummary, page: 'digest' },
  { id: 'digest-segment-1', title: 'Сегмент', host: 'digest-segments', modifier: 'card--digest-segment', render: digestSegment(0), page: 'digest' },
  { id: 'digest-segment-2', title: 'Сегмент', host: 'digest-segments', modifier: 'card--digest-segment', render: digestSegment(1), page: 'digest' },
  { id: 'digest-segment-3', title: 'Сегмент', host: 'digest-segments', modifier: 'card--digest-segment', render: digestSegment(2), page: 'digest' },
  { id: 'digest-dko', title: 'ДКО: антидрайверы', host: 'digest-dko', modifier: 'card--digest-dko', render: renderDigestDko, page: 'digest' },
  { id: 'digest-stability', title: 'ДКО: стабильность', host: 'digest-side', modifier: 'card--digest-stability', render: renderDigestStability, page: 'digest' },
  { id: 'digest-topic', title: 'Детализация', host: 'digest-side', modifier: 'card--digest-topic', render: renderDigestTopic, page: 'digest' },
  { id: 'roles', title: 'VOC ролей', host: 'roles', modifier: 'card--roles card--page-head', render: renderRoles, page: 'roles' },
  /* J-162: карточка-строка на роль; слотов — ROLE_SLOTS, лишние скрыты */
  ...Array.from({ length: ROLE_SLOTS }, (_, index) => ({ id: `role-${index + 1}`, title: 'Роль', host: 'roles', modifier: 'card--role card--avatar-head', render: digestRole(index), page: 'roles' })),
];
/* J-151: страница блока; без поля — главная «VOC ЦК» */
const pageOf = (spec) => spec.page ?? 'voc';
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
  J-40: блок аналитики — одна карточка с общим периодом `dynamics` для графика, календаря и антидрайверов.
  J-128: «Топ проблем» с лентой — в той же карточке под ними: выбор антидрайвера сужает его; день графика — нет (J-49)
*/
const ANALYSIS_TITLE = 'Динамика, события и антидрайверы';
const ANALYSIS_BLOCKS = ['dynamics', 'insights', 'antidrivers', 'verbatim-cards'];
const VERBATIM_TITLE = 'Прямая речь';
const VERBATIM_BLOCKS = ['verbatim-table'];
const VERBATIM_PERIOD = 'verbatim';
/* Колонки внутри карточек-групп: заголовок блока там — h3 под заголовком группы */
const GROUPED_HOSTS = ['main', 'rail-main', 'drivers', 'problems', 'full'];

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
  J-136: календарь событий справа можно скрыть, чтобы динамика и антидрайверы шли во всю ширину группы; кнопка — в
  шапке группы, выбор живёт до закрытия страницы. Графики сами перерисовываются по новой ширине (ResizeObserver)
*/
let eventsHidden = false;
/* J-148: кнопка календаря — та же, что у ленты отзывов: на линии раздела группы, свёрнутый — «События» у правого края */
function eventsToggle(row) {
  const paint = () => {
    row.classList.toggle('group-row--no-rail', eventsHidden);
    row.classList.toggle('side-toggle-host--collapsed', eventsHidden);
    row.querySelector('#rail-main').hidden = eventsHidden;
  };
  paint();
  return sideToggle({
    label: 'События',
    controls: 'rail-main',
    isHidden: () => eventsHidden,
    onToggle: () => {
      eventsHidden = !eventsHidden;
      paint();
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


const HOST_IDS = ['header', 'metrics', 'rail-top', 'main', 'rail-main', 'drivers', 'problems', 'full',
  'digest-top', 'digest-segments', 'digest-dko', 'digest-side', 'roles'];

function pageHosts() {
  const hosts = Object.fromEntries(HOST_IDS.map((id) => [id, document.getElementById(id)]));
  hosts.nav = document.getElementById('side-nav');
  return hosts;
}

/* Карточки групп и блоков в скелете; `setAll` ставит всем одно служебное состояние */
function mountCards(hosts) {
  /* J-40: график, календарь и антидрайверы — одна карточка; её шапка несёт общий период трёх блоков */
  const analysis = groupFromSlot({ id: 'analysis', title: ANALYSIS_TITLE, modifier: 'card--group card--analysis' });
  /* J-105: у прямой речи свой период в шапке группы; выбор дня на графике её не сужает (J-49) */
  const verbatimGroup = groupFromSlot({ id: 'verbatim', title: VERBATIM_TITLE, modifier: 'card--group card--verbatim-group' });

  const blocks = new Map();
  for (const spec of BLOCKS) {
    const block = createBlock({ ...spec, level: GROUPED_HOSTS.includes(spec.host) ? 3 : 2 });
    blocks.set(spec.id, block);
    hosts[spec.host].append(block.element);
  }

  const setAll = (state, detail) => {
    analysis.setHead();
    verbatimGroup.setHead();
    for (const block of blocks.values()) {
      block.setHead();
      block.setState(state, detail);
    }
  };

  for (const spec of BLOCKS) showPlaceholder(spec, blocks.get(spec.id));
  return { analysis, verbatimGroup, blocks, setAll };
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
  const notice = document.createElement('p');
  notice.className = 'state__title';
  notice.textContent = 'Данные не загрузились — дашборд показан без шапки';
  hosts.header.replaceChildren(notice);
  cards.setAll(ERROR, error.message);
}

/* Достроенное по умолчанию состояние дописывается в URL: пересланная ссылка обязана быть полной (D-31) */
function keepUrlComplete(state) {
  const currentLocation = window.location.search || window.location.pathname;
  if (toSearch(state) !== currentLocation) syncState(state);
}

/* Один контекст на отрисовку: все блоки получают одну ссылку на срез (контракт — docs/ui-shell.md) */
function sliceContext(env, { state, period, eligible, dimensions }, { setState, verbatim, requestVerbatim }) {
  const select = createSelector({ rows: eligible, state, period, dimensions, reference: env.reference });
  const current = select();
  const context = {
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
  };
  return context;
}

/* Боковое меню и шапка страницы: их действия пишут состояние через тот же setState, что и блоки */
function renderChrome(env, context) {
  const { hosts, source, channels, label, reference } = env;
  const { state, setState, period, dimensions } = context;
  renderSideNav(hosts.nav, { manifest: source.manifest, source: source.source, dataError: source.dataError, rowsInSlice: context.slice.length,
    page: state.page,
    onNavigate: (page) => {
      setState({ ...state, page });
      globalThis.scrollTo?.({ top: 0 });
    } });
  renderHeader(hosts.header, {
    /* J-168: на странице ролей фильтры, кэшбек и база дельт не действуют — в шапке только канал и период */
    slim: state.page === 'roles',
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
    comparedTo: metricsBase(context.previousPeriod, context.rows),
    onChannelChange: (channel) => setState({ ...state, channel, days: [], detailEvent: null, driver: null }),
    /* Новый общий период снимает local period блоков: иначе блок молча остаётся на старом */
    onPeriodChange: (nextPeriod) =>
      setState({ ...state, preset: nextPeriod.preset, from: nextPeriod.from, to: nextPeriod.to, local: {}, days: [], detailEvent: null, driver: null }),
    onFilterChange: (dimension, values) =>
      setState({ ...state, filters: withFilter(state.filters, dimension, values), detailEvent: null }),
    onCashbackChange: (includeCashback) => setState({ ...state, includeCashback, detailEvent: null }),
    onFiltersReset: () => setState({ ...state, filters: {}, detailEvent: null }),
  });
}

/* Блок со своим периодом получает контекст того же среза, но со своим периодом и своим select */
function localContext(env, { localPeriods, eligible, dimensions }, context, id) {
  const { state, setState } = context;
  const local = localPeriods[id] ?? null;
  /* Период группы снимает событие из календаря, иначе таблица осталась бы на его днях */
  const selectionReset = id === SHARED_PERIOD ? { days: [], focus: null, detailEvent: null, driver: null } : { detailEvent: null };
  const periodControl = {
    manifestPeriod: env.source.manifest.period,
    local: Boolean(local),
    onChange: (next) => setState({ ...state, ...selectionReset, local: { ...state.local, [id]: { preset: next.preset, from: next.from, to: next.to } } }),
    onReset: local ? () => setState({ ...state, ...selectionReset, local: Object.fromEntries(Object.entries(state.local).filter(([key]) => key !== id)) }) : null,
  };
  if (!local) return { ...context, periodControl };
  const localSelect = createSelector({ rows: eligible, state, period: local, dimensions, reference: env.reference });
  const localSlice = localSelect();
  return {
    ...context,
    slice: localSlice.rows,
    previousSlice: localSlice.previous,
    period: local,
    previousPeriod: localSlice.previousPeriod,
    select: localSelect,
    periodControl,
  };
}

/* J-40: у трёх блоков аналитики один период — `dynamics`, его выбор в шапке группы; у прямой речи — свой */
function groupContexts(env, resolved, context) {
  const analysisContext = {
    ...localContext(env, resolved, context, SHARED_PERIOD),
    previewPeriod: (range) => env.cards.analysis.previewPeriod(range),
  };
  analysisContext.periodControl = { ...analysisContext.periodControl, shared: true };
  const verbatimContext = localContext(env, resolved, context, VERBATIM_PERIOD);
  verbatimContext.periodControl = { ...verbatimContext.periodControl, shared: true };
  const contextFor = (id) => {
    if (ANALYSIS_BLOCKS.includes(id)) return analysisContext;
    if (VERBATIM_BLOCKS.includes(id)) return verbatimContext;
    return LOCAL_PERIOD_BLOCKS.includes(id) ? localContext(env, resolved, context, id) : context;
  };
  return { analysisContext, verbatimContext, contextFor };
}

/* Догрузка блоков шапки групп не меняет: перерисовка закрыла бы открытый выбор периода */
function paintGroupHeads({ analysis, verbatimGroup }, { analysisContext, verbatimContext }) {
  const analysisRow = analysis.element.querySelector('.group-row');
  analysis.setHead({ period: { ...analysisContext.period, picker: analysisContext.periodControl } });
  /* Кнопка календаря — в строке группы, у линии раздела; одна на строку */
  if (analysisRow?.querySelector('#rail-main') && !analysisRow.querySelector(':scope > .side-toggle')) analysisRow.append(eventsToggle(analysisRow));
  verbatimGroup.setHead({ period: { ...verbatimContext.period, picker: verbatimContext.periodControl } });
}

/* Блок с `ready`, чей долгий расчёт не в кэше, получает скелет и рисуется следующим кадром — остальная страница не ждёт */
function renderBlocks(blocks, { only, mayDefer, page }, contextFor, context) {
  const deferred = [];
  /* J-151: карточки скрытых страниц не считаются и не висят в загрузке — пусты, пока страницу не откроют */
  for (const spec of only.filter((item) => pageOf(item) !== page)) {
    const block = blocks.get(spec.id);
    if (block.element.querySelector('.state--loading')) {
      block.setHead();
      block.setContent(document.createElement('div'));
    }
  }
  for (const spec of only.filter((item) => pageOf(item) === page)) {
    const block = blocks.get(spec.id);
    const blockContext = contextFor(spec.id);
    if (mayDefer && spec.ready && !spec.ready(blockContext)) {
      showPlaceholder(spec, block);
      deferred.push(spec);
    } else if (spec.render) spec.render(block, blockContext);
    else block.setState(context.slice.length ? READY : EMPTY, context.slice.length ? NEXT_SLICE : undefined);
  }
  return deferred;
}

/* Отрисовка разрешённого состояния: контекст, страница, шапка и блоки; возвращает отложенные блоки */
function paintPage(env, resolved, context, { only, withHeader, mayDefer }) {
  const { state } = context;
  /* J-151: видна одна страница; блоки других страниц не считаются */
  for (const view of document.querySelectorAll('.page-view')) view.hidden = view.dataset.page !== state.page;
  if (withHeader) renderChrome(env, context);
  const groups = groupContexts(env, resolved, context);
  if (withHeader) paintGroupHeads(env.cards, groups);
  return renderBlocks(env.cards.blocks, { only, mayDefer, page: state.page }, groups.contextFor, context);
}

function startDashboard(env) {
  const { source, rows, reference, cards } = env;
  let verbatim = { status: 'idle', data: null, error: null };
  let failed = false;
  let verbatimPromise = null;
  /* Отложенный кадр устаревает, если до него прошла новая полная отрисовка: она запланировала свой */
  let generation = 0;
  const bodyOf = (spec) => cards.blocks.get(spec.id).element.querySelector('.card__body');

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

  /* Изменённые действием карточки мягко проявляются, нетронутые не мигают (D-56); popstate и догрузка — без движения */
  const setState = (next) => {
    const before = snapshotCards();
    writeState(next);
    const deferred = renderSafely(next, { reveal: { acted: before.acted } });
    /* Скелет отложенной карточки не проявляется: проявится её содержимое следующим кадром */
    revealDashboard(before, [...document.querySelectorAll(CARD_BODIES)].filter((body) => !deferred.has(body)));
  };

  function render(requested, options) {
    const resolved = resolveState(requested, { rows, reference, channels: env.channels, fallbackPeriod: env.fallbackPeriod, manifestPeriod: source.manifest.period });
    keepUrlComplete(resolved.state);
    const context = sliceContext(env, resolved, { setState, verbatim, requestVerbatim });
    return paintPage(env, resolved, context, options);
  }

  /*
    Период живёт в URL и правится руками (D-31), поэтому вывернутый диапазон приходит и после загрузки — на popstate.
    Ядро на нём падает намеренно, и падение обязано стать состоянием ошибки, а не необработанным исключением.
    Возвращает тела отложенных карточек; `reveal` — действие пользователя, его карточка не проявляется (D-56)
  */
  function renderSafely(state, { only = BLOCKS, withHeader = true, mayDefer = true, reveal = null } = {}) {
    try {
      if (mayDefer) generation += 1;
      const deferred = render(state, { only, withHeader, mayDefer });
      failed = false;
      const scheduled = generation;
      if (deferred.length) afterPaint(() => {
        if (scheduled === generation) renderRest(deferred, reveal);
      });
      return new Set(deferred.map(bodyOf).filter(Boolean));
    } catch (error) {
      failed = true;
      cards.setAll(ERROR, error.message);
      return new Set();
    }
  }

  /* Догрузка перерисовывает только свои блоки; после ошибки того же состояния все уже в ошибке — не смешиваем с содержимым */
  function renderRest(only, reveal = null) {
    if (failed) return;
    const bodies = only.map(bodyOf).filter((body) => body && body !== reveal?.acted);
    const before = reveal ? snapshotCards(bodies) : null;
    renderSafely(readState(), { only, withHeader: false, mayDefer: false });
    if (before) revealDashboard(before, bodies);
  }

  renderSafely(readState());
  onStateChange((state) => renderSafely(state));
}

function main() {
  const hosts = pageHosts();
  keepScrollClearOfHeader(hosts.header);
  const cards = mountCards(hosts);

  /* Загрузку обычно уже запустил boot.js */
  startLoading()
    .then(({ source, rows, reference }) => {
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
