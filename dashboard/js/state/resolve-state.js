/* Полное состояние из запрошенного в URL (D-31), без DOM: запись в URL остаётся за main.js */

import { dashboardRows } from '../core/cashback.js';
import { VERSION_CHANNEL } from '../core/antidrivers.js';
import { channelDimensions, servableFilters } from '../core/dimensions.js';
import { normalizedDays } from './chart-selection.js';
import { periodFromState } from './controls.js';
import { normalizeDetailEvent } from './detail-event.js';
import { normalizeDriver } from './driver-pick.js';
import { DEFAULT_PAGE, LOCAL_PERIOD_BLOCKS, PAGES, focusInPeriod } from './url-state.js';

/* J-40: общий период группы аналитики — выбранный день живёт в нём, период прямой речи день не продлевает */
export const SHARED_PERIOD = 'dynamics';

/* Local period из URL правится руками: вывернутый диапазон гасит только его, а не весь дашборд */
export function resolveLocalPeriods(requested, manifestPeriod) {
  const periods = {};
  for (const id of LOCAL_PERIOD_BLOCKS) {
    const local = requested.local?.[id];
    if (!local) continue;
    try {
      periods[id] = periodFromState(local, null, manifestPeriod);
    } catch {
      /* невалидный local period — блок показывает общий */
    }
  }
  return periods;
}

/* J-128: версия — разрез только АБМ; выбор версии на другом канале снимается */
function resolvedDriver(requested, channel) {
  const driver = normalizeDriver(requested.driver);
  return driver && (driver.cut !== 'app_version' || channel === VERSION_CHANNEL) ? driver : null;
}

/* Событие календаря держится, пока его канал выбран и выбранный день входит в его дни */
function resolvedDetailEvent(requested, channel, focus) {
  const detail = normalizeDetailEvent(requested.detailEvent);
  return detail && detail.channel === channel && focus && detail.days.includes(focus) ? detail : null;
}

/* Бросает на вывернутом общем периоде намеренно: каркас показывает состояние ошибки (D-41) */
export function resolveState(requested, { rows, reference, channels, fallbackPeriod, manifestPeriod }) {
  const period = periodFromState(requested, fallbackPeriod, manifestPeriod);
  const localPeriods = resolveLocalPeriods(requested, manifestPeriod);
  const focusPeriods = localPeriods[SHARED_PERIOD] ? [localPeriods[SHARED_PERIOD]] : [];
  const channel = requested.channel && channels.includes(requested.channel) ? requested.channel : channels[0] ?? null;
  const eligible = dashboardRows(rows, requested, reference);
  const dimensions = channelDimensions(eligible, channel, reference);
  /* J-21/J-26: ФО и дирекция скрыты в панели, прежние global filters снимаются */
  const { domain: removedDomain, cp: removedDirection, ...requestedFilters } = requested.filters ?? {};
  const state = {
    ...requested,
    filters: servableFilters(requestedFilters, dimensions),
    channel,
    /* J-151: страница — из URL; без неё и с неизвестной — главная */
    page: PAGES.includes(requested.page) ? requested.page : DEFAULT_PAGE,
    preset: period.preset,
    from: period.from,
    to: period.to,
    focus: focusInPeriod(requested.focus, period, ...focusPeriods),
    ...(requested.days ? { days: normalizedDays(requested.days).filter((day) => focusInPeriod(day, period, ...focusPeriods)) } : {}),
    local: Object.fromEntries(Object.entries(localPeriods).map(([id, { preset, from, to }]) => [id, { preset, from, to }])),
  };
  const driver = resolvedDriver(requested, channel);
  if (driver) state.driver = driver;
  else delete state.driver;
  if (Object.hasOwn(requested, 'detailEvent')) state.detailEvent = resolvedDetailEvent(requested, channel, state.focus);
  return { state, period, localPeriods, eligible, dimensions };
}
