/* Popover у своего контрола: роль dialog, Escape и клик вне закрывают, открыт всегда один на странице.
   Panel может лежать вне item — тогда Escape и клик внутри panel обрабатываются на нём самом */

let activePopoverClose = null;

export function bindPopover(item, trigger, panel) {
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', panel.id);
  panel.setAttribute('role', 'dialog');
  panel.hidden = true;

  const close = (returnFocus = false) => {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', closeOnOutside);
    if (activePopoverClose === close) activePopoverClose = null;
    if (returnFocus) trigger.focus();
  };

  const closeOnOutside = (event) => {
    if (!item.contains(event.target) && !panel.contains(event.target)) close();
  };

  const open = () => {
    if (activePopoverClose && activePopoverClose !== close) activePopoverClose();
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    activePopoverClose = close;
    document.addEventListener('pointerdown', closeOnOutside);
  };

  trigger.addEventListener('click', () => (panel.hidden ? open() : close()));
  const onKeydown = (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      /* Escape закрывает только popover: развёрнутая карточка слушает его на document */
      event.stopPropagation();
      close(true);
    }
  };
  item.addEventListener('keydown', onKeydown);
  /* Panel может жить вне item — там, где его не обрежет scroll-контейнер (таблица детализации) */
  if (!item.contains(panel)) panel.addEventListener('keydown', onKeydown);

  return close;
}
