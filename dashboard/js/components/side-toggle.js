/*
  J-148: кнопка боковой колонки на линии раздела — одна для ленты отзывов «Топ проблем» и календаря событий.
  Развёрнутая колонка — круглая кнопка со стрелкой вправо на линии; свёрнутая — кнопка с подписью колонки и стрелкой
  влево у правого края. Контейнер задаёт место линии свойством `--side-toggle-at` и класс свёрнутого вида.
*/
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export function sideToggle({ label, controls, isHidden, onToggle }) {
  const button = element('button', 'side-toggle');
  button.type = 'button';
  button.setAttribute('aria-controls', controls);
  const paint = () => {
    const hidden = isHidden();
    button.classList.toggle('side-toggle--collapsed', hidden);
    button.replaceChildren(icon('chevron-down', 'side-toggle__icon'), ...(hidden ? [element('span', 'side-toggle__label', label)] : []));
    button.setAttribute('aria-expanded', String(!hidden));
    button.setAttribute('aria-label', hidden ? `Показать: ${label.toLowerCase()}` : `Скрыть: ${label.toLowerCase()}`);
    button.title = hidden ? `Показать: ${label.toLowerCase()}` : `Скрыть: ${label.toLowerCase()} — остальное во всю ширину`;
  };
  button.addEventListener('click', () => {
    onToggle();
    paint();
  });
  paint();
  return button;
}
