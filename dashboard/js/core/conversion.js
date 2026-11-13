/**
 * Конверсия опроса — карточка шапки за целый месяц вместо «Дней относительно плана».
 *
 * Ступени: MAU цифровых каналов и получившие опрос — в выгрузке нет, значение `null` («—»);
 * поставили оценку — все оценки среза; сниженные — оценки 1–3; с комментарием или обзвоном —
 * сниженные с признаком обратной связи `has_feedback` (непустой комментарий клиента или экспертиза
 * с установленной причиной, `docs/data-model.md`, J-24, J-134). Доля — от «поставили оценку»:
 * первая известная ступень. Числа полной точности, округление на выводе (`D-21`).
 */

import { earliestDate, isoDate, latestDate, parseIso } from './dates.js';

/** Сниженная оценка — 1–3: та же граница, что у доли с обратной связью (`negativeFeedbackShare`), а не «низкие» 1–2. */
const NEGATIVE_MAX = 3;

export const SURVEY_STEPS = [
  { key: 'mau', label: 'MAU цифровых каналов', short: 'MAU' },
  { key: 'sent', label: 'Получили опрос', short: 'Опрос' },
  { key: 'rated', label: 'Поставили оценку', short: 'Оценки' },
  { key: 'negative', label: 'Сниженные оценки 1–3', short: '1–3' },
  { key: 'feedback', label: 'С комментарием или обзвоном', short: 'С ОС' },
];

/**
 * Период — ровно один календарный месяц: с 1-го по последний день, и выгрузка покрывает его целиком.
 * `rows` — все оценки выгрузки: произвольный диапазон «01.11–30.11» при данных до 13.11 помечен завершённым,
 * но месяц в данных не целый — такая карточка выдала бы 13 дней за месяц.
 */
export function isWholeMonth(period, rows = null) {
  if (!period?.from || !period?.to || period.complete === false) return false;
  if (rows && (!rows.length || earliestDate(rows) > period.from || latestDate(rows) < period.to)) return false;
  if (!period.from.endsWith('-01') || period.from.slice(0, 7) !== period.to.slice(0, 7)) return false;
  const start = parseIso(period.from);
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return isoDate(last) === period.to;
}

/**
 * Ступени конверсии по оценкам среза. `count` — `null`, если ступени нет в выгрузке; `share` — доля
 * от «поставили оценку» в процентах, `null` без оценок или без значения ступени.
 */
export function surveyConversion(ratings) {
  const rated = ratings.length;
  const negative = ratings.filter(({ mark }) => mark >= 1 && mark <= NEGATIVE_MAX);
  const counts = {
    mau: null,
    sent: null,
    rated,
    negative: negative.length,
    /* Признак не вычислен (устаревший JSON) — ступени нет, как у доли с ОС, а не «0» */
    feedback: negative.some(({ has_feedback: feedback }) => typeof feedback !== 'boolean')
      ? null
      : negative.filter(({ has_feedback: feedback }) => feedback === true).length,
  };
  return SURVEY_STEPS.map((step) => {
    const count = counts[step.key];
    return { ...step, count, share: count === null || rated === 0 ? null : (count * 100) / rated };
  });
}
