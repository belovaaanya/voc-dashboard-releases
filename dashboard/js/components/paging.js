/* Порции списка «Показать ещё» / «Скрыть» — правило фокуса в blocks-antidrivers, «Частотность» */

import { element } from '../ui/dom.js';

function pagingButton(className, text, { ariaLabel, controls, section }, onClick) {
  /* Общий класс — одна высота «Показать ещё» / «Скрыть» во всех блоках (токен высоты контрола) */
  const button = element('button', `paging-button ${className}`, text);
  button.type = 'button';
  if (section !== null) button.dataset.section = section;
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  if (controls) button.setAttribute('aria-controls', controls);
  button.addEventListener('click', onClick);
  return button;
}

/* `onMore` / `onCollapse` перерисовывают и возвращают узел для фокуса; клик указателем не прокручивает к нему */
export function pagingButtons({
  shown, total, page, collapsible = true, moreClass, collapseClass, moreLabel = '', collapseLabel = '', controls = '', section = null,
  onMore, onCollapse = () => null,
}) {
  const buttons = [];
  if (shown < total) {
    buttons.push(pagingButton(moreClass, 'Показать ещё', { ariaLabel: moreLabel, controls, section }, (event) => {
      onMore()?.focus({ preventScroll: event.detail !== 0 });
    }));
  }
  if (collapsible && shown > page) {
    buttons.push(pagingButton(collapseClass, 'Скрыть', { ariaLabel: collapseLabel, controls, section }, () => onCollapse()?.focus()));
  }
  return buttons;
}
