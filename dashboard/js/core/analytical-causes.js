/** J-10: исключаем причину из аналитики, сохраняя исходные оценки и разметку. */
import { createLabels, normalizeLabel } from './labels.js';

/* Строки оценок неизменяемы, а проекции читаются на каждом расчёте аномалий: считаем их один раз на строку */
const byRow = new WeakMap();

/* Ключи и подписи — конечный набор выгрузки и справочника: вердикт помнится по строке */
const verdicts = new Map();

function isIgnoredCause(value) {
  if (typeof value !== 'string') return false;
  if (!verdicts.has(value)) verdicts.set(value, normalizeLabel(value) === 'не дозвонились');
  return verdicts.get(value);
}

export function ignoredCauseKey(dimension, key, label = (_dimension, value) => value) {
  return isIgnoredCause(key) || isIgnoredCause(label(dimension, key));
}

function projectionsOf(row, reference) {
  const saved = byRow.get(row);
  if (saved?.reference === reference) return saved;
  const fresh = { reference, values: new Map() };
  byRow.set(row, fresh);
  return fresh;
}

function remembered(row, reference, name, compute) {
  const { values } = projectionsOf(row, reference);
  if (!values.has(name)) values.set(name, Object.freeze(compute()));
  return values.get(name);
}

export function complaintAnnotations(row, reference = null) {
  return remembered(row, reference, 'annotations', () => {
    const label = createLabels(reference);
    return (row.annotations?.length ? row.annotations : [row])
      .filter(annotation => !['problem', 'problem_type', 'domain'].some(field => ignoredCauseKey(field, annotation[field], label)));
  });
}

export function complaintValues(row, field, reference = null) {
  return remembered(row, reference, `values:${field}`, () => [...new Set(complaintAnnotations(row, reference).map(annotation => annotation[field])
    .filter(value => typeof value === 'string' && value.trim()))]);
}

export function categoryValues(row, reference = null) {
  return remembered(row, reference, 'category', () => (typeof row.category === 'string' && row.category.trim()
    && !ignoredCauseKey('category', row.category, createLabels(reference)) ? [row.category] : []));
}
