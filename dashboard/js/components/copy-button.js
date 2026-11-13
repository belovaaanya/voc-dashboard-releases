/*
  Кнопка копирования (J-44): ссылка на срез в шапке, отзыв с контекстом в детализации.
  Итог копирования виден на кнопке и читается screen reader через live-region;
  через пару секунд кнопка возвращается к исходной подписи
*/

import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export const COPY_DONE = 'Скопировано';
export const COPY_FAILED = 'Не удалось скопировать';
const RESET_MS = 2000;

/*
  Clipboard API доступен не везде (старый браузер, http без TLS, запрет политики) — тогда
  копирование выделением скрытого поля; не вышло и так — кнопка скажет об ошибке
*/
function selectionCopy(text) {
  /* Выделение уводит фокус в поле: возвращаем его кнопке и не даём странице прыгнуть к полю */
  const focused = document.activeElement;
  const { scrollX, scrollY } = window;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.className = 'visually-hidden';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  focused?.focus?.({ preventScroll: true });
  window.scrollTo(scrollX, scrollY);
  if (!copied) throw new Error('copy rejected');
}

async function clipboardCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    selectionCopy(text);
  }
}

/**
 * `text()` вызывается в момент клика: копируется состояние на этот момент.
 * С `iconName` подпись живёт в `aria-label` и подсказке, без него — текстом кнопки.
 */
export function copyButton({ label, text, className, iconName = null, done = COPY_DONE, copy = clipboardCopy }) {
  const wrap = element('span', 'copy-button');
  const button = element('button', className);
  button.type = 'button';
  const status = element('span', 'visually-hidden');
  status.setAttribute('role', 'status');
  const name = (value) => {
    if (iconName) {
      button.title = value;
      button.setAttribute('aria-label', value);
    } else button.textContent = value;
  };
  if (iconName) button.append(icon(iconName, 'copy-button__icon'));
  name(label);

  let timer = null;
  const show = (value) => {
    name(value);
    status.textContent = value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      name(label);
      status.textContent = '';
    }, RESET_MS);
    /* В Node (тесты) таймер не держит процесс; в браузере `unref` нет */
    timer?.unref?.();
  };
  button.addEventListener('click', async () => {
    try {
      await copy(text());
      show(done);
    } catch {
      show(COPY_FAILED);
    }
  });
  wrap.append(button, status);
  return wrap;
}
