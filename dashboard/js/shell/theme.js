/*
  J-69: тема страницы — тёмная по умолчанию или светлая. Тема — атрибут `data-theme`
  на <html>: стили берут цвета из того же набора токенов, светлый режим лишь меняет их
  значения (tokens.css). Выбор зрителя хранится в localStorage как удобство: без
  хранилища тема тёмная. Ранний скрипт в index.html ставит атрибут до первой отрисовки,
  чтобы светлая тема не мигала тёмной.
*/

import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export const THEME_KEY = 'voc.theme';
export const LIGHT = 'light';
export const DARK = 'dark';

const root = () => globalThis.document?.documentElement ?? null;

export function currentTheme() {
  return root()?.dataset?.theme === LIGHT ? LIGHT : DARK;
}

export function applyTheme(theme) {
  const html = root();
  if (html?.dataset) {
    if (theme === LIGHT) html.dataset.theme = LIGHT;
    else delete html.dataset.theme;
  }
  try {
    if (theme === LIGHT) globalThis.localStorage?.setItem(THEME_KEY, LIGHT);
    else globalThis.localStorage?.removeItem(THEME_KEY);
  } catch {
    /* Хранилище недоступно — тема живёт до перезагрузки */
  }
}

const OPTIONS = [
  { theme: LIGHT, name: 'sun', label: 'Светлая тема' },
  { theme: DARK, name: 'moon', label: 'Тёмная тема' },
];

/* Два варианта рядом: выбранный — на подложке, оба видны сразу, нажатое состояние у каждого своё */
export function themeToggle() {
  const group = element('div', 'theme-toggle');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Тема');
  const buttons = OPTIONS.map(({ theme, name, label }) => {
    const button = element('button', 'theme-toggle__option');
    button.type = 'button';
    button.dataset.action = 'theme';
    button.dataset.theme = theme;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(icon(name, 'theme-toggle__icon'));
    return button;
  });
  const sync = () => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.theme === currentTheme()));
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      applyTheme(button.dataset.theme);
      sync();
    });
  }
  sync();
  group.append(...buttons);
  return group;
}
