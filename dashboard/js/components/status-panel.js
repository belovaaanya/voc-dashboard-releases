/* Панель «здесь пусто и почему» внутри блока (D-34); раскладку задаёт класс блока */

import { bindShortWords } from '../core/format.js';
import { element } from '../ui/dom.js';

/* J-43: строка служебного состояния — без висячего предлога, как заголовок (typography §5) */
export function stateText(kind, text) {
  return element('p', `state__${kind}`, bindShortWords(text));
}

export function statusPanel(className, { title, detail = null, action = null, extra = [] }) {
  const panel = element('div', className);
  panel.setAttribute('role', 'status');
  panel.append(stateText('title', title));
  if (detail) panel.append(stateText('detail', detail));
  if (action) {
    const button = element('button', action.className, action.text);
    button.type = 'button';
    button.addEventListener('click', action.onClick);
    panel.append(button);
  }
  panel.append(...extra);
  return panel;
}
