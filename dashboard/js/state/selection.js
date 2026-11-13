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

/* Строки канала и фильтров без периода — общие для всех периодов: протягивание таймлайна меняет только период */
const bases = recentCache(4);

function baseRows(rows, state, dimensions, reference) {
  const compute = () => {
    const picked = rows.filter((row) => (!state.channel || row.channel === state.channel) && matchesFilters(row, state, dimensions, reference));
    return { reference, rows: picked, sorted: picked.every((row, index) => !index || picked[index - 1].appeal_date <= row.appeal_date) };
  };
  const key = JSON.stringify([state.channel ?? null, dimensions.map(({ key: name }) => [name, state.filters?.[name] ?? []])]);
  return bases(rows, key, compute, (cached) => cached.reference === reference);
}

/* Первая строка с датой не раньше `date` (`after` — позже `date`) в отсортированном по дате срезе */
function boundary(rows, date, after = false) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (after ? rows[middle].appeal_date <= date : rows[middle].appeal_date < date) low = middle + 1;
    else high = middle;
  }
  return low;
}

/* Порядок строк сохраняется: при дублях кода первая запись побеждает */
function filterRows(rows, state, period, dimensions, reference) {
  /* Измерения не из DIMENSIONS кэш обходят: один проход без отдельных строк канала */
  if (!dimensions.every(canonical)) {
    return rows.filter((row) => (!state.channel || row.channel === state.channel) && row.appeal_date >= period.from
      && row.appeal_date <= period.to && matchesFilters(row, state, dimensions, reference));
  }
  const base = baseRows(rows, state, dimensions, reference);
  if (base.sorted) return base.rows.slice(boundary(base.rows, period.from), boundary(base.rows, period.to, true));
  return base.rows.filter((row) => row.appeal_date >= period.from && row.appeal_date <= period.to);
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
