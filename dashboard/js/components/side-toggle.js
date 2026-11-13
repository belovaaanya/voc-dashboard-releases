/*
  Кнопка боковой колонки — одна для ленты отзывов «Топ проблем» и календаря событий (J-148).
  Круг со стрелкой стоит в правом верхнем углу контейнера в обоих видах; свёрнутая колонка — полоса у правого края
  с подписью под кругом. Контейнер — position: relative; свёрнутый вид кнопка ставит ему сама
*/
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export function sideToggle({ label, controls, isHidden, onToggle, host = null, panel = null, hostClass = null, around = (change) => change() }) {
  const button = element('button', 'side-toggle');
  button.type = 'button';
  button.setAttribute('aria-controls', controls);
  const knob = element('span', 'side-toggle__knob');
  knob.append(icon('chevron-down', 'side-toggle__icon'));
  button.append(knob);
  const caption = element('span', 'side-toggle__label', label);
  /* Круг не пересоздаётся: стрелка поворачивается, а не подменяется; подпись — только у свёрнутой колонки */
  const paint = () => {
    const hidden = isHidden();
    const name = label.toLowerCase();
    if (hidden) button.append(caption);
    else caption.remove();
    button.classList.toggle('side-toggle--collapsed', hidden);
    button.setAttribute('aria-expanded', String(!hidden));
    button.setAttribute('aria-label', hidden ? `Показать: ${name}` : `Скрыть: ${name}`);
    button.title = hidden ? `Показать: ${name}` : `Скрыть: ${name} — остальное во всю ширину`;
  };
  const sync = () => {
    const hidden = isHidden();
    host?.classList.toggle('side-toggle-host--collapsed', hidden);
    if (hostClass) host?.classList.toggle(hostClass, hidden);
    if (panel) panel.hidden = hidden;
    paint();
  };
  button.addEventListener('click', () => around(() => {
    onToggle();
    sync();
  }));
  sync();
  return button;
}
