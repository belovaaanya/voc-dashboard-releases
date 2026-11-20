/*
  Общая статистика правил календаря: поправка на множественные сравнения и хвост нормального распределения.
  «Провал оценок» (J-191) и «Крит. снижение VOC» (D-62) проверяют за день десятки разрезов, поэтому оба решают
  значимость по поправке Бенджамини — Хохберга, а не по каждому разрезу отдельно
*/

/** Порог Бенджамини — Хохберга: наибольшее p_(k) ≤ k/m · α среди `m` проверенных; `-1` — значимых нет. */
export function benjaminiHochberg(pValues, alpha) {
  const sorted = [...pValues].sort((left, right) => left - right);
  let threshold = -1;
  sorted.forEach((p, rank) => { if (p <= ((rank + 1) / sorted.length) * alpha) threshold = p; });
  return threshold;
}

/** P(Z ≥ z) стандартного нормального: дополнительная функция ошибок (Абрамовиц — Стиган 7.1.26, погрешность < 1,5e-7). */
export function normalTail(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erfc = poly * Math.exp(-x * x);
  return z >= 0 ? erfc / 2 : 1 - erfc / 2;
}
