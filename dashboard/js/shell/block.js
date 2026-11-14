/*
  Карточка блока и её три служебных состояния: загрузка, нет данных за период,
  ошибка загрузки (D-34).

  Состояния различаются текстом, а не только цветом, поэтому читаются
  в grayscale (D-26).
*/

import { element, withFullLabel } from '../ui/dom.js';
import { bindShortWords, formatDateRange } from '../core/format.js';
import { icon, withStars } from '../ui/icons.js';
import { periodPicker } from '../components/period-picker.js';
import { stateText } from '../components/status-panel.js';

export const LOADING = 'loading';
export const EMPTY = 'empty';
export const NO_DATA = 'no-data';
export const ERROR = 'error';
export const READY = 'ready';

const TEXTS = {
  [LOADING]: { title: 'Загружаем данные…', detail: '' },
  [EMPTY]: {
    title: 'Нет данных за выбранный период',
    /* J-39: узкой карточке метрики — одна короткая строка, пояснение в подсказке */
    compactTitle: 'Нет данных за период',
    detail: 'Измените период или снимите часть фильтров.',
  },
  /* Десктопное приложение, листов ещё нет: следующий шаг один на всю страницу — в шапке, а не в каждой карточке */
  [NO_DATA]: { title: 'Данные не загружены', compactTitle: 'Нет данных', detail: '' },
  [ERROR]: {
    title: 'Данные не загрузились',
    detail: '',
  },
};

function renderState(state, detail, compact = false) {
  const wrap = element('div', `state state--${state}`);
  wrap.setAttribute('role', 'status');

  /* Скелет своей композиции блок отдаёт в detail: загрузка тогда не меняет высоту карточки и не сдвигает колонку */
  if (state === LOADING) {
    wrap.classList.toggle('state--shaped', Boolean(detail));
    wrap.append(...(detail ? [detail] : [element('div', 'state__skeleton'), element('div', 'state__skeleton')]));
    wrap.append(element('span', 'visually-hidden', TEXTS[LOADING].title));
    return wrap;
  }

  /* Свой текст пустого блока целиком — `{ title, detail }`: у дайджеста нет фильтров, совет «снимите фильтры» ему не подходит */
  const own = typeof detail?.title === 'string' ? detail : null;
  const texts = own ? { ...TEXTS[state], ...own, compactTitle: own.title } : TEXTS[state];
  if (own) detail = own.detail ?? '';
  const detailText = own ? detail : detail || texts.detail;
  /* J-39: компактное состояние — одна строка; пояснение мышью в подсказке, screen reader — скрытым текстом */
  /*
    Своя причина пустого блока («Сегмента нет в выгрузке») — сама строка: общий текст «нет данных за период»
    её бы исказил. Ошибка оставляет свой заголовок, а техническую причину уносит в подсказку
  */
  if (compact) {
    const ownLine = !own && state === EMPTY && detail;
    const hint = ownLine ? '' : detailText;
    wrap.classList.add('state--compact');
    wrap.append(stateText('title', ownLine || texts.compactTitle || texts.title));
    if (hint) {
      wrap.setAttribute('title', hint);
      wrap.append(element('span', 'visually-hidden', ` ${hint}`));
    }
    return wrap;
  }
  wrap.append(stateText('title', texts.title));
  if (detailText) wrap.append(stateText('detail', detailText));
  return wrap;
}

/* Генерированное содержимое помечается, посчитанное — нет (D-33) */
const AI_LABEL = 'Сделано с AI';

const listOf = (value) => (value === null || value === undefined ? [] : [value].flat());

/* Подсказка периода видна мышью в title, а screen reader читает её скрытым текстом */
function periodNode({ from, to, title }) {
  const node = element('span', 'card__period');
  node.append(icon('calendar', 'card__icon'), element('span', 'visually-hidden', 'Период: '), element('span', null, formatDateRange(from, to)));
  if (title) {
    node.title = title;
    node.append(element('span', 'visually-hidden', `. ${title}`));
  }
  return node;
}

/* Период блока со своим выбором (local period): тот же контрол, что в шапке дашборда */
function periodPickerNode(id, scope, { from, to, preset, title, picker }, registerPreview) {
  const node = periodPicker({
    id: `${id}-period-popover`,
    period: { from, to, preset },
    manifestPeriod: picker.manifestPeriod,
    onChange: picker.onChange,
    onReset: picker.onReset,
    scope,
    itemClass: 'card__period-picker',
    triggerClass: picker.local ? 'card__period card__period--control card__period--local' : 'card__period card__period--control',
    iconClass: 'card__icon',
    align: 'end',
    onPreviewReady: registerPreview,
  });
  const trigger = node.querySelector('button');
  /* Выбранный период перерисовывает шапку: setHead вернёт фокус на кнопку по data-action */
  trigger.dataset.action = 'period';
  if (title) {
    trigger.title = title;
    trigger.setAttribute('aria-label', `${trigger.getAttribute('aria-label')}. ${title}`);
  }
  return node;
}

function actionNode({ id, label, icon: name, onClick }) {
  const button = element('button', 'card__action');
  button.type = 'button';
  button.dataset.action = id;
  button.setAttribute('aria-label', label);
  button.append(icon(name, 'card__icon'));
  button.addEventListener('click', onClick);
  return button;
}

function aiNode() {
  const node = element('span', 'card__ai');
  const badge = element('span', 'card__ai-badge');
  badge.append(icon('sparkle', 'card__icon'));
  node.append(element('span', null, AI_LABEL), badge);
  return node;
}

/* Развёрнутая карточка — модальный слой (D-32): остальное на странице инертно; возвращает отмену */
function makePageInert(card) {
  const siblings = [];
  for (let node = card; node.parentElement && node !== document.body; node = node.parentElement) {
    siblings.push(...[...node.parentElement.children].filter((sibling) => sibling !== node && !sibling.inert));
  }
  for (const sibling of siblings) sibling.inert = true;
  document.documentElement.classList.add('has-expanded-card');
  return () => {
    for (const sibling of siblings) sibling.inert = false;
    document.documentElement.classList.remove('has-expanded-card');
  };
}

/** `level` — уровень заголовка: блок внутри карточки-группы — `h3` под её `h2` (J-40, J-41). */
export function createBlock({ id, title, modifier, compact = false, level = 2 }) {
  const card = element('section', modifier ? `card ${modifier}` : 'card');
  let collapseOnEscape = null;
  let restorePage = null;
  let updatePeriodPreview = null;

  /* Свернуть можно и Escape: onCollapse перерисовывает блок, чтобы кнопка в шапке сменилась */
  function setExpanded(expanded, onCollapse) {
    if (collapseOnEscape) document.removeEventListener('keydown', collapseOnEscape);
    collapseOnEscape = expanded ? (event) => event.key === 'Escape' && onCollapse() : null;
    if (collapseOnEscape) document.addEventListener('keydown', collapseOnEscape);
    card.classList.toggle('is-expanded', expanded);
    restorePage?.();
    restorePage = expanded ? makePageInert(card) : null;
  }

  const head = element('div', 'card__head');
  const heading = element(`h${level}`, 'card__title');
  heading.append(...withStars(bindShortWords(title)));
  const tools = element('div', 'card__tools');
  const marker = element('span', 'card__marker');
  /* J-143: слот пояснения — сразу за текстом заголовка (значок «i» с окном); пустой не занимает места */
  const help = element('span', 'card__help');
  heading.append(help);
  head.append(marker, heading, tools);

  const body = element('div', 'card__body');
  card.append(head, body);

  return {
    element: card,
    /* `hidden` — заголовок остаётся для screen reader, но не виден: когда его уже назвал заголовок группы над блоком */
    setTitle(text, full, { hidden = false } = {}) {
      heading.replaceChildren(...withStars(text), help);
      withFullLabel(heading, full);
      heading.classList.toggle('visually-hidden', hidden);
    },
    previewPeriod(next) { updatePeriodPreview?.(next); },
    isExpanded: () => card.classList.contains('is-expanded'),
    setExpanded,
    /* Вызов без аргументов гасит прошлую шапку; порядок слотов — как в шапке макета (Figma 3204:2866) */
    setHead({ marker: lead, help: explain, note, period, controls, actions, ai } = {}) {
      updatePeriodPreview = null;
      const active = document.activeElement;
      /* Кнопки панели периода своего action не имеют: после выбора фокус возвращается на её триггер */
      const focusedAction = tools.contains(active) ? (active.closest?.('.card__period-picker') ? 'period' : active.dataset.action) : undefined;
      marker.replaceChildren(...listOf(lead));
      help.replaceChildren(...listOf(explain));
      tools.replaceChildren(
        ...listOf(note).map((content) => (content instanceof Node ? content : element('span', 'card__note', content))),
        ...(period ? [period.picker ? periodPickerNode(id, title, period, (preview) => { updatePeriodPreview = preview; }) : periodNode(period)] : []),
        ...listOf(controls),
        ...listOf(actions).map(actionNode),
        ...(ai ? [aiNode()] : []),
      );
      if (focusedAction) tools.querySelector(`[data-action="${focusedAction}"]`)?.focus();
    },
    /* Служебное состояние без кнопки «Свернуть» не оставляет карточку развёрнутой */
    setState(state, detail) {
      if (card.classList.contains('is-expanded')) setExpanded(false);
      body.replaceChildren(
        state === READY ? element('p', 'placeholder', detail) : renderState(state, detail, compact),
      );
    },
    setContent(node) {
      body.replaceChildren(node);
    },
  };
}
