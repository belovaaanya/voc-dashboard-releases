/* Служебная строка над шапкой: текст и одна кнопка действия (новая версия приложения, обновление данных) */

import { element } from '../ui/dom.js';

export function noticeBar({ action, label = '' }) {
  const item = element('div', 'notice-bar');
  item.hidden = true;
  item.setAttribute('role', 'status');
  const text = element('span', 'notice-bar__text');
  const button = element('button', 'notice-bar__action', label);
  button.type = 'button';
  button.dataset.action = action;
  item.append(text, button);
  return { item, text, button };
}
