/* Сегментный переключатель (C-03): одна сборка на все табы дашборда — каналы, масштаб, виды, сортировки */

import { element, withFullLabel } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { revealAround, slideSelection } from '../ui/motion.js';

const STEPS = { ArrowRight: 1, ArrowLeft: -1 };

function selectedTab(host, label) {
  const group = [...host.querySelectorAll('.segmented[role="tablist"]')].find((node) => node.getAttribute('aria-label') === label);
  return group?.querySelector('[aria-selected="true"]');
}

/* Перерисованный блок уносит нажатый таб из DOM: фокус получает выбранный таб того же переключателя в той же карточке */
function restoreFocus(host, label, tab) {
  if (tab.isConnected || !host?.isConnected) return;
  selectedTab(host, label)?.focus();
}

export function targetIndex(event, index, count) {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === 'Home') return 0;
  if (event.key === 'End') return count - 1;
  return STEPS[event.key] ? (index + STEPS[event.key] + count) % count : null;
}

/* Табы по образцу ARIA APG: в порядке Tab один выбранный таб, стрелки влево и вправо, Home и End сразу выбирают таб */
export function segmented({ label, options, selected, onSelect, size = 'sm' }) {
  const group = element('div', size === 'lg' ? 'segmented segmented--lg' : 'segmented');
  group.setAttribute('role', 'tablist');
  group.setAttribute('aria-label', label);
  const focusable = options.some(({ value }) => value === selected) ? selected : options[0]?.value;
  const tabs = [];
  /* Повторный выбор того же таба не пишет в историю браузера и не перерисовывает дашборд */
  const select = (index, origin) => {
    if (options[index].value === selected) {
      tabs[index].focus();
      return;
    }
    const host = group.closest('.card, #header');
    const from = group.querySelector('[aria-selected="true"]')?.getBoundingClientRect?.();
    onSelect(options[index].value);
    restoreFocus(host, label, origin);
    if (!host?.isConnected) return;
    /* Рамка выбора переезжает к новому табу; своё содержимое карточки проявляется, а перестройку дашборда проявляет main.js (D-56) */
    const next = selectedTab(host, label);
    slideSelection(from, next);
    const body = host.classList.contains('card') ? host.querySelector(':scope > .card__body') : null;
    if (body) revealAround(body, next?.closest('.segmented'));
  };

  options.forEach((option, index) => {
    /*
      J-135: значки смысла после подписи (треугольники урона и влияния) — в одной строке с ней; таб — колонка ради
      ширины под жирное начертание, поэтому подпись и значки в своей строке. Имя таба — по-прежнему подпись
    */
    const content = option.icons?.length ? element('span', 'segmented__row', option.label) : option.label;
    if (option.icons?.length) {
      const marks = element('span', 'segmented__icons');
      marks.setAttribute('aria-hidden', 'true');
      for (const { name, tone } of option.icons) marks.append(icon(name, `segmented__icon${tone ? ` segmented__icon--${tone}` : ''}`));
      content.append(marks);
    }
    const button = typeof content === 'string' ? element('button', 'segmented__tab', content) : element('button', 'segmented__tab');
    if (typeof content !== 'string') button.append(content);
    const tab = withFullLabel(button, option.title);
    tab.type = 'button';
    tab.dataset.label = option.label;
    tab.tabIndex = option.value === focusable ? 0 : -1;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(option.value === selected));
    tab.addEventListener('click', () => select(index, tab));
    tab.addEventListener('keydown', (event) => {
      const target = targetIndex(event, index, options.length);
      if (target === null) return;
      event.preventDefault();
      select(target, tab);
    });
    tabs.push(tab);
    group.append(tab);
  });
  return group;
}
