import { selectionChip } from './focus-chip.js';
import { formatDayRange, plural } from '../core/format.js';
import { normalizeDetailEvent } from '../state/detail-event.js';

export function detailEventChip(context) {
  const event = normalizeDetailEvent(context.state.detailEvent);
  if (!event) return null;
  const scope = context.label(event.dimension, event.key);
  return selectionChip({
    caption: 'Событие',
    value: formatDayRange(event.days[0], event.days.at(-1)),
    action: 'detail-event-clear',
    label: `Сбросить фильтр события: ${scope}, ${event.days.length} ${plural(event.days.length, ['день', 'дня', 'дней'])}`,
    title: `${scope} · дней: ${event.days.length}`,
    onClear: () => context.setState({ ...context.state, focus: null, days: [], detailEvent: null }),
  });
}
