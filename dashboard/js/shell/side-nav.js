/*
  J-115: боковое меню — разделы дашборда, данные выгрузки и методика. Сворачивается до иконок:
  подписи уходят в подсказку и доступное имя, данные выгрузки — в подсказку иконки. Свёрнутость —
  удобство зрителя в localStorage. J-124: по умолчанию меню свёрнуто, запоминается только развёрнутое;
  без хранилища — свёрнуто. Ранний скрипт в index.html ставит атрибут до первой отрисовки, чтобы страница не прыгала.

  Пункт раздела один — «VOC клиентский»: других страниц пока нет, пустые пункты не показываются.
*/

import { bindShortWords, formatBuildTime, formatCount, formatDateRange } from '../core/format.js';
import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { SOURCE_FIXTURE } from '../io/loader.js';
import { methodologyItems } from '../core/methodology.js';
import { bindPopover } from '../ui/popover.js';

export const NAV_KEY = 'voc.nav';
const COLLAPSED = 'collapsed';
const EXPANDED = 'expanded';
/*
  J-151: страницы — пункты меню. Главная — «VOC ЦК» со значком «1.0» вместо иконки; «VOC ролей» — пока заглушка,
  «VOC-дайджест» — месячный дайджест канала, «Обратная связь» — таблица прямой речи. Страница живёт в URL (`page`)
*/
export const SECTIONS = [
  { id: 'voc', label: 'VOC ЦК', version: '1.0' },
  { id: 'roles', label: 'VOC ролей', icon: 'users' },
  { id: 'digest', label: 'VOC-дайджест', icon: 'digest' },
  { id: 'feedback', label: 'Обратная связь', icon: 'chat' },
];

const root = () => globalThis.document?.documentElement ?? null;

export function isNavCollapsed() {
  return root()?.dataset?.nav === COLLAPSED;
}

export function setNavCollapsed(collapsed) {
  const html = root();
  if (html?.dataset) {
    if (collapsed) html.dataset.nav = COLLAPSED;
    else delete html.dataset.nav;
  }
  try {
    if (collapsed) globalThis.localStorage?.removeItem(NAV_KEY);
    else globalThis.localStorage?.setItem(NAV_KEY, EXPANDED);
  } catch {
    /* Хранилище недоступно — состояние живёт до перезагрузки */
  }
}

/* Подпись пункта — текстом в развёрнутом меню, в свёрнутом — подсказкой; screen reader читает текст всегда */
function navLabel(text) {
  return element('span', 'side-nav__label', text);
}

function toggleButton(nav) {
  const button = element('button', 'side-nav__toggle');
  button.type = 'button';
  button.dataset.action = 'nav-toggle';
  button.setAttribute('aria-controls', 'side-nav');
  const describe = () => {
    const collapsed = isNavCollapsed();
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? 'Развернуть меню' : 'Свернуть меню');
    button.title = button.getAttribute('aria-label');
  };
  button.append(icon('panel-left', 'side-nav__icon'));
  button.addEventListener('click', () => {
    setNavCollapsed(!isNavCollapsed());
    describe();
    syncTitles(nav);
  });
  describe();
  return button;
}

/* В свёрнутом меню подписи скрыты визуально — название пункта остаётся подсказкой */
function syncTitles(nav) {
  for (const node of nav.querySelectorAll('[data-nav-title]')) {
    if (isNavCollapsed()) node.title = node.dataset.navTitle;
    else node.removeAttribute('title');
  }
}

function sourceLine(source, dataError) {
  if (source !== SOURCE_FIXTURE) return element('span', 'source-note', 'Данные выгрузки');
  /* Явная пометка: молчаливый fallback маскирует сломанный pipeline */
  const note = element('span', 'source-note source-note--demo');
  note.append(element('span', 'source-note__mark', 'Демо-данные'));
  note.append(element('span', null, dataError ? 'выгрузка недоступна, показана фикстура' : 'показана фикстура'));
  return note;
}

/* Дата актуальности — из манифеста (D-35); в свёрнутом меню — подсказкой иконки */
function dataPanel({ manifest, source, dataError, rowsInSlice }) {
  const lines = [
    `Данные актуальны на ${formatBuildTime(manifest.generated_at)}`,
    `Выгрузка: ${formatDateRange(manifest.period?.from, manifest.period?.to)}`,
    `Оценок в срезе: ${formatCount(rowsInSlice)}`,
  ];
  const panel = element('section', 'side-nav__data');
  panel.setAttribute('aria-label', 'Данные выгрузки');
  panel.dataset.navTitle = lines.join('\n');
  const mark = icon('database', 'side-nav__icon side-nav__data-icon');
  const body = element('div', 'side-nav__data-body');
  body.append(sourceLine(source, dataError), ...lines.map((line) => element('span', null, line)));
  panel.append(mark, body);
  return panel;
}

/* J-43: «Как считается» — методика в popover; с J-115 вход в неё — пункт внизу меню */
function methodControl() {
  const item = element('div', 'side-nav__method');
  const trigger = element('button', 'side-nav__link');
  trigger.type = 'button';
  trigger.dataset.action = 'methodology';
  trigger.dataset.navTitle = 'Как считаются данные';
  trigger.append(icon('book', 'side-nav__icon'), navLabel('Как считаются данные'));
  const panel = element('div', 'control-popover glass method-popover');
  panel.id = 'method-popover';
  panel.setAttribute('aria-label', 'Как считается');
  panel.append(element('h2', 'control-popover__title', 'Как считается'));
  const list = element('dl', 'method-popover__list');
  for (const [term, text] of methodologyItems()) {
    list.append(element('dt', 'method-popover__term', term), element('dd', 'method-popover__text', bindShortWords(text)));
  }
  panel.append(list);
  item.append(trigger, panel);
  bindPopover(item, trigger, panel);
  return item;
}

/* Ссылка на страницу несёт текущий срез: в новой вкладке открывается тот же канал, период и фильтры */
export function pageHref(search, page) {
  const params = new URLSearchParams(search);
  if (page === SECTIONS[0].id) params.delete('page');
  else params.set('page', page);
  const query = params.toString();
  return query ? `?${query}` : '?';
}

export function renderSideNav(host, context) {
  if (!host) return;
  const focusedAction = host.contains(document.activeElement) ? document.activeElement.dataset?.action : null;
  const brand = element('div', 'side-nav__brand');
  const logo = element('span', 'side-nav__logo');
  logo.append(element('strong', null, 'VOC'), element('span', 'side-nav__label', ' Dashboard'));
  brand.append(logo, toggleButton(host));

  const list = element('ul', 'side-nav__list');
  const page = context?.page ?? SECTIONS[0].id;
  for (const section of SECTIONS) {
    const item = element('li');
    const link = element('a', 'side-nav__link');
    /* Настоящая ссылка: открывается в новой вкладке; обычный клик переключает страницу без перезагрузки */
    link.href = pageHref(globalThis.location?.search ?? '', section.id);
    link.dataset.navTitle = section.label;
    link.dataset.page = section.id;
    link.dataset.action = `page-${section.id}`;
    if (section.id === page) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', (event) => {
      /* Без обработчика (меню до загрузки данных) ссылка переходит сама */
      if (!context?.onNavigate || event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
      event.preventDefault();
      if (section.id !== page) context.onNavigate(section.id);
    });
    const mark = section.version ? element('span', 'side-nav__icon side-nav__version', section.version) : icon(section.icon, 'side-nav__icon');
    if (section.version) mark.setAttribute('aria-hidden', 'true');
    link.append(mark, navLabel(section.label));
    item.append(link);
    list.append(item);
  }

  const foot = element('div', 'side-nav__foot');
  if (context) foot.append(dataPanel(context), methodControl());
  host.replaceChildren(brand, list, foot);
  syncTitles(host);
  if (focusedAction) host.querySelector(`[data-action="${focusedAction}"]`)?.focus();
}
