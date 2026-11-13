/**
 * Выбранная дата `focus` (`D-31`): блоки, которые переходят на этот день, берут его
 * через `context.select`, не меняя global period в шапке.
 */

import { anomalyWindow, isWorkingDay } from '../core/anomalies.js';
import { earliestDate } from '../core/dates.js';

/** Выбранный день сравнивается с окном своего коридора, как строка «Календаря событий» (`D-50`). */
export function focusedContext(context) {
  const focus = context.state.focus;
  if (!focus) return context;
  const day = context.select({ from: focus, to: focus });
  const { from, to } = anomalyWindow(focus);
  const start = earliestDate(context.rows);
  const baseline = start > to ? null : context.select({ from: from < start ? start : from, to });
  return {
    ...context,
    slice: day.rows,
    previousSlice: baseline?.rows.filter((row) => isWorkingDay(row.appeal_date)) ?? [],
    period: day.period,
    previousPeriod: baseline?.period ?? null,
  };
}
