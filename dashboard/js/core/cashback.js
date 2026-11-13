/** J-21, J-103: исключается целый факт, если хотя бы один триггер — подтверждение категорий кэшбека. */
import { normalizeLabel } from './labels.js';

const normalized = (value) => normalizeLabel(value, { yo: true });
/* Названия из выгрузки: в каждом канале своё. Похожие триггеры намеренно не входят */
const CASHBACK_TRIGGERS = new Set([
  'Подтверждение категорий кэшбека', // НИБ
  'Клиент подтвердил категории кэшбека (АБМ)',
].map(normalized));
const cache = new WeakMap();

export function dashboardRows(rows, state, reference) {
  if (state.includeCashback !== false) return rows;
  const saved = cache.get(rows);
  if (saved && saved.reference === reference) return saved.rows;
  const filtered = rows.filter((row) => !(row.operations ?? []).some((key) =>
    CASHBACK_TRIGGERS.has(normalized(key)) || CASHBACK_TRIGGERS.has(normalized(reference?.labels?.trigger?.[key]))));
  cache.set(rows, { reference, rows: filtered });
  /* Шапка уже отфильтровала строки, а createSelector применяет правило ещё раз: повтор возвращает тот же массив */
  cache.set(filtered, { reference, rows: filtered });
  return filtered;
}
