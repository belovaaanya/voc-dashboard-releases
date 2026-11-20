/**
 * Выбранная дата `focus` (`D-31`): блоки, которые переходят на этот день, берут его
 * через `context.select`, не меняя global period в шапке.
 */

import { anomalyWindow, isWorkdayNotHoliday } from '../core/anomalies.js';
import { earliestDate } from '../core/dates.js';

/** Выбранный день сравнивается с окном своего коридора, как строка «Календаря событий» (`D-50`). */
export function focusedContext(context) {
  const focus = context.state.focus;
  if (!focus) return context;
  const day = context.select({ from: focus, to: focus });
  /* Праздник в окно не входит, как у строки календаря */
  const { from, to } = anomalyWindow(focus, undefined, isWorkdayNotHoliday);
  const start = earliestDate(context.rows);
  const baseline = start > to ? null : context.select({ from: from < start ? start : from, to });
  return {
    ...context,
    slice: day.rows,
    previousSlice: baseline?.rows.filter((row) => isWorkdayNotHoliday(row.appeal_date)) ?? [],
    period: day.period,
    previousPeriod: baseline?.period ?? null,
  };
}
