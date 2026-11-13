/* Несколько последних срезов на источник: возврат к открытому срезу (назад, снятый фильтр) не пересчитывается */
const RECENT_SLICES = 8;

function remember(entries, key, compute, isValid, limit) {
  if (entries.has(key) && isValid(entries.get(key))) {
    const value = entries.get(key);
    entries.delete(key);
    entries.set(key, value);
    return value;
  }
  const value = compute();
  entries.delete(key);
  entries.set(key, value);
  if (entries.size > limit) entries.delete(entries.keys().next().value);
  return value;
}

export function recentCache(limit = RECENT_SLICES) {
  const bySource = new WeakMap();
  const cache = (source, key, compute, isValid = () => true) => {
    if (!bySource.has(source)) bySource.set(source, new Map());
    return remember(bySource.get(source), key, compute, isValid, limit);
  };
  /* Проверка без расчёта и без сдвига в очереди вытеснения */
  cache.has = (source, key, isValid = () => true) => {
    const entries = bySource.get(source);
    return Boolean(entries?.has(key) && isValid(entries.get(key)));
  };
  return cache;
}

/* Тяжёлые индексы держатся строго для нескольких последних источников, а не на всё время вкладки */
export function recentSources(sourceLimit, keyLimit = RECENT_SLICES) {
  const sources = new Map();
  return (source, key, compute, isValid = () => true) => {
    const entries = sources.get(source) ?? new Map();
    sources.delete(source);
    sources.set(source, entries);
    if (sources.size > sourceLimit) sources.delete(sources.keys().next().value);
    return remember(entries, key, compute, isValid, keyLimit);
  };
}
