import { EMPTY, ERROR, LOADING } from '../shell/block.js';
import { DOWN, FLAT, UP, contextEvent, mainConclusion } from '../core/conclusion-pool.js';
import { eventType } from '../core/calendar.js';
import { element } from '../ui/dom.js';
import { formatCount, formatDate, formatDateRange, formatImpact, formatVoc } from '../core/format.js';
import { closeHoverTooltip, hoverTooltip } from '../components/hover-tooltip.js';
import { statusPanel } from '../components/status-panel.js';
import { roundImpact } from '../core/round.js';
import { conclusionFactors, conclusionKey, isConclusion } from '../core/conclusion-payload.js';
import { buildConclusionPayload, llm } from '../io/llm-conclusion.js';
import { calendarEventsOf, eventSelectionContext } from '../state/event-analysis.js';


/*
  Вывод — одна главная причина по знаку ΔVOC (решение пользователя 14.11): рост — драйвер, снижение — антидрайвер,
  без изменений — сильнейший фактор. Карточка тонирована тоном направления; тип причины — мелко над ней, причина —
  крупно, вторая строка тише: второй кандидат другого типа и событие календаря периода. Числа — в подсказке
*/
const HEADLINE = {
  [UP]: 'VOC вырос — драйвер',
  [DOWN]: 'VOC снизился — антидрайвер',
  [FLAT]: 'VOC без изменений — сильнейший фактор',
};
const TONE = { [UP]: 'positive', [DOWN]: 'negative', [FLAT]: 'neutral' };

/* Тон — атрибут карточки, как свечение сегментов: каркас сам поверхность не перекрашивает (C-02) */
function setTone(block, direction) {
  const card = block.element;
  if (!card?.dataset) return;
  if (direction) card.dataset.conclusionTone = TONE[direction];
  else delete card.dataset.conclusionTone;
}

function factorLines(factor, context) {
  const before = context.previousPeriod;
  const previous = before ? formatDateRange(before.from, before.to) : 'предыдущий аналогичный период';
  const scope = Object.values(context.state.filters ?? {}).some(values => values?.length) ? 'выбранный срез канала' : 'канал';
  return [factor.caption ? `${factor.caption}: ${factor.name}` : factor.name,
    `Вклад в ΔVOC: ${formatImpact(roundImpact(factor.impact))} (${scope} ${context.state.channel ?? ''})`,
    `Оценок: ${formatCount(factor.ratings)} (было ${formatCount(factor.previousRatings)})`,
    `VOC параметра: ${formatVoc(factor.voc)} (было ${formatVoc(factor.previousVoc)})`,
    `Эффект оценок: ${formatImpact(roundImpact(factor.markEffect))}; структуры: ${formatImpact(roundImpact(factor.mixEffect))}`,
    `${formatDateRange(context.period.from, context.period.to)} к ${previous}`,
  ];
}

/* Вторая строка: второй кандидат другого типа и событие календаря периода с датой */
function contextLine(second, event) {
  return [second && `${second.caption}: ${second.name}`, event && `${eventType(event)?.label ?? 'Событие'} ${formatDate(event.date)}`]
    .filter(Boolean).join(' · ');
}

function causeNode({ direction, main, detail, tooltip }) {
  const cause = element('div', 'summary-cause');
  cause.setAttribute('tabindex', '0');
  cause.setAttribute('role', 'group');
  cause.setAttribute('aria-label', `${HEADLINE[direction]}: ${main.caption ? `${main.caption.toLowerCase()} ` : ''}${main.name}`);
  const lead = element('p', 'summary-cause__lead', main.caption ? `${HEADLINE[direction]} · ${main.caption}` : HEADLINE[direction]);
  const name = element('p', 'summary-cause__name', main.name);
  cause.append(lead, name);
  if (detail) cause.append(element('p', 'summary-cause__detail', detail));
  hoverTooltip(cause, tooltip);
  return cause;
}

function calendarEvent(context, direction) {
  try {
    return contextEvent(calendarEventsOf(eventSelectionContext(context)), context.period, direction);
  } catch {
    return null;
  }
}

function renderComputed(block, context, { llmNote = false } = {}) {
  const { direction, delta, main, second } = mainConclusion(conclusionFactors(context));
  /* Источник — в шапке, а не строкой тела: вывод помещается без прокрутки (J-07) */
  block.setHead({ ai: false, note: llmNote ? sourceNote() : undefined });
  if (!main) {
    setTone(block, null);
    block.setContent(statusPanel('summary-note', {
      title: delta === null ? 'Нет данных предыдущего периода' : 'Нет факторов изменения VOC',
      look: 'text',
    }));
    return;
  }
  setTone(block, direction);
  const tooltip = [...factorLines(main, context), ...(second ? factorLines(second, context) : [])];
  block.setContent(causeNode({ direction, main, detail: contextLine(second, calendarEvent(context, direction)), tooltip }));
}

/* J-196: подпись говорит, чем вывод отличается от вывода LLM; подсказка — как он посчитан */
export const LLM_FALLBACK_NOTE = 'LLM недоступна — главная причина выбрана по вкладу в изменение VOC, без текста модели';
export const LLM_FALLBACK_LABEL = 'Вывод без LLM';

function sourceNote() {
  const note = element('span', 'summary-source', LLM_FALLBACK_LABEL);
  note.title = LLM_FALLBACK_NOTE;
  note.setAttribute('aria-label', LLM_FALLBACK_NOTE);
  return note;
}

/* LLM называет одну причину из пула того же направления; вторая строка — её пояснение */
function renderLlm(block, answer, context) {
  const pool = conclusionFactors(context);
  const factor = answer.antidriver ?? answer.driver;
  const evidence = pool.candidates.find(candidate => candidate.name === factor.name) ?? { name: factor.name };
  const { direction } = mainConclusion(pool);
  setTone(block, direction);
  block.setHead({ ai: true });
  block.setContent(causeNode({ direction, main: evidence, detail: factor.why,
    tooltip: evidence.impact === undefined ? [factor.name, factor.why] : [...factorLines(evidence, context), factor.why] }));
}

/* Скелет — та же композиция одной причины: загрузка не меняет высоту карточки */
function skeleton() {
  const cause = element('div', 'summary-cause summary-cause--skeleton');
  cause.setAttribute('aria-hidden', 'true');
  for (const part of ['lead', 'name', 'detail']) cause.append(element('div', `state__skeleton summary-cause__${part}`));
  return cause;
}

/* Запрос блока в полёте: тот же payload его не отменяет, другой — отменяет */
const requests = new WeakMap();

function cancelRequest(block) {
  requests.get(block)?.controller.abort();
  requests.delete(block);
}

/**
 * Запрос прошлого среза отвязывается, а не отменяется: его ответ ложится в кэш клиента
 * для возврата к срезу, но не поверх нового.
 */
export function detachConclusion(block) {
  requests.delete(block);
}

/** Скелет до расчёта — у первой отрисовки. */
export function conclusionPlaceholder(block) {
  detachConclusion(block);
  block.setHead();
  setTone(block, null);
  block.setState(LOADING, skeleton());
}

export function renderConclusion(block, context) {
  closeHoverTooltip();
  block.setHead();
  block.element?.querySelector('.card__body')?.classList.add('scroll-area');
  if (context.slice.length === 0) {
    cancelRequest(block);
    setTone(block, null);
    block.setState(EMPTY);
    return;
  }
  const client = context.llm ?? llm;
  const payload = buildConclusionPayload(context);
  if (payload.voc.previous === null || (!payload.antidrivers.length && !payload.drivers.length)) {
    cancelRequest(block);
    renderComputed(block, context);
    return;
  }
  const key = conclusionKey(payload);
  const inFlight = requests.get(block);
  if (inFlight?.key === key) {
    inFlight.context = context;
    return;
  }
  cancelRequest(block);
  const cached = client.cached(payload);
  if (cached) {
    if (isConclusion(cached, payload)) renderLlm(block, cached, context);
    else renderComputed(block, context, { llmNote: true });
    return;
  }
  if (client.knownAvailability() === false) {
    renderComputed(block, context, { llmNote: true });
    return;
  }
  const request = { key, controller: new AbortController(), context };
  const { signal } = request.controller;
  requests.set(block, request);
  setTone(block, null);
  block.setState(LOADING, skeleton());
  client.fetchConclusion(payload, { signal })
    .then((answer) => {
      if (!isConclusion(answer, payload)) throw new Error('llm-evidence');
      if (!signal.aborted && requests.get(block) === request) renderLlm(block, answer, request.context);
    })
    .catch(() => {
      if (signal.aborted || requests.get(block) !== request) return;
      try {
        renderComputed(block, request.context, { llmNote: true });
      } catch (error) {
        block.setState(ERROR, error.message);
      }
    })
    .finally(() => {
      if (requests.get(block) === request) requests.delete(block);
    });
}
