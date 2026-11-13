/*
  Человекочитаемые подписи приходят из справочника `labels` в `reference.json`;
  нет подписи — показываем код (D-02).

  Формат: { "<измерение>": { "<код>": "<подпись>" } } (data-model §7), где
  измерение — канонический id (`channel`, `segment`, …). Русские названия из
  листа `labels` приводит к ним конвертер: словарь соответствия живёт в одном
  месте, и это не браузер (D-39).
*/

/* J-10: подписи сравниваются без регистра и лишних пробелов; ё и тире сводятся только там, где источник их путает */
const DASH_CHARS = '‐‑‒–—−';
const DASHES_TO_HYPHEN = new RegExp(`[${DASH_CHARS}]`, 'gu');
const DASHES_TO_SPACE = new RegExp(`[\\s\\-${DASH_CHARS}]+`, 'gu');

export function normalizeLabel(value, { yo = false, dashes = null } = {}) {
  let text = String(value ?? '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru');
  if (yo) text = text.replaceAll('ё', 'е');
  if (dashes === 'hyphen') text = text.replace(DASHES_TO_HYPHEN, '-');
  if (dashes === 'space') text = text.replace(DASHES_TO_SPACE, ' ');
  return text;
}

/* Справочник один на загрузку, а подписи нужны в каждом расчёте: функция строится один раз на reference */
const byReference = new WeakMap();
let withoutReference = null;

export function createLabels(reference) {
  if (!reference || typeof reference !== 'object') return (withoutReference ??= buildLabels(null));
  if (!byReference.has(reference)) byReference.set(reference, buildLabels(reference));
  return byReference.get(reference);
}

function buildLabels(reference) {
  const byDimension = new Map();
  for (const [dimension, codes] of Object.entries(reference?.labels ?? {})) {
    byDimension.set(dimension.trim().toLowerCase(), codes);
  }
  return (dimension, code) => byDimension.get(String(dimension).trim().toLowerCase())?.[code] ?? code;
}
