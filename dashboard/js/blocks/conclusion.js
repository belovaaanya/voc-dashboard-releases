import { EMPTY, ERROR, LOADING } from '../shell/block.js';
import { ABOVE, BELOW } from '../core/anomalies.js';
import { conclusionGroups } from '../core/conclusions.js';
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formatCount, formatDateRange, formatImpact, formatVoc } from '../core/format.js';
import { closeHoverTooltip, hoverTooltip } from '../components/hover-tooltip.js';
import { statusPanel } from '../components/status-panel.js';
import { roundImpact } from '../core/round.js';
import { conclusionFactors, conclusionKey, isConclusion } from '../core/conclusion-payload.js';
import { buildConclusionPayload, llm } from '../io/llm-conclusion.js';


function directionIcon(name) {
  const box = element('span', 'summary-row__icon');
  box.setAttribute('aria-hidden', 'true');
  box.append(icon(name));
  return box;
}

/*
  Строка — 3–10 слов без прокрутки (J-07): тип по знаку итогового вклада (J-12) и причина. Тип
  называет себя («Драйвер» / «Антидрайвер», J-91), поэтому отдельной подписи группы нет; числа и дата — в подсказке
*/
function causeInsight(lead, subject) {
  const item = element('li', 'summary-insight');
  item.append(element('span', 'summary-row__lead', `${lead}: `), subject);
  return item;
}

function factorInsight(direction, factor, context) {
  const item = causeInsight(direction === ABOVE ? 'Драйвер' : 'Антидрайвер', factor.name);
  item.title = factorLines(factor, context).join('\n');
  return item;
}

function factorLines(factor, context) {
  const before = context.previousPeriod;
  const previous = before ? formatDateRange(before.from, before.to) : 'предыдущий аналогичный период';
  const scope = Object.values(context.state.filters ?? {}).some(values => values?.length) ? 'выбранный срез канала' : 'канал';
  return [factor.name,
    `Вклад в ΔVOC: ${formatImpact(roundImpact(factor.impact))} (${scope} ${context.state.channel ?? ''})`,
    `Оценок: ${formatCount(factor.ratings)} (было ${formatCount(factor.previousRatings)})`,
    `VOC параметра: ${formatVoc(factor.voc)} (было ${formatVoc(factor.previousVoc)})`,
    `Эффект оценок: ${formatImpact(roundImpact(factor.markEffect))}; структуры: ${formatImpact(roundImpact(factor.mixEffect))}`,
    `${formatDateRange(context.period.from, context.period.to)} к ${previous}`,
  ];
}

function summaryRow(group, context) {
  const { direction, tone, items } = group;
  const caption = direction === ABOVE ? 'Драйвер' : 'Антидрайвер';
  const row = element('div', `summary-row hover-row tone--${tone}`);
  row.setAttribute('tabindex', '0');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', caption);
  const copy = element('div', 'summary-row__text');
  const list = element('ul', 'summary-group');
  for (const { factor } of items) list.append(factorInsight(direction, factor, context));
  copy.append(list);
  row.append(directionIcon(direction === ABOVE ? 'trend-up' : 'trend-down'), copy);
  const lines = items.flatMap(({ factor }) => factorLines(factor, context));
  hoverTooltip(row, lines);
  for (const item of list.children) item.removeAttribute('title');
  return row;
}

function renderComputed(block, context, { llmNote = false } = {}) {
  const conclusion = conclusionGroups(conclusionFactors(context));
  const list = element('div', 'summary-list');
  for (const group of conclusion.groups) list.append(summaryRow(group, context));
  if (!conclusion.groups.length) {
    list.append(statusPanel('summary-note', {
      title: conclusion.delta === null ? 'Нет данных предыдущего периода' : 'Нет факторов изменения VOC',
      look: 'text',
    }));
  }
  /* Источник — в шапке, а не строкой тела: вывод помещается без прокрутки (J-07) */
  block.setHead({ ai: false, note: llmNote ? sourceNote() : undefined });
  block.setContent(list);
}

/* J-196: подпись говорит, чем вывод отличается от вывода LLM; подсказка — как он посчитан */
export const LLM_FALLBACK_NOTE = 'LLM недоступна — драйверы и антидрайверы выбраны по вкладу в изменение VOC, без текста модели';
export const LLM_FALLBACK_LABEL = 'Вывод без LLM';

function sourceNote() {
  const note = element('span', 'summary-source', LLM_FALLBACK_LABEL);
  note.title = LLM_FALLBACK_NOTE;
  note.setAttribute('aria-label', LLM_FALLBACK_NOTE);
  return note;
}

/* Строки LLM: антидрайвер — вниз и негатив, драйвер — вверх и позитив (Figma 3204:2849) */
function llmRow({ caption, direction, tone, factor, evidence, context }) {
  const row = element('div', `summary-row hover-row tone--${tone}`);
  row.setAttribute('tabindex', '0');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', caption);
  const item = element('p', 'summary-insight summary-insight--llm');
  item.append(element('span', 'summary-row__prefix', `${caption}: `), element('span', 'summary-row__factors', factor.name), ` — ${factor.why}`);
  item.title = `${caption}: ${factor.name} — ${factor.why}`;
  const copy = element('div', 'summary-row__text');
  copy.append(item);
  row.append(directionIcon(direction === ABOVE ? 'trend-up' : 'trend-down'), copy);
  hoverTooltip(row, [...factorLines(evidence, context), factor.why]);
  item.removeAttribute('title');
  return row;
}

function renderLlm(block, answer, context) {
  const evidence = conclusionFactors(context);
  const list = element('div', 'summary-list');
  if (answer.antidriver) list.append(llmRow({ caption: 'Ключевой антидрайвер', direction: BELOW, tone: 'negative', factor: answer.antidriver,
    evidence: evidence.negative.find(factor => factor.name === answer.antidriver.name), context }));
  if (answer.driver) list.append(llmRow({ caption: 'Ключевой драйвер', direction: ABOVE, tone: 'positive', factor: answer.driver,
    evidence: evidence.positive.find(factor => factor.name === answer.driver.name), context }));
  block.setHead({ ai: true });
  block.setContent(list);
}

/* Скелет — две строки той же композиции: загрузка не меняет высоту карточки */
function skeleton() {
  const list = element('div', 'summary-list summary-list--skeleton');
  list.setAttribute('aria-hidden', 'true');
  for (const direction of [BELOW, ABOVE]) {
    const row = element('div', 'summary-row hover-row');
    const copy = element('div', 'summary-row__text');
    copy.append(element('div', 'state__skeleton'));
    row.append(directionIcon(direction === ABOVE ? 'trend-up' : 'trend-down'), copy);
    list.append(row);
  }
  return list;
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
  block.setState(LOADING, skeleton());
}

export function renderConclusion(block, context) {
  closeHoverTooltip();
  block.setHead();
  block.element?.querySelector('.card__body')?.classList.add('scroll-area');
  if (context.slice.length === 0) {
    cancelRequest(block);
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
