import { customPeriod, previousPeriod } from '../core/period.js';
import { dashboardRows } from '../core/cashback.js';
import { DIMENSIONS } from '../core/dimensions.js';
import { recentCache } from '../core/recent.js';

function matchesFilters(row, state, dimensions, reference) {
  for (const dimension of dimensions) {
    const selected = state.filters?.[dimension.key];
    if (!selected?.length) continue;
    const values = dimension.values(row, reference).filter(Boolean);
    if (!values.some((value) => selected.includes(value))) return false;
  }
  return true;
}

/* Тот же срез — тот же массив: кэши блоков по срезу переживают перерисовку */
const slices = recentCache(4 * 8);
const canonical = (dimension) => DIMENSIONS.find(({ key }) => key === dimension.key)?.values === dimension.values;

function sliceRows(rows, state, period, dimensions, reference) {
  const compute = () => filterRows(rows, state, period, dimensions, reference);
  if (!dimensions.every(canonical)) return compute();
  const filters = dimensions.map(({ key }) => [key, state.filters?.[key] ?? []]);
  const key = JSON.stringify([state.channel ?? null, period.from, period.to, filters]);
  return slices(rows, key, () => ({ reference, rows: compute() }), (cached) => cached.reference === reference).rows;
}

function filterRows(rows, state, period, dimensions, reference) {
  return rows.filter(
    (row) =>
      (!state.channel || row.channel === state.channel) &&
      row.appeal_date >= period.from &&
      row.appeal_date <= period.to &&
      matchesFilters(row, state, dimensions, reference),
  );
}

function selectedPeriod(overrides, globalPeriod) {
  const hasFrom = Object.hasOwn(overrides, 'from');
  const hasTo = Object.hasOwn(overrides, 'to');
  if (hasFrom !== hasTo) throw new Error('Локальный период требует одновременно from и to');
  return hasFrom ? customPeriod(overrides.from, overrides.to) : globalPeriod;
}

export function createSelector({ rows, state, period: globalPeriod, dimensions, reference }) {
  return (overrides = {}) => {
    const period = selectedPeriod(overrides, globalPeriod);
    const previous = previousPeriod(period);
    const selectedState = { ...state, ...overrides, from: period.from, to: period.to };
    const eligible = dashboardRows(rows, selectedState, reference);

    return {
      rows: sliceRows(eligible, selectedState, period, dimensions, reference),
      previous: sliceRows(eligible, selectedState, previous, dimensions, reference),
      period,
      previousPeriod: previous,
    };
  };
}
