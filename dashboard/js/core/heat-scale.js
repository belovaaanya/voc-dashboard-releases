/*
  Горячие ячейки тепловых шкал: общий порог для «Топ проблем» и тепловой карты антидрайверов.
  Уровень силы — 0…1 по шкале блока; горячая — верхняя половина шкалы (HOT_LEVEL = 0,5): на данных ячейку, которую
  пользователь отметила горячей, порог в 2/3 не пропускал. Внутри — пять ступеней вида из макета светлой темы «Топ
  проблем», от мягкой (5) у порога к самой яркой (1) у вершины, равными долями. Карте антидрайверов ступени не нужны —
  у неё один горячий вид, порог тот же
*/

export const HOT_LEVEL = 0.5;
export const HOT_STEP_COUNT = 5;

/** Ступень горячей ячейки 1…5 (1 — самая яркая) или null ниже порога. */
export function hotStep(level) {
  if (!Number.isFinite(level) || level < HOT_LEVEL) return null;
  const width = (1 - HOT_LEVEL) / HOT_STEP_COUNT;
  const fromBottom = Math.min(HOT_STEP_COUNT - 1, Math.floor((level - HOT_LEVEL) / width + 1e-9));
  return HOT_STEP_COUNT - fromBottom;
}
