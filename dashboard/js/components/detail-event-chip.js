import { element } from '../ui/dom.js';
import { chipContent } from './focus-chip.js';
import { formatDayRange, plural } from '../core/format.js';
import { normalizeDetailEvent } from '../state/detail-event.js';

export function detailEventChip(context) {
  const event = normalizeDetailEvent(context.state.detailEvent);
  if (!event) return null;
  const chip = element('button', 'focus-chip');
  chip.append(...chipContent('Событие', formatDayRange(event.days[0], event.days.at(-1))));
  chip.type = 'button';
  chip.dataset.action = 'detail-event-clear';
  chip.setAttribute('data-action', 'detail-event-clear');
  const scope = context.label(event.dimension, event.key);
  chip.title = `${scope} · дней: ${event.days.length}`;
  chip.setAttribute('aria-label', `Сбросить фильтр события: ${scope}, ${event.days.length} ${plural(event.days.length, ['день', 'дня', 'дней'])}`);
  chip.addEventListener('click', () => context.setState({ ...context.state, focus: null, days: [], detailEvent: null }));
  return chip;
}
