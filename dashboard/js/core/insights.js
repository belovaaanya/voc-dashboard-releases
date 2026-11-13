/**
 * Инсайты — дневные аномалии `D-47` текущего среза с оценкой по правилу `D-49`:
 * насколько изменение серьёзно и хорошо ли оно. Методика — `docs/calc-core.md`.
 */

import { ABOVE, BELOW, COMPLAINT_DIMENSIONS, VOC_METRIC, compareAnomalies, tableValue } from './anomalies.js';
import { BELOW_PLAN } from './plan.js';

export const NEGATIVE = 'negative';
export const POSITIVE = 'positive';
export const NEUTRAL = 'neutral';

export const VOC_SUBJECT = 'voc';
export const VOLUME_SUBJECT = 'volume';
export const COMPLAINT_SUBJECT = 'complaint';

export const CRITICAL = 'critical';
export const VANISHED = 'vanished';
export const SHARP = 'sharp';
export const MINOR = 'minor';
export const UNMEASURED = 'unmeasured';

/** С какого отклонения в σ изменение резкое, а не незначительное (`D-49`). */
const SHARP_DEVIATION = 2;

/** Спад частотности разреза — оценки пропадают, рост — просто больше обращений (`D-49`). */
const TONES = {
  [VOC_SUBJECT]: { [BELOW]: NEGATIVE, [ABOVE]: POSITIVE },
  [VOLUME_SUBJECT]: { [BELOW]: NEGATIVE, [ABOVE]: NEUTRAL },
  [COMPLAINT_SUBJECT]: { [BELOW]: POSITIVE, [ABOVE]: NEGATIVE },
};

/** Что считает трек: VOC, объём оценок разреза или упоминания проблемы. */
export function anomalySubject({ metric, dimension }) {
  if (metric === VOC_METRIC) return VOC_SUBJECT;
  return COMPLAINT_DIMENSIONS.has(dimension) ? COMPLAINT_SUBJECT : VOLUME_SUBJECT;
}

/** Рост числа оценок разреза сам по себе не хорош и не плох (R-51): календарь и расчётный вывод его не показывают. */
export function isVolumeRise(anomaly) {
  return anomalySubject(anomaly) === VOLUME_SUBJECT && anomaly.direction === ABOVE;
}

function anomalySeverity({ metric, direction, value, deviation, planStatus }) {
  if (metric === VOC_METRIC && direction === BELOW && planStatus === BELOW_PLAN) return CRITICAL;
  if (metric !== VOC_METRIC && value === 0) return VANISHED;
  if (deviation === null) return UNMEASURED;
  return Math.abs(deviation) >= SHARP_DEVIATION ? SHARP : MINOR;
}

export function describeAnomaly(anomaly) {
  const subject = anomalySubject(anomaly);
  return { ...anomaly, subject, tone: TONES[subject][anomaly.direction], severity: anomalySeverity(anomaly) };
}

const TONE_RANK = { [NEGATIVE]: 0, [POSITIVE]: 1, [NEUTRAL]: 2 };

/* Строка без оценки агента выше той, которую он сам назвал неважной (`D-51`) */
const IMPORTANCE_RANK = { high: 0, medium: 1, low: 3 };
const importanceRank = ({ importance }) => IMPORTANCE_RANK[importance] ?? 2;

/**
 * «Влияние»: сначала важность по ответу агента, затем падения ниже плана, негатив, позитив и нейтральное,
 * внутри — по силе в σ (ровное окно — в конце: у измеримой аномалии |σ| больше ширины коридора).
 */
export function sortInsights(insights, mode = 'influence') {
  const copy = [...insights];
  if (mode === 'chronology') return copy.sort(compareAnomalies);
  if (mode === 'influence') {
    return copy.sort(
      (left, right) =>
        importanceRank(left) - importanceRank(right) ||
        Number(right.severity === CRITICAL) - Number(left.severity === CRITICAL) ||
        TONE_RANK[left.tone] - TONE_RANK[right.tone] ||
        Math.abs(right.deviation ?? 0) - Math.abs(left.deviation ?? 0) ||
        compareAnomalies(left, right),
    );
  }
  throw new Error(`Режим сортировки не поддерживается: ${mode}`);
}

const answerKey = ({ date, channel, metric, dimension, item }) => JSON.stringify([date, channel, metric, dimension, item]);

/**
 * Ответ агента относится к строке, если совпали ключ строки таблицы аномалий и её значение:
 * ответ на другую выгрузку или опечатка в ключе не подпишут чужие числа (`D-51`).
 */
export function attachAgentAnswers(insights, answers, label) {
  if (!answers?.length) return insights;
  const byKey = new Map(answers.map((answer) => [answerKey(answer), answer]));
  return insights.map((insight) => {
    const answer = byKey.get(answerKey({ ...insight, item: label(insight.dimension, insight.key) }));
    if (!answer?.comment || tableValue(insight) !== tableValue({ metric: insight.metric, value: answer.value })) return insight;
    return { ...insight, comment: answer.comment, importance: answer.importance };
  });
}
