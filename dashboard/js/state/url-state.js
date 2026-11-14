/*
  Состояние дашборда живёт в query-параметрах и читается оттуда при загрузке —
  URL единственный источник состояния (D-31).
*/

import { normalizedDays } from './chart-selection.js';
import { DIMENSIONS } from '../core/dimensions.js';
import { normalizeDetailEvent } from './detail-event.js';
import { normalizeDriver } from './driver-pick.js';
import { PRESETS } from '../core/period.js';
import { isIsoDate } from '../core/dates.js';

const PARAM_CHANNEL = 'channel';
const PARAM_PRESET = 'preset';
const PARAM_FROM = 'from';
const PARAM_TO = 'to';
const PARAM_FOCUS = 'focus';

/*
  Блоки со своим периодом: параметры `<блок>-preset`, `<блок>-from`, `<блок>-to` рядом с общим периодом.
  J-40: период `dynamics` — общий для блока аналитики (график, календарь, антидрайверы); свой период
  антидрайверов снят, старые параметры `antidrivers-*` игнорируются.
  Своего периода таблицы прямой речи (был `verbatim`, J-105) нет с недели 16–22.11: она живёт по периоду шапки;
  старые параметры `verbatim-*` игнорируются, иначе тихо перебивали бы период шапки
*/
export const LOCAL_PERIOD_BLOCKS = ['dynamics'];

/* J-151: страницы дашборда — пункты меню; «Главная» в URL не пишется */
export const PAGES = ['voc', 'analyst', 'roles', 'digest'];
export const DEFAULT_PAGE = 'voc';
/*
  «Для аналитика» — та же главная с теми же фильтрами и срезом, но блоки показывают продвинутые режимы и колонки.
  Режим живёт в URL (`page=analyst`): ссылка на срез и ссылка пункта меню его сохраняют. Блок проверяет
  `context.analyst`; что прятать на главной, решает он сам
*/
export const ANALYST_PAGE = 'analyst';
/** Какой вид страницы показывать: у «Для аналитика» он общий с главной. */
export const viewOf = (page) => (page === ANALYST_PAGE ? DEFAULT_PAGE : page);
/*
  Отдельной страницы «Обратная связь» нет с недели 16–22.11: таблица прямой речи — внизу «Для аналитика».
  Старая ссылка `page=feedback` (или `page=verbatim`) и ссылка с прежним периодом таблицы `verbatim-*` открывают
  «Для аналитика»; к таблице её прокручивает main.js (`opensTable`)
*/
const LEGACY_TABLE_PAGES = new Set(['feedback', 'verbatim']);
/** Старая ссылка вела на таблицу прямой речи: открыть «Для аналитика» и прокрутить к таблице. */
export function opensTable(search) {
  const params = new URLSearchParams(search);
  return LEGACY_TABLE_PAGES.has(params.get('page')) || [...params.keys()].some((key) => key.startsWith('verbatim-'));
}
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const VALID_PRESETS = new Set([...PRESETS, 'custom']);

function readDate(params, name) {
  const value = params.get(name);
  return isIsoDate(value) ? value : null;
}

export function readState(search = window.location.search) {
  const params = new URLSearchParams(search);
  const preset = params.get(PARAM_PRESET);
  const filters = {};
  for (const dimension of DIMENSIONS) {
    const raw = params.get(dimension.key);
    const values = raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : [];
    if (values.length) filters[dimension.key] = values;
  }
  const local = {};
  const detailEvent = normalizeDetailEvent({
    channel: params.get('detail-channel'), dimension: params.get('detail-dimension'), key: params.get('detail-key'),
    kind: params.get('detail-kind'), id: params.get('detail-id'),
    days: (params.get('detail-days') ?? '').split(','),
  });
  /* J-128: выбранный антидрайвер — строка или ячейка карты */
  const driver = normalizeDriver({
    cut: params.get('driver-cut'), key: params.get('driver-key'),
    from: params.get('driver-from'), to: params.get('driver-to'),
  });
  for (const id of LOCAL_PERIOD_BLOCKS) {
    const localPreset = params.get(`${id}-${PARAM_PRESET}`);
    const from = readDate(params, `${id}-${PARAM_FROM}`);
    const to = readDate(params, `${id}-${PARAM_TO}`);
    if (from && to) local[id] = { preset: VALID_PRESETS.has(localPreset) ? localPreset : null, from, to };
  }
  return {
    channel: params.get(PARAM_CHANNEL) || null,
    preset: VALID_PRESETS.has(preset) ? preset : null,
    from: readDate(params, PARAM_FROM),
    to: readDate(params, PARAM_TO),
    focus: readDate(params, PARAM_FOCUS),
    ...(params.get('cashback') === '0' ? { includeCashback: false } : {}),
    ...(detailEvent ? { detailEvent } : {}),
    ...(driver ? { driver } : {}),
    ...(params.has('days') ? { days: normalizedDays(params.get('days').split(',')) } : {}),
    /* J-151: страница и месяц дайджеста; тема «Детализации» ушла вместе с карточкой */
    page: PAGES.includes(params.get('page')) ? params.get('page') : opensTable(search) ? ANALYST_PAGE : DEFAULT_PAGE,
    ...(MONTH.test(params.get('month') ?? '') ? { month: params.get('month') } : {}),
    filters,
    local,
  };
}

export function toSearch(state) {
  const params = new URLSearchParams();
  if (state.page && state.page !== DEFAULT_PAGE && PAGES.includes(state.page)) params.set('page', state.page);
  if (state.channel) params.set(PARAM_CHANNEL, state.channel);
  if (state.month && MONTH.test(state.month)) params.set('month', state.month);
  if (VALID_PRESETS.has(state.preset)) params.set(PARAM_PRESET, state.preset);
  if (state.from) params.set(PARAM_FROM, state.from);
  if (state.to) params.set(PARAM_TO, state.to);
  if (state.focus) params.set(PARAM_FOCUS, state.focus);
  if (state.includeCashback === false) params.set('cashback', '0');
  const detailEvent = normalizeDetailEvent(state.detailEvent);
  if (detailEvent) {
    params.set('detail-channel', detailEvent.channel);
    params.set('detail-dimension', detailEvent.dimension);
    params.set('detail-key', detailEvent.key);
    params.set('detail-days', detailEvent.days.join(','));
    if (detailEvent.kind) params.set('detail-kind', detailEvent.kind);
    if (detailEvent.id) params.set('detail-id', detailEvent.id);
  }
  const driver = normalizeDriver(state.driver);
  if (driver) {
    params.set('driver-cut', driver.cut);
    params.set('driver-key', driver.key);
    if (driver.from) {
      params.set('driver-from', driver.from);
      params.set('driver-to', driver.to);
    }
  }
  const days = normalizedDays(state.days);
  if (days.length) params.set('days', days.join(','));
  for (const id of LOCAL_PERIOD_BLOCKS) {
    const local = state.local?.[id];
    if (!local?.from || !local?.to) continue;
    if (VALID_PRESETS.has(local.preset)) params.set(`${id}-${PARAM_PRESET}`, local.preset);
    params.set(`${id}-${PARAM_FROM}`, local.from);
    params.set(`${id}-${PARAM_TO}`, local.to);
  }
  for (const dimension of DIMENSIONS) {
    const values = state.filters?.[dimension.key];
    if (values?.length) params.set(dimension.key, values.join(','));
  }
  const query = params.toString();
  return query ? `?${query}` : window.location.pathname;
}

export function writeState(state) {
  window.history.pushState(null, '', toSearch(state));
}

/*
  Достроенное по умолчанию состояние дописывается в URL без новой записи в
  истории: иначе пересланная ссылка без ?channel покажет получателю его первый
  канал, а не срез отправителя (D-31)
*/
export function syncState(state) {
  window.history.replaceState(null, '', toSearch(state));
}

export function onStateChange(handler) {
  window.addEventListener('popstate', () => handler(readState()));
}

/*
  Точечная замена одного измерения: блок, который ставит свой фильтр, не должен
  знать про остальные и уж тем более их пересобирать. Пустой список убирает
  параметр целиком — иначе в URL остаётся `segment=` без значения.
*/
export function withFilter(filters, dimension, values) {
  const next = { ...filters };
  if (values?.length) next[dimension] = values;
  else delete next[dimension];
  return next;
}

/* Дату выбирают и на графике со своим периодом: она валидна внутри любого из показанных периодов */
export function focusInPeriod(focus, ...periods) {
  return focus && periods.some((period) => focus >= period.from && focus <= period.to) ? focus : null;
}
