/* Бейдж (C-04, Figma 3204:2734): pill с рамкой и свечением цвета тона */

import { element } from '../ui/dom.js';

/**
 * `strength` (0–1) — сила свечения, как у плитки тепловой карты (`--badge-strength` по той же формуле): бейдж плана по силе отклонения.
 * `fit` — ширина по тексту, без общей минимальной: статус рядом с заголовком узкой карточки не переполняет её.
 * `plan` — бейдж статуса плана: все статусы одной ролью 12 px SemiBold (`badge--plan`).
 */
export function badge(text, tone, { strength = null, fit = false, plan = false } = {}) {
  const node = element('span', `badge tone-pill tone--${tone}${strength === null ? '' : ' badge--heat'}${fit ? ' badge--fit' : ''}${plan ? ' badge--plan' : ''}`, text);
  if (strength !== null) node.style.setProperty('--badge-strength', `${Math.round(strength * 100)}%`);
  return node;
}
