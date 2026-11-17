/* Блок «Эмоции» — docs/blocks-emotions.md */

import { EMPTY, ERROR, LOADING } from '../shell/block.js';
import { element } from '../ui/dom.js';
import { formatCount, plural, quoted } from '../core/format.js';
import { EMOTION_INTENSITIES, INTENSITY_HINTS, INTENSITY_LABELS, emotionFeed, emotionTable, emotionsNoteFor, inEmotionPick } from '../core/verbatim.js';
import { emptyValue } from '../components/empty-value.js';
import { pagingButtons } from '../components/paging.js';
import { feedEntry } from './verbatim-cards.js';

/*
  J-348: таблица эмоций слева и лента отзывов справа, раскладка — как у «Топ проблем». Строки — точные эмоции под
  заголовками групп тона, колонки — «Всего» и накал 0–3; числа простым текстом, без заливки (цветом на дашборде —
  только средний VOC и урон). Клик по строке — все отзывы эмоции (у заголовка — тона), по ячейке — эмоция × накал;
  повторный клик снимает выбор. По умолчанию — накалённые: «Негатив · накалённые» (выраженный и острый)
*/
export const EMOTIONS_NOTE = 'Точная эмоция размечена с меньшей уверенностью, чем тон и накал';
export const DEFAULT_PICK = { tone: 'negative', intensities: [2, 3] };
const FEED_PAGE = 20;
const FEED_ID = 'emotions-feed';
const comments = (count) => `${formatCount(count)} ${plural(count, ['комментарий', 'комментария', 'комментариев'])}`;

const viewStates = new WeakMap();
function viewState(block, context) {
  const key = JSON.stringify([context.state.channel, context.period, context.state.filters, context.state.includeCashback !== false]);
  let state = viewStates.get(block);
  if (state?.key !== key) {
    state = { key, pick: DEFAULT_PICK, feedShown: FEED_PAGE };
    viewStates.set(block, state);
  }
  return state;
}

const pickKey = (pick) => (pick ? JSON.stringify([pick.tone ?? null, pick.emotion ?? null, pick.intensities ?? null]) : '');

export function pickTitle(pick, labelOf) {
  const name = pick.emotion ?? labelOf(pick.tone);
  if (!pick.intensities) return name;
  /* Накал словами (INTENSITY_LABELS); «≥ Выраженный» — накалённые: выраженный и острый */
  const intensity = pick.intensities.length > 1 ? 'накалённые' : INTENSITY_LABELS[pick.intensities[0]].toLowerCase();
  return `${name} · ${intensity}`;
}

/* Выделение: выбранный элемент; у выбора с несколькими накалами («≥ 2») — и его ячейки по одной */
function isSelected(own, pick) {
  if (!pick || (own.tone ?? null) !== (pick.tone ?? null) || (own.emotion ?? null) !== (pick.emotion ?? null)) return false;
  if (pickKey(own) === pickKey(pick)) return true;
  return Boolean(own.intensities?.length === 1 && pick.intensities?.length > 1 && pick.intensities.includes(own.intensities[0]));
}

function feedPanel(pick, rows, context, state, labelOf) {
  const panel = element('section', 'verbatim-feed');
  panel.setAttribute('id', FEED_ID);
  if (!pick) {
    panel.setAttribute('aria-label', 'Отзывы эмоции');
    panel.append(element('p', 'emotions__hint', 'Выберите эмоцию или ячейку слева — здесь появятся её отзывы'));
    return panel;
  }
  const feed = emotionFeed(rows.filter((row) => inEmotionPick(row, pick)), context.verbatim.data, context.reference);
  const name = pickTitle(pick, labelOf);
  panel.setAttribute('aria-label', `Отзывы: ${name}`);
  const title = element('p', 'verbatim-feed__title');
  title.append(element('small', null, comments(feed.length)), element('span', null, name));
  const list = element('div', 'verbatim-feed__list');
  const actions = element('div', 'verbatim-problems__actions');
  const paint = () => {
    list.replaceChildren(...feed.slice(0, state.feedShown).map((entry) => feedEntry(entry, context.label)));
    actions.replaceChildren(...pagingButtons({
      shown: state.feedShown, total: feed.length, page: FEED_PAGE,
      moreClass: 'verbatim-feed__more', collapseClass: 'verbatim-feed__collapse',
      moreLabel: `Показать ещё отзывы: ${name}`, collapseLabel: `Скрыть дополнительные отзывы: ${name}`,
      onMore: () => {
        const firstNew = state.feedShown;
        state.feedShown += FEED_PAGE;
        paint();
        list.children[firstNew]?.setAttribute('tabindex', '-1');
        return list.children[firstNew];
      },
      onCollapse: () => {
        state.feedShown = FEED_PAGE;
        paint();
        return actions.querySelector('.verbatim-feed__more');
      },
    }));
  };
  paint();
  panel.append(title, list, actions);
  return panel;
}

function emotionsTable(table, state, select, labelOf) {
  const node = element('table', 'emotions-table');
  const head = element('thead');
  const headRow = element('tr');
  const th = (text, title) => {
    const cell = element('th', 'emotions-table__head', text);
    cell.setAttribute('scope', 'col');
    if (title) cell.title = title;
    return cell;
  };
  headRow.append(th('Эмоция'), th('Всего', 'Размеченные комментарии: оценки без комментария не считаются'),
    ...EMOTION_INTENSITIES.map((intensity) => th(INTENSITY_LABELS[intensity], `Накал ${quoted(INTENSITY_LABELS[intensity])}: ${INTENSITY_HINTS[intensity]}`)));
  head.append(headRow);
  const body = element('tbody');
  const cellButton = (own, count, text, className) => {
    const cell = element('td', `emotions-table__count${className ? ` ${className}` : ''}`);
    if (!count) {
      cell.append(emptyValue());
      return cell;
    }
    const button = element('button', 'emotions-table__pick', text);
    button.type = 'button';
    button.dataset.pick = pickKey(own);
    const selected = isSelected(own, state.pick);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${pickTitle(own, labelOf)}: ${comments(count)}`);
    if (selected) cell.classList.add('is-selected');
    button.addEventListener('click', () => select(own));
    cell.append(button);
    return cell;
  };
  const line = (own, counts, nameText, className) => {
    const row = element('tr', `emotions-table__row ${className}`);
    const name = element('th', 'emotions-table__name');
    name.setAttribute('scope', 'row');
    const nameButton = element('button', 'emotions-table__pick', nameText);
    nameButton.type = 'button';
    nameButton.dataset.pick = pickKey(own);
    nameButton.disabled = !counts.total;
    const selected = isSelected(own, state.pick);
    nameButton.setAttribute('aria-pressed', String(selected));
    nameButton.setAttribute('aria-label', `${nameText}: ${comments(counts.total)}. Показать отзывы`);
    if (counts.total) nameButton.addEventListener('click', () => select(own));
    name.append(nameButton);
    row.append(name, cellButton(own, counts.total, formatCount(counts.total), 'emotions-table__total'),
      ...EMOTION_INTENSITIES.map((intensity) => cellButton({ ...own, intensities: [intensity] }, counts.byIntensity[intensity], formatCount(counts.byIntensity[intensity]))));
    if (selected) row.classList.add('is-selected');
    return row;
  };
  for (const group of table.groups) {
    body.append(line({ tone: group.tone }, group, group.label, 'emotions-table__row--group'));
    for (const item of group.rows) body.append(line({ emotion: item.emotion }, item, item.emotion, 'emotions-table__row--emotion'));
  }
  node.append(head, body);
  return node;
}

export function renderEmotions(block, context) {
  block.setHead();
  const rows = context.slice.filter((row) => (row.emotion ?? null) !== null);
  if (context.slice.length === 0) {
    block.setState(EMPTY);
    return;
  }
  if (context.verbatim.status === 'idle') context.requestVerbatim();
  if (context.verbatim.status === 'idle' || context.verbatim.status === 'loading') {
    block.setState(LOADING);
    return;
  }
  if (context.verbatim.status === 'error') {
    block.setState(ERROR, context.verbatim.error);
    return;
  }
  const table = emotionTable(rows);
  if (!table.total) {
    block.setState(EMPTY);
    return;
  }
  const state = viewState(block, context);
  const labelOf = (tone) => table.groups.find((group) => group.tone === tone)?.label ?? tone;
  const select = (pick) => {
    const key = pickKey(pick);
    state.pick = key === pickKey(state.pick) ? null : pick;
    state.feedShown = FEED_PAGE;
    renderEmotions(block, context);
    block.element.querySelector(`.emotions-table__pick[data-pick='${key}']`)?.focus();
  };
  const note = element('p', 'emotions__note', EMOTIONS_NOTE);
  /* Период шапки раньше разметки — подпись: месяцы без разметки не считаются, это не накал «Нет» */
  const since = emotionsNoteFor(context);
  const list = element('div', 'verbatim-problems__list');
  list.append(note, ...(since ? [element('p', 'emotions__note', since)] : []), emotionsTable(table, state, select, labelOf));
  const feedSlot = element('div', 'verbatim-problems__feed');
  feedSlot.append(feedPanel(state.pick, rows, context, state, labelOf));
  const content = element('div', 'verbatim-problems emotions');
  content.append(list, feedSlot);
  block.setContent(content);
}
