/*
  Плитка второй строки метрик: `Доля оценок 1–3` (J-85; до него здесь были
  `Оценок`, `% негатива с обратной связью`, `Доля 5★`, D-15, J-24).

  По уточнению заказчика: заголовок без кольца (`V-10a`, `V-25`). J-65: внизу
  число и дельта рядом с ним, как у VOC-сегментов.
*/

import { EMPTY } from '../shell/block.js';
import { element } from '../ui/dom.js';
import { formatShare } from '../core/format.js';
import { deltaOf, summarize } from '../core/metrics.js';
import { DELTA_SHAPES, GROWTH, leadNode, pairNode } from './metric-card.js';

const TALLIES = {
  shareLow: { read: (summary) => summary.shareLow, format: formatShare, shape: DELTA_SHAPES.share, growth: GROWTH.bad },
};

/** Реестр держит по строке на карточку, а показатель карточки — ключ из `TALLIES`. */
export function tally(key) {
  return (block, context) => render(block, context, TALLIES[key]);
}

function render(block, context, spec) {
  const { slice, previousSlice } = context;

  block.setHead();
  if (slice.length === 0) {
    block.setState(EMPTY);
    return;
  }

  const value = spec.read(summarize(slice));
  /* Пустой предыдущий срез — сравнивать не с чем: «+10 459» там читалось бы как рост с нуля */
  const delta = previousSlice.length === 0 ? null : deltaOf(value, spec.read(summarize(previousSlice)));

  const layout = element('div', 'metric metric--tally');
  layout.append(pairNode(spec.format(value), leadNode(delta, { shape: spec.shape, growth: spec.growth }), undefined, { wrap: true }));

  block.setContent(layout);
}
