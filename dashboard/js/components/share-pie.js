/*
  Доля сектором круговой диаграммы (J-120): закрашенный сектор — доля, остаток круга — бледный трек.
  Цвет — как у столбиков урона динамики VOC. Число доли — в подсказке и подписи для экранного диктора
*/

import { element } from '../ui/dom.js';

export function sharePie(share, { label, tone = 'negative' } = {}) {
  const pie = element('span', `share-pie share-pie--${tone}`);
  const clamped = Math.min(100, Math.max(0, Number.isFinite(share) ? share : 0));
  pie.style.setProperty('--share', `${clamped}%`);
  pie.setAttribute('role', 'img');
  if (label) {
    pie.setAttribute('aria-label', label);
    pie.title = label;
  }
  return pie;
}
