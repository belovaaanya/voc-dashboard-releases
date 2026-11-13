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
import { digestSegment, renderDigestDko, renderDigestPlatforms, renderDigestStability, renderDigestSummary, renderDigestTriggers, renderRoles, digestRole } from './blocks/digest.js';
import { vocSegment } from './blocks/voc-segment.js';
import { renderPlanDays } from './blocks/plan-days.js';
import { channelsOf, metricSegments } from './core/dimensions.js';
import { renderEmptyHeader, renderHeader } from './shell/header.js';
import { renderSideNav } from './shell/side-nav.js';
import { alignHeaderAmbient } from './shell/header-ambient.js';
import { sideToggle } from './components/side-toggle.js';
import { mountFeedback } from './shell/feedback.js';
import { createLabels } from './core/labels.js';
import { SOURCE_EMPTY, loadVerbatim as loadVerbatimFile, startLoading } from './io/loader.js';
import { defaultPeriod, metricsBase } from './core/period.js';
import { createSelector } from './state/selection.js';
import { holdPageHeight as holdPage, releasePageHeight as releasePage } from './ui/page-height.js';
import { sameInputs, staleInputs, watchInputs } from './shell/inputs.js';
import { ROLE_SLOTS } from './core/digest.js';
import { ANALYST_PAGE, DEFAULT_PAGE, LOCAL_PERIOD_BLOCKS, onStateChange, readState, syncState, toSearch, viewOf, withFilter, writeState } from './state/url-state.js';
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
  { id: 'dynamics', title: 'Динамика VOC', host: 'main', modifier: 'card--dynamics card--fill', render: renderDynamics },
  { id: 'antidrivers', title: 'Антидрайверы', host: 'drivers', modifier: 'card--antidrivers', render: renderAntidrivers },
  { id: 'verbatim-cards', title: 'Топ проблем', host: 'problems', modifier: 'card--verbatim', render: renderVerbatimCards, verbatim: true },
  { id: 'insights', title: 'Календарь событий', host: 'rail-main', modifier: 'card--insights card--fill', render: renderInsights, ready: calendarReady },
  /* J-151: таблица прямой речи — на странице «Обратная связь» */
  { id: 'verbatim-table', title: 'Прямая речь: детализация', host: 'full', modifier: 'card--verbatim-table', page: 'feedback', render: renderVerbatimTable, verbatim: true },
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
];
/* J-151: страница блока; без поля — главная «VOC ЦК» */
const pageOf = (spec) => spec.page ?? DEFAULT_PAGE;
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
/* J-148: кнопка календаря — та же, что у ленты отзывов: круг в правом верхнем углу строки группы, свёрнутый календарь — полоса «События» */
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


const HOST_IDS = ['header', 'metrics', 'main', 'rail-main', 'drivers', 'problems', 'full',
  'digest-top', 'digest-segments', 'digest-dko', 'digest-side', 'roles'];

function pageHosts() {
  const hosts = Object.fromEntries(HOST_IDS.map((id) => [id, document.getElementById(id)]));
  hosts.nav = document.getElementById('side-nav');
  /* Строка действий над панелью рабочей области: в ней ссылка на срез (макет дизайнера 11.11) */
  hosts.toolbar = document.getElementById('workspace-toolbar');
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
      /* Отложенный блок мог остаться без действий (`inert`) до кадра, который ошибка отменила */
      const body = block.element.querySelector('.card__body');
      if (body) body.inert = false;
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
    /* Режим «Для аналитика»: та же главная, блоки сами решают, что показать (docs/ui-shell.md) */
    analyst: state.page === ANALYST_PAGE,
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
function renderNav(env, context) {
  const { hosts, source } = env;
  const { state, setState } = context;
  renderSideNav(hosts.nav, { manifest: source.manifest, source: source.source, dataError: source.dataError, rowsInSlice: context.slice.length,
    page: state.page,
    onNavigate: (page) => {
      const sameView = viewOf(page) === viewOf(state.page);
      setState({ ...state, page });
      /* Новая страница читается с начала; «VOC ЦК» ↔ «Для аналитика» — та же страница, прокрутка остаётся */
      if (!sameView) globalThis.scrollTo?.({ top: 0 });
    } });
}

function renderPageHeader(env, context) {
  const { hosts, source, channels, label, reference } = env;
  const { state, setState, period, dimensions } = context;
  renderHeader(hosts.header, {
    toolbar: hosts.toolbar,
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

/* Чей `state.local` читает контекст группы — для входов, блокам не виден */
const periodIds = new WeakMap();
const periodOf = (context, id) => (periodIds.set(context, id), context);

/* Блок со своим периодом получает контекст того же среза, но со своим периодом и своим select */
function localContext(env, { localPeriods, eligible, dimensions }, context, id) {
  const { state, setState } = context;
  /* Выбор периода сохранённой шапки группы — поверх текущего состояния, а не состояния её отрисовки */
  const latest = env.latest;
  const local = localPeriods[id] ?? null;
  /* Период группы снимает событие из календаря, иначе таблица осталась бы на его днях */
  const selectionReset = id === SHARED_PERIOD ? { days: [], focus: null, detailEvent: null, driver: null } : { detailEvent: null };
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

/* J-40: у трёх блоков аналитики один период — `dynamics`, его выбор в шапке группы; у прямой речи — свой */
function groupContexts(env, resolved, context) {
  const analysisContext = periodOf({
    ...localContext(env, resolved, context, SHARED_PERIOD),
    previewPeriod: (range) => env.cards.analysis.previewPeriod(range),
  }, SHARED_PERIOD);
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
function paintGroupHeads({ analysis, verbatimGroup }, { analysisContext, verbatimContext }, paint) {
  const analysisRow = analysis.element.querySelector('.group-row');
  paint('#analysis', analysisContext, (watched) => analysis.setHead({ period: { ...watched.period, picker: watched.periodControl } }), { local: periodIds.get(analysisContext) });
  /* Кнопка календаря — в строке группы, одна на строку */
  if (analysisRow?.querySelector('#rail-main') && !analysisRow.querySelector(':scope > .side-toggle')) analysisRow.append(eventsToggle(analysisRow));
  paint('#verbatim', verbatimContext, (watched) => verbatimGroup.setHead({ period: { ...watched.period, picker: watched.periodControl } }), { local: periodIds.get(verbatimContext) });
}

/* Блок с теми же входами стоит; блок с `ready` не из кэша рисуется следующим кадром, скелет — только у первой отрисовки */
function renderBlocks(blocks, { only, mayDefer, page }, contextFor, context, paint) {
  const deferred = [];
  /* J-151: карточки скрытых страниц не считаются и не висят в загрузке — пусты, пока страницу не откроют */
  for (const spec of only.filter((item) => pageOf(item) !== page)) {
    const block = blocks.get(spec.id);
    if (block.element.querySelector('.state--loading')) {
      paint.forget(spec.id);
      block.setHead();
      block.setContent(document.createElement('div'));
    }
  }
  for (const spec of only.filter((item) => pageOf(item) === page)) {
    const block = blocks.get(spec.id);
    /* Копии контекста делят с общим состояние и тексты — сверка входов не строит срез своего периода */
    if (paint.current(spec.id, context)) continue;
    const blockContext = contextFor(spec.id);
    const body = block.element.querySelector('.card__body');
    if (mayDefer && spec.ready && !spec.ready(blockContext)) {
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
  }
  return deferred;
}

/* Части страницы рисуются заново, только если прочитанное прошлой отрисовкой изменилось (docs/ui-shell.md) */
function createPainter(latest) {
  const inputs = new Map();
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
    clear: () => inputs.clear(),
  });
  return paint;
}

/* Отрисовка разрешённого состояния: контекст, страница, шапка и блоки; возвращает отложенные блоки */
function paintPage(env, resolved, context, { only, withHeader, mayDefer }) {
  const { state } = context;
  const { paint } = env;
  /* J-151: видна одна страница; блоки других страниц не считаются. «Для аналитика» показывает вид главной */
  const view = viewOf(state.page);
  for (const node of document.querySelectorAll('.page-view')) node.hidden = node.dataset.page !== view;
  if (withHeader) {
    paint('#nav', context, (watched) => renderNav(env, watched));
    paint('#header', context, (watched) => renderPageHeader(env, watched));
  }
  const groups = groupContexts(env, resolved, context);
  if (withHeader) paintGroupHeads(env.cards, groups, paint);
  return renderBlocks(env.cards.blocks, { only, mayDefer, page: view }, groups.contextFor, context, paint);
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

  /* Новые данные встают на место прежних без проявления и скелета (D-56): движение — только у нажатого контрола */
  const setState = (next) => {
    holdPageHeight();
    writeState(next);
    renderSafely(next);
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
  function renderSafely(state, { only = BLOCKS, withHeader = true, mayDefer = true } = {}) {
    try {
      if (mayDefer) generation += 1;
      const deferred = render(state, { only, withHeader, mayDefer });
      failed = false;
      const scheduled = generation;
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
      cards.setAll(ERROR, error.message);
    }
  }

  /* Догрузка перерисовывает только свои блоки; после ошибки того же состояния все уже в ошибке — не смешиваем с содержимым */
  function renderRest(only) {
    if (failed) return;
    renderSafely(readState(), { only, withHeader: false, mayDefer: false });
  }

  renderSafely(readState());
  onStateChange((state) => renderSafely(state));
}

function main() {
  const hosts = pageHosts();
  keepScrollClearOfHeader(hosts.header);
  alignHeaderAmbient(hosts.header);
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
