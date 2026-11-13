/*
  «Доступна новая версия» в десктопном приложении (docs/desktop-app.md, «Обновления»).
  Приложение само смотрит последний релиз на GitHub; окно только показывает итог и
  по кнопке просит установить. Узел один на страницу, как у «Обновить данные».
*/

import { element } from '../ui/dom.js';
import { isLocalHost, postJson, request } from '../io/desktop.js';

const API_APP = 'api/app';
const API_INSTALL = 'api/app/update/install';
/* Проверка релиза идёт в приложении параллельно с открытием окна: ответ GitHub приходит позже страницы */
const POLL_MS = [5_000, 30_000, 120_000];
const POLL_LATER_MS = 30 * 60_000;

let control = null;

/* Подпись — версия, а не «обновление»: продакт видит, на что именно меняется приложение */
export function updateLabel(version) {
  return `Доступна версия ${version}`;
}

function buildControl() {
  const item = element('div', 'app-update');
  item.hidden = true;
  item.setAttribute('role', 'status');
  const text = element('span', 'app-update__text');
  const install = element('button', 'app-update__install', 'Обновить');
  install.type = 'button';
  install.dataset.action = 'app-update';
  item.append(text, install);

  install.addEventListener('click', async () => {
    install.disabled = true;
    text.textContent = 'Скачиваем обновление… Приложение перезапустится само.';
    try {
      const result = await postJson(API_INSTALL);
      if (result.failed) {
        const [error] = result.errors;
        text.textContent = error?.hint ?? 'Не удалось обновить приложение.';
        /* Новая версия уже установлена, не вышел только перезапуск: повторять установку незачем */
        install.hidden = error?.code === 'restart';
        install.disabled = false;
      }
    } catch {
      /* Приложение закрылось на перезапуск раньше ответа — это успех, а не ошибка */
    }
  });

  let attempt = 0;
  const poll = async () => {
    const state = await request(API_APP).catch(() => null);
    const available = state?.available;
    if (available && item.hidden) {
      text.textContent = updateLabel(available.version);
      if (available.notes) item.title = available.notes;
      item.hidden = false;
    }
    if (item.hidden) setTimeout(poll, POLL_MS[attempt++] ?? POLL_LATER_MS);
  };
  poll();
  return item;
}

/** Уведомление об обновлении для строки шапки или null вне приложения. */
export function appUpdateControl() {
  if (!isLocalHost(globalThis.location?.hostname)) return null;
  control ??= buildControl();
  return control;
}
