/*
  Связь страницы с десктопным приложением (docs/desktop-app.md). Только сервер
  приложения отвечает на `api/app`; на Pages и в `start.sh` запроса нет вовсе
  (не локальный хост) или он не находит адреса — контролы приложения не появляются.
*/

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

let app = null;

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(hostname);
}

/* Ответ 422 — отказ с подсказками для окна; остальные ошибки — нет связи с приложением */
export async function request(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (response.status === 422 && Array.isArray(body.errors)) return { failed: true, errors: body.errors };
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return body;
}

export function postJson(url, body = {}) {
  return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** Состояние приложения — версия, обновление, Confluence, обратная связь; null вне приложения. Один запрос на страницу. */
export function appState() {
  if (!isLocalHost(globalThis.location?.hostname)) return Promise.resolve(null);
  app ??= request('api/app').then((body) => (typeof body?.version === 'string' ? body : null)).catch(() => null);
  return app;
}

/*
  J-?: режим разработчика (docs/desktop-app.md#режим-разработчика). В приложении — файл `developer` в каталоге данных
  (сервер отвечает `developer: true`); локальный сайт `start.sh` — явный ответ `api/developer` (tools/local_server.py);
  Pages и любой другой хост — никогда. Включается только явным «да»: ошибка, чужой ответ или ответ дольше
  DEVELOPER_WAIT_MS — обычный режим, продакт лишнего не увидит. `?dev=0` на локальном хосте — обычный режим до
  перезагрузки, для проверки вида продакта
*/
export const DEVELOPER_WAIT_MS = 3000;

export async function developerAllowed(location = globalThis.location, waitMs = DEVELOPER_WAIT_MS) {
  if (!isLocalHost(location?.hostname)) return false;
  if (new URLSearchParams(location?.search ?? '').get('dev') === '0') return false;
  const answer = (async () => {
    const app = await appState();
    if (app) return app.developer === true;
    const local = await request('api/developer').catch(() => null);
    return local?.developer === true;
  })().catch(() => false);
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), waitMs); });
  try {
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}
