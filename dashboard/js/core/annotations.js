/** Все метки одной оценки; старые выгрузки содержат только скалярное поле. */
export function annotationValues(row, field, problem = null) {
  const annotations = row.annotations?.length ? row.annotations : [row];
  return [...new Set(annotations
    .filter((annotation) => problem === null || annotation.problem === problem)
    .map((annotation) => annotation[field])
    .filter((value) => typeof value === 'string' && value.trim()))];
}
