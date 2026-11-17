/*
  J-?: шаг карточки группы аналитики — общий у графика и антидрайверов (URL `step`, переключатель в шапке
  «Динамики VOC»), свой у «Топ проблем» (`problems-step`, в его шапке). Без выбора шаг — автоматический по длине
  периода карточки; ручной помнится для своего периода (J-181): смена периода карточки снимает её шаг.
  Блок, которому шаг не подходит, берёт ближайший подходящий (`fitStep`). Пишет об этом (`stepNote`) только при шаге,
  выбранном вручную: автоматический шаг каждый блок подбирает себе молча, иначе подпись замены висела бы в состоянии
  по умолчанию. Переключатель в автоматическом режиме показывает шаг графика
*/

import { recommendedScale, SCALE_OPTIONS } from '../core/timeseries.js';

export const STEPS = SCALE_OPTIONS.map(({ value }) => value);
const STEP_PHRASE = { day: 'по дням', week: 'по неделям', month: 'по месяцам', quarter: 'по кварталам' };

export const isStep = (value) => STEPS.includes(value);

/*
  Главная облегчена (J-228): шага «Кварталы» там нет — квартальный из ссылки «Для аналитика» становится месячным
*/
export function stepOptions(analyst) {
  return analyst ? SCALE_OPTIONS : SCALE_OPTIONS.filter(({ value }) => value !== 'quarter');
}

/** Шаг группы: выбранный в URL или автоматический по периоду группы, в пределах шагов страницы. */
export function groupStep(requested, period, analyst) {
  const allowed = stepOptions(analyst).map(({ value }) => value);
  const step = isStep(requested) ? requested : recommendedScale(period);
  return fitStep(step, allowed).step;
}

/** Шаг группы выбран не вручную: в URL его нет (или он неизвестен). */
export const isAutoStep = (requested) => !isStep(requested);

/**
 * Ближайший подходящий блоку шаг: при равном расстоянии — крупнее (мелкий шаг блоку обычно и не подходит).
 * `fitted` — ручной шаг пришлось заменить: блок пишет об этом через `stepNote`. При `auto` замена молчаливая.
 */
export function fitStep(step, allowed, { auto = false } = {}) {
  if (allowed.includes(step)) return { step, fitted: false };
  const at = STEPS.indexOf(step);
  const [nearest] = [...allowed].sort((left, right) =>
    Math.abs(STEPS.indexOf(left) - at) - Math.abs(STEPS.indexOf(right) - at) || STEPS.indexOf(right) - STEPS.indexOf(left));
  return { step: nearest, fitted: !auto };
}

/** Подпись шага блока: «по неделям», с заменой — «по неделям: дни для таблицы слишком мелкие». */
export function stepNote(step, reason = '') {
  return reason ? `${STEP_PHRASE[step]}: ${reason}` : STEP_PHRASE[step];
}
