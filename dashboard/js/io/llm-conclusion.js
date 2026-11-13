/**
 * «Главный вывод» от LLM (`R-46`): запрос к локальному `/api/conclusion` из `start.sh`.
 * Что уходит в модель, собирает `core/conclusion-payload.js`; нет сервера (GitHub Pages)
 * или настроек шлюза — блок остаётся расчётным.
 */

import { conclusionKey, conclusionPayload, isConclusion } from '../core/conclusion-payload.js';
import { insightsOf } from '../state/event-analysis.js';

/* Относительный путь: на Pages сайт живёт в подпапке, и проба там честно получает 404 */
export const LLM_ENDPOINT = 'api/conclusion';
/* Дольше общего бюджета сервера `TOTAL_BUDGET_SECONDS` в `tools/llm_gateway.py`: его ответ успевает прийти */
export const LLM_TIMEOUT_MS = 160_000;

/** Payload среза экрана: агрегаты ядра и события календаря того же контекста. */
export function buildConclusionPayload(context) {
  return conclusionPayload(context, insightsOf(context));
}

/** Один POST на payload с собственным controller: таймаут или отмена последнего ждущего его обрывают. */
function startFlight({ fetchImpl, available, key, payload, timeoutMs, answers, pending }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const flight = { controller, waiting: 0 };
  flight.promise = (async () => {
    if (!(await available())) throw new Error('llm-unavailable');
    const response = await fetchImpl(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: key,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`llm-${response.status}`);
    const answer = await response.json();
    if (!isConclusion(answer, payload)) throw new Error('llm-schema');
    answers.set(key, answer);
    return answer;
  })().finally(() => {
    clearTimeout(timer);
    if (pending.get(key) === flight) pending.delete(key);
  });
  flight.promise.catch(() => {});
  return flight;
}

/** Вызывающий ждёт общий запрос, но отменяет только своё ожидание; запрос живёт, пока ждёт хоть один. */
function awaitFlight(flight, signal, release) {
  flight.waiting += 1;
  if (!signal) return flight.promise;
  return new Promise((resolve, reject) => {
    const leave = () => {
      signal.removeEventListener('abort', leave);
      reject(signal.reason);
      flight.waiting -= 1;
      if (flight.waiting === 0) release();
    };
    if (signal.aborted) return leave();
    signal.addEventListener('abort', leave, { once: true });
    flight.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', leave));
  });
}

/** Состояние модуля: одна проба доступности, ответы и запросы в полёте по ключу payload на время вкладки. */
export function createLlmClient(fetchImpl = (...args) => globalThis.fetch(...args), { timeoutMs = LLM_TIMEOUT_MS } = {}) {
  let probe = null;
  let availability = null;
  const answers = new Map();
  const pending = new Map();

  function available() {
    probe ??= fetchImpl(LLM_ENDPOINT, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => body?.available === true)
      .catch(() => false)
      .then((value) => {
        availability = value;
        return value;
      });
    return probe;
  }

  return {
    /** `null` — проба ещё не ответила. */
    knownAvailability: () => availability,
    available,
    cached: (payload) => answers.get(conclusionKey(payload)) ?? null,
    /* Тот же payload в полёте не запрашивается повторно: каждый запрос платный. Ошибка не кэшируется */
    fetchConclusion(payload, { signal } = {}) {
      const key = conclusionKey(payload);
      if (answers.has(key)) return Promise.resolve(answers.get(key));
      if (!pending.has(key)) pending.set(key, startFlight({ fetchImpl, available, key, payload, timeoutMs, answers, pending }));
      const flight = pending.get(key);
      return awaitFlight(flight, signal, () => {
        if (pending.get(key) === flight) pending.delete(key);
        flight.controller.abort();
      });
    },
  };
}

export const llm = createLlmClient();
