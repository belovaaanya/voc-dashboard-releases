/**
 * Конверсия опроса — карточка шапки за целый месяц вместо «Дней относительно плана».
 *
 * Ступени (решение руководителей): MAU канала или сегмента за месяц и уникальные клиенты, получившие опрос, — из листа
 * `audience`; поставили оценку — все оценки среза; сниженные — оценки 1–3; с комментарием или обзвоном — сниженные с
 * признаком обратной связи `has_feedback` (недозвон и отказ от ОС с пустым комментарием — нет, `docs/data-model.md`,
 * J-24, J-134). Доля каждой ступени — от MAU. Только за полный месяц и только для канала или одного сегмента.
 */

import { earliestDate, isoDate, latestDate, parseIso } from './dates.js';

/** Сниженная оценка — 1–3: та же граница, что у доли с обратной связью (`negativeFeedbackShare`), а не «низкие» 1–2. */
const NEGATIVE_MAX = 3;

export const SURVEY_STEPS = [
  { key: 'mau', label: 'MAU канала за месяц', short: 'MAU' },
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

/*
  Изменение к прошлому месяцу — доля от MAU в п.п. `growth` — смысл роста: больше получивших опрос, оценивших и «с ОС»
  от аудитории — хорошо, больше сниженных — плохо. У MAU изменения нет: это база, всегда 100 %
*/
const CHANGE = {
  sent: { kind: 'share', growth: 'good' },
  rated: { kind: 'share', growth: 'good' },
  negative: { kind: 'share', growth: 'bad' },
  feedback: { kind: 'share', growth: 'good' },
};

/**
 * Прошлый календарный месяц полного месяца `period`: база изменения. Не `previousPeriod` — у месяца, выбранного вручную
 * (`custom`), тот даёт столько же дней перед ним: для октября — 31.08–30.09, а MAU нужен сентябрьский.
 */
export function previousMonth(period) {
  const start = parseIso(period.from);
  const from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0));
  return { preset: 'custom', from: isoDate(from), to: isoDate(to), complete: true };
}

/**
 * Месяц конверсии (J-331, по встречам): выбран полный месяц — он; иначе — последний полный месяц, который кончается не
 * позже конца периода и целиком покрыт выгрузкой (незаконченный ноябрь → октябрь). `{ month, shifted }`; полного месяца
 * в выгрузке нет — null.
 */
export function conversionMonth(period, rows = null) {
  if (!period?.from || !period?.to) return null;
  if (isWholeMonth(period, rows)) return { month: period, shifted: false };
  const end = parseIso(period.to);
  for (let back = 0; back <= 1; back += 1) {
    const from = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back, 1));
    const to = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back + 1, 0));
    const month = { preset: 'custom', from: isoDate(from), to: isoDate(to), complete: true };
    if (month.to <= period.to && isWholeMonth(month, rows)) return { month, shifted: true };
  }
  return null;
}

/* Фильтры, при которых конверсия от MAU не считается: MAU и рассылка есть только на канал и сегмент */
const SCOPE_FILTERS_ALLOWED = new Set(['segment']);

/**
 * Срез конверсии (решение руководителей): только весь канал или один сегмент канала. `{ segment }` — сегмент или null
 * (весь канал); `{ reason }` — почему не считается: `'filters'` — сужено триггером, ОС и т. п.; `'segments'` — несколько
 * сегментов.
 */
export function conversionScope(filters = {}, { includeCashback = true } = {}) {
  /* Без кэшбека оценки срезаны, а MAU и рассылка — по всему каналу: доли занизились бы */
  if (includeCashback === false) return { reason: 'cashback' };
  const narrowed = Object.entries(filters ?? {}).filter(([key, values]) => !SCOPE_FILTERS_ALLOWED.has(key) && values?.length);
  if (narrowed.length) return { reason: 'filters' };
  const segments = filters?.segment ?? [];
  if (segments.length > 1) return { reason: 'segments' };
  return { segment: segments[0] ?? null };
}

/**
 * Строка листа `audience` (канал × сегмент × месяц: `mau`, `surveyed`; контекст блока `audience`, импорт — «Общее») для среза; `segment` null — весь канал.
 * MAU сегментов не складываются: клиент бывает в нескольких — у канала своя строка. Нет строки или MAU — null.
 */
export function audienceFor(audience, { channel, segment = null, month }) {
  const row = (audience ?? []).find((item) => item.channel === channel && (item.segment ?? null) === segment && item.month === month);
  return Number.isFinite(row?.mau) && row.mau > 0 ? row : null;
}

function counted(ratings, audience) {
  const negative = ratings.filter(({ mark }) => mark >= 1 && mark <= NEGATIVE_MAX);
  return {
    mau: audience.mau,
    sent: Number.isFinite(audience.surveyed) ? audience.surveyed : null,
    rated: ratings.length,
    negative: negative.length,
    /* Признак не вычислен (устаревший JSON) — ступени нет, а не «0»; недозвон и отказ от ОС уже false (J-134) */
    feedback: negative.some(({ has_feedback: feedback }) => typeof feedback !== 'boolean')
      ? null
      : negative.filter(({ has_feedback: feedback }) => feedback === true).length,
  };
}

const shareOf = (count, mau) => (count === null ? null : (count * 100) / mau);

/**
 * Ступени конверсии от MAU (решение руководителей, пересматривает базу долей J-299/J-314): MAU канала или сегмента за
 * месяц — 100 %, получившие опрос, оценившие, сниженные 1–3 и «с ОС» — доля от MAU. `audience` — строка листа `audience`
 * текущего месяца (обязательна), `previous` и `previousAudience` — прошлого; `change` — изменение доли в п.п., `null` без
 * прошлого месяца или без значения ступени. Числа полной точности, округление на выводе (`D-21`).
 */
export function surveyConversion(ratings, audience, { previous = null, previousAudience = null } = {}) {
  const counts = counted(ratings, audience);
  const before = previous && previousAudience ? counted(previous, previousAudience) : null;
  return SURVEY_STEPS.map((step) => {
    const count = counts[step.key];
    const share = shareOf(count, counts.mau);
    const rule = CHANGE[step.key];
    const previousShare = before ? shareOf(before[step.key], before.mau) : null;
    const change = rule && share !== null && previousShare !== null ? { kind: rule.kind, value: share - previousShare, growth: rule.growth } : null;
    return { ...step, count, share, change };
  });
}
