/*
  Большая карточка: VOC текущего среза, объём всех оценок среза (J-85), дельта к предыдущему
  аналогичному периоду и плановый коридор канала.

  Композиция (J-65): заголовок и бейдж в шапке; внизу крупное значение, под
  ним строкой — дельта, коридор плана и пометка выборки. Геометрия наша (V-01…V-03).

  Заголовок ставит сама карточка: он обязан называть тот же срез, который
  показан числом. «VOC канала» над значением одного сегмента — то же
  противоречие интерфейса самому себе, от которого защищает D-22.

  J-95: выбран один сегмент — карточка, как и соседние сегменты, считает срез без
  него и серая (metrics.css): клик по сегменту не меняет число канала.
*/

import { EMPTY } from '../shell/block.js';
import { CHANNEL_DIMENSION } from '../core/dimensions.js';
import { appendAll, element } from '../ui/dom.js';
import { formatVoc } from '../core/format.js';
import { voc, vocDelta } from '../core/metrics.js';
import { planFor } from '../core/plan.js';
import { withFilter } from '../state/url-state.js';
import {
  badgeNode,
  countNode,
  deltaNode,
  metaRowNode,
  planCaptionNode,
  sufficiencyNode,
  valueNode,
} from './metric-card.js';

/** Заголовок называет срез: канал, а при сужении одним сегментом — ещё и его; `full` — подписи только названных кодов (D-53). */
export function titleOf(state, dimensions, label) {
  const applied = dimensions.filter((dimension) => state.filters?.[dimension.key]?.length);
  const segment = state.filters?.segment ?? [];
  const singleSegment = applied.length === 1 && segment.length === 1;
  const named = [state.channel && [CHANNEL_DIMENSION, state.channel], singleSegment && ['segment', segment[0]]].filter(Boolean);
  const text = [
    state.channel ? `VOC ${state.channel}` : 'VOC канала',
    singleSegment && segment[0],
    applied.length && !singleSegment && 'срез по фильтрам',
  ].filter(Boolean).join(', ');
  const full = named.map(([key, code]) => label(key, code)).filter((name, index) => name !== named[index][1]);
  return { text, full: full.join(', ') };
}

function emptyCaption() {
  const row = element('span', 'metric__caption metric__caption--empty', '\u00a0');
  row.setAttribute('aria-hidden', 'true');
  return row;
}

/** J-95: один выбранный сегмент не сужает карточку канала; два и больше — срез фильтра, сегмент-кнопки при этом не нажаты. */
function channelView({ slice, previousSlice, state, select }) {
  if (state.filters?.segment?.length !== 1) return { rows: slice, previous: previousSlice, state };
  const filters = withFilter(state.filters, 'segment', []);
  return { ...select({ filters }), state: { ...state, filters } };
}

export function renderVocChannel(block, context) {
  const { period, reference, label, dimensions } = context;
  const { rows: slice, previous: previousSlice, state } = channelView(context);

  const title = titleOf(state, dimensions, label);
  block.setTitle(title.text, title.full);
  /* Бейдж живёт в шапке карточки и обязан исчезать вместе с содержимым */
  block.setHead();
  if (slice.length === 0) {
    block.setState(EMPTY);
    return;
  }

  const value = voc(slice);
  const plan = planFor(reference?.plan, {
    channel: state.channel,
    from: period.from,
    to: period.to,
  });

  block.setHead({ note: badgeNode(value, plan) });

  /* J-65: значение и его подпись — одной группой у низа карточки; дельта первой в строке под числом; без сравнения её нет, а пустая строка держит высоту — число не прыгает (B-07) */
  const caption = metaRowNode(deltaNode(vocDelta(slice, previousSlice), { className: 'metric__lead', large: true }), planCaptionNode(plan), countNode(slice.length), sufficiencyNode(slice, { focusable: true }))
    ?? emptyCaption();
  const layout = element('div', 'metric metric--big');
  appendAll(layout, valueNode(formatVoc(value), 'metric__value--big'), caption);
  block.setContent(layout);
}
