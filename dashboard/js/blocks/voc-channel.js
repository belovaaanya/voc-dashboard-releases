/*
  Большая карточка: VOC текущего среза, объём всех оценок среза (J-85), дельта к предыдущему
  аналогичному периоду и плановый коридор канала.

  Композиция (J-65): заголовок и бейдж в шапке, под бейджем справа — коридор плана;
  внизу крупное значение, справа сверху от него дельта VOC, под ним строкой — объём
  с дельтой объёма и пометка выборки. Геометрия наша (V-01…V-03).

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
  countGroupNode,
  setPlanGlow,
  statusGlow,
  forecastNode,
  leadNode,
  metaRowNode,
  pairNode,
  planCaptionNode,
  sufficiencyNode,
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
  /* Только читаемые ключи: копия всего состояния сделала бы карточку зависимой от даты и выбора (docs/ui-shell.md) */
  return { ...select({ filters }), state: { channel: state.channel, filters } };
}

export function renderVocChannel(block, context) {
  const { period, reference, label, dimensions } = context;
  const { rows: slice, previous: previousSlice, state } = channelView(context);

  const title = titleOf(state, dimensions, label);
  block.setTitle(title.text, title.full);
  /* Бейдж и стекло статуса живут на карточке и обязаны исчезать вместе с содержимым */
  block.setHead();
  setPlanGlow(block, null);
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
  setPlanGlow(block, statusGlow(value, plan, slice));

  /*
    Анатомия сегментов: дельта VOC справа сверху от числа; без сравнения слот пуст и держит место (B-07).
    Нижняя строка — как у сегментов: объём с дельтой, прогноз незаконченного периода и пометка выборки.
    Коридор плана — справа сверху, под бейджем плана: читается вместе с ним. На его прежнем месте между числом и
    объёмом — пустая строка той же высоты: число и «N оценок» стоят, где стояли, карточка «дышит»
  */
  const count = slice.length;
  const previousCount = previousSlice?.length;
  const caption = metaRowNode(countGroupNode(count, previousCount, period), forecastNode(count, previousCount, period, { focusable: true }), sufficiencyNode(slice, { focusable: true }))
    ?? emptyCaption();
  const layout = element('div', 'metric metric--big');
  appendAll(layout, planCaptionNode(plan, { corner: true }), pairNode(formatVoc(value), leadNode(vocDelta(slice, previousSlice), { large: true }), 'metric__value--big'), emptyCaption(), caption);
  block.setContent(layout);
}
