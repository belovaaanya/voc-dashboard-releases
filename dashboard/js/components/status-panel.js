/* Панель «здесь пусто и почему» внутри блока (D-34); раскладку задаёт класс блока */

import { bindShortWords } from '../core/format.js';
import { element } from '../ui/dom.js';

/* J-43: строка служебного состояния — без висячего предлога, как заголовок (typography §5) */
export function stateText(kind, text) {
  return element('p', `state__${kind}`, bindShortWords(text));
}

const LOOKS = { quiet: 'state--quiet', text: 'state--text' };

/** `look`: `quiet` — подпись третьего уровня в малом месте (портрет роли), `text` — строка текста в списке (вывод); оба без отступов абзаца. */
export function statusPanel(className, { title, detail = null, action = null, extra = [], look = null }) {
  if (look && !LOOKS[look]) throw new Error(`Нет вида состояния «${look}»`);
  const panel = element('div', [className, LOOKS[look]].filter(Boolean).join(' '));
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

/** Строка «ничего не нашлось» во всю ширину таблицы; отступ и выравнивание задаёт класс блока. */
export function emptyTableRow(columns, text, className) {
  const row = element('tr');
  const cell = element('td', className, text);
  cell.colSpan = columns;
  row.append(cell);
  return row;
}
