/*
  «Оставить обратную связь» внизу дашборда (docs/desktop-app.md, «Обратная связь»).
  Только в десктопном приложении с настроенным приёмником. К комментарию
  прикладывается контекст: срез из адреса, период данных, листы и последние
  действия. Действие — что нажато и в каком блоке, без текста элемента: в
  карточках и таблице есть комментарии клиентов, и в отзыв они уйти не должны.
*/

import { element } from '../ui/dom.js';
import { appState, isLocalHost, postJson, request } from '../io/desktop.js';

const API_FEEDBACK = 'api/feedback';
const MAX_ACTIONS = 30;

const actions = [];
let listening = false;

/* Адрес со случайным `%` не должен ронять окно отзыва */
function decoded(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function now() {
  return new Date().toISOString().slice(11, 19);
}

function remember(action, detail = '') {
  actions.push({ at: now(), action, detail });
  if (actions.length > MAX_ACTIONS) actions.shift();
}

/* Что нажато: `data-action` или измерение фильтра, а не подпись; блок — по заголовку карточки */
export function describeClick(target) {
  const control = target?.closest?.('button, a, input, [role="button"]');
  if (!control) return null;
  /* Табы переключателей — кнопки со своим `aria-selected`: их название — имя переключателя */
  const switcher = control.closest?.('[aria-label]')?.getAttribute?.('aria-label');
  const action = control.dataset?.action
    ?? (control.dataset?.dimension ? `filter:${control.dataset.dimension}` : null)
    ?? (control.hasAttribute?.('aria-selected') && switcher ? `switch:${switcher}` : control.tagName.toLowerCase());
  const card = control.closest?.('section.card');
  const block = card?.querySelector?.('.card__title')?.textContent?.trim() ?? (control.closest?.('header') ? 'Шапка' : '');
  return { action, detail: block };
}

/* Смена среза видна в адресе: канал, период и фильтры — подписи справочника, не данные клиентов */
function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('click', (event) => {
    const click = describeClick(event.target);
    if (click) remember(click.action, click.detail);
  }, true);
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method].bind(history);
    history[method] = (state, title, url) => {
      const result = original(state, title, url);
      if (url != null) remember('state', decoded(String(url)).slice(0, 300));
      return result;
    };
  }
  window.addEventListener('popstate', () => remember('back', decoded(location.search).slice(0, 300)));
}

export function feedbackContext(manifest, sheets) {
  return {
    url_state: decoded(location.search),
    data_period: manifest?.period ?? null,
    data_generated_at: manifest?.generated_at ?? null,
    sheets: sheets.map((sheet) => sheet.name),
    actions: [...actions],
    viewport: `${innerWidth}×${innerHeight}`,
    theme: document.documentElement.dataset.theme ?? 'dark',
  };
}

function preview(context) {
  const details = element('details', 'feedback__preview');
  details.append(element('summary', null, 'Что отправится вместе с комментарием'));
  const list = element('ul', 'feedback__preview-list');
  for (const line of [
    `Версия приложения и ОС`,
    `Срез: ${context.url_state || 'по умолчанию'}`,
    `Период данных: ${context.data_period ? `${context.data_period.from} — ${context.data_period.to}` : '—'}`,
    `Листы: ${context.sheets.join(', ') || 'демо-данные'}`,
    `Последние действия: ${context.actions.length} — какие кнопки и в каких блоках нажаты`,
  ]) list.append(element('li', null, line));
  details.append(list, element('p', 'feedback__preview-note', 'Цифры выгрузки и комментарии клиентов не отправляются.'));
  return details;
}

function feedbackDialog() {
  const dialog = element('div', 'feedback glass');
  dialog.id = 'feedback-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Обратная связь');
  dialog.hidden = true;
  const comment = element('textarea', 'feedback__comment');
  comment.rows = 5;
  comment.maxLength = 4000;
  comment.placeholder = 'Что улучшить или что работает не так?';
  comment.setAttribute('aria-label', 'Комментарий');
  const contact = element('input', 'data-import__input');
  contact.type = 'text';
  contact.autocomplete = 'email';
  const contactField = element('label', 'control-popover__field');
  contactField.append(element('span', 'control-popover__field-label', 'Как с вами связаться — необязательно'), contact);
  const status = element('p', 'feedback__status');
  status.setAttribute('role', 'status');
  const send = element('button', 'control-popover__apply', 'Отправить');
  send.type = 'button';
  const cancel = element('button', 'control-popover__reset', 'Отмена');
  cancel.type = 'button';
  const buttons = element('div', 'control-popover__actions');
  buttons.append(send, cancel);
  const previewSlot = element('div');
  dialog.append(element('h2', 'control-popover__title', 'Обратная связь'), comment, contactField, previewSlot, buttons, status);
  return { dialog, comment, contact, status, send, cancel, previewSlot };
}

/* Пустой комментарий не уходит; без сети отзыв ждёт в приложении */
async function sendFeedback({ comment, contact, status, send }, context) {
  if (!comment.value.trim()) {
    status.textContent = 'Напишите комментарий.';
    comment.focus();
    return;
  }
  send.disabled = true;
  status.textContent = 'Отправляем…';
  try {
    const result = await postJson(API_FEEDBACK, { comment: comment.value, contact: contact.value, context });
    status.textContent = result.sent
      ? 'Спасибо! Отзыв отправлен.'
      : 'Нет связи — отзыв сохранён в приложении и уйдёт, когда сеть появится.';
    comment.value = '';
  } catch {
    status.textContent = 'Не удалось отправить отзыв. Проверьте текст и повторите.';
  } finally {
    send.disabled = false;
  }
}

function buildFooter(manifest) {
  const footer = element('footer', 'page-footer');
  const open = element('button', 'data-import__trigger', 'Оставить обратную связь');
  open.type = 'button';
  open.dataset.action = 'feedback';
  const ui = feedbackDialog();
  const { dialog } = ui;

  let sheets = [];
  const close = () => {
    dialog.hidden = true;
    open.setAttribute('aria-expanded', 'false');
    open.focus();
  };
  open.setAttribute('aria-expanded', 'false');
  open.setAttribute('aria-controls', dialog.id);
  open.addEventListener('click', async () => {
    if (!dialog.hidden) {
      close();
      return;
    }
    sheets = (await request('api/data').catch(() => ({}))).sheets ?? [];
    ui.previewSlot.replaceChildren(preview(feedbackContext(manifest, sheets)));
    ui.status.textContent = '';
    dialog.hidden = false;
    open.setAttribute('aria-expanded', 'true');
    ui.comment.focus();
  });
  ui.cancel.addEventListener('click', close);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });
  ui.send.addEventListener('click', () => sendFeedback(ui, feedbackContext(manifest, sheets)));

  footer.append(open, dialog);
  return footer;
}

/** Подвал с обратной связью, если страница открыта в приложении с настроенным приёмником. */
export async function mountFeedback(page, manifest) {
  if (!isLocalHost(globalThis.location?.hostname)) return;
  listen();
  const state = await appState();
  if (!state?.feedback || page.querySelector('.page-footer')) return;
  page.append(buildFooter(manifest));
}
