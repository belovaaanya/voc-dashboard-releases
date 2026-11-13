/** J-21: отдельный фильтр события меняет только детализацию, не общий срез. */
import { normalizedDays } from './chart-selection.js';
import { DIMENSIONS, osName } from '../core/dimensions.js';

const cuts = new Map(DIMENSIONS.map((dimension) => [dimension.key, dimension]));
const ALLOWED = new Set(['channel', 'segment', 'trigger', 'product', 'os']);
const KINDS = new Set(['anomaly', 'sustained-incident', 'rollout', 'incident', 'new-slice']);

export function normalizeDetailEvent(value) {
  if (!value || !ALLOWED.has(value.dimension) || typeof value.key !== 'string' || !value.key.trim()
    || typeof value.channel !== 'string' || !value.channel.trim()) return null;
  const days = normalizedDays(Array.isArray(value.days) ? value.days : []);
  return days.length ? { channel: value.channel, dimension: value.dimension, key: value.key, days,
    ...(KINDS.has(value.kind) ? { kind: value.kind } : {}),
    ...(/^[a-f0-9]{16}$/.test(value.id ?? '') ? { id: value.id } : {}) } : null;
}

export function eventDetail(event, channel) {
  let dimension = event.dimension ?? 'channel';
  let key = event.key ?? channel;
  if (event.kind === 'rollout' && event.os) { dimension = 'os'; key = osName(event.os); }
  if (event.kind === 'incident' && event.product) { dimension = 'product'; key = event.product; }
  return normalizeDetailEvent({ channel, dimension, key, days: event.days ?? [event.date], kind: event.kind, id: event.id });
}

export function sameDetailEvent(left, right) {
  const a = normalizeDetailEvent(left), b = normalizeDetailEvent(right);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

export function detailRows(context) {
  const selected = normalizeDetailEvent(context.state.detailEvent);
  /* J-49: день с графика детализацию не сужает; событие календаря передаёт свои дни (J-21) */
  if (!selected || (context.state.channel && context.state.channel !== selected.channel)) return context.slice;
  const days = new Set(selected.days);
  const rows = context.select({ from: selected.days[0], to: selected.days.at(-1) }).rows;
  return rows.filter((row) => row.channel === selected.channel && days.has(row.appeal_date)
    && (selected.dimension === 'channel' ? row.channel === selected.key
      : cuts.get(selected.dimension).values(row, context.reference).includes(selected.key)));
}
