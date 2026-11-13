/*
  Сегментная карточка: VOC сегмента, дельта, объём — и фильтр по сегменту
  по клику (P0 №7, D-31).

  Композиция (J-65, J-94): заголовок и кольцо плана в шапке; внизу число с
  дельтой рядом, под ним объём и иконка пометки выборки.
  Планового бейджа в малой карточке нет — в макете коридор показан только у
  карточки канала. Геометрия наша (V-01…V-03).

  Карточка считает свой срез **без** фильтра по сегменту (D-43): иначе после
  первого же клика три карточки из четырёх показывают «нет данных», и выбрать
  другой сегмент становится нечем.
*/

import { EMPTY } from '../shell/block.js';
import { appendAll, element } from '../ui/dom.js';
import { formatVoc } from '../core/format.js';
import { voc, vocDelta } from '../core/metrics.js';
import { withFilter } from '../state/url-state.js';
import { planFor, planGlow } from '../core/plan.js';
import { countNode, figureNode, leadNode, metaRowNode, sufficiencyNode, planDotNode } from './metric-card.js';

const SEGMENT = 'segment';

/* Клик перерисовывает дашборд и пересоздаёт кнопку: фокус клавиатуры возвращается на карточку того же сегмента */
let refocusCode = null;

/* J-67: свечение по плану — атрибут карточки; без плана атрибута нет (D-04) */
function setGlow(block, glow) {
  const card = block.element;
  if (!card?.dataset) return;
  if (glow) card.dataset.planGlow = glow;
  else delete card.dataset.planGlow;
}

/** Реестр держит по строке на карточку, а сегмент карточки — её порядковый номер в данных. */
export function vocSegment(index) {
  return (block, context) => render(block, context, index);
}

function render(block, context, index) {
  const { segments, state, label, select, setState } = context;
  const code = segments[index];

  block.setHead();
  /* Свечение живёт на самой карточке и обязано гаснуть вместе с содержимым */
  setGlow(block, null);
  if (!code) {
    block.setState(EMPTY, 'Сегмента нет в выгрузке.');
    return;
  }

  block.setTitle(`VOC ${code}`, label(SEGMENT, code));

  const { rows, previous } = select({ filters: withFilter(state.filters, SEGMENT, [code]) });
  if (rows.length === 0) {
    block.setState(EMPTY);
    return;
  }

  const delta = vocDelta(rows, previous);
  const plan = planFor(context.reference?.plan, { channel: state.channel, from: context.period?.from, to: context.period?.to });
  block.setHead({ note: planDotNode(voc(rows), plan) });
  setGlow(block, planGlow(voc(rows), plan));

  /* Выбрана — когда фильтр равен ровно этому сегменту: при двух выбранных ни одна карточка не «нажата» */
  const chosen = state.filters?.[SEGMENT] ?? [];
  const selected = chosen.length === 1 && chosen[0] === code;

  const toggle = element('button', 'metric metric--segment metric__toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', String(selected));
  /* Три карточки — три разных имени: по одному «Отфильтровать по сегменту» их не различить; сегмент — «код — подпись» (D-53) */
  const segmentName = label(SEGMENT, code) === code ? code : `${code} — ${label(SEGMENT, code)}`;
  toggle.setAttribute(
    'aria-label',
    selected ? `Снять фильтр по сегменту ${segmentName}` : `Отфильтровать дашборд по сегменту ${segmentName}`,
  );
  toggle.addEventListener('click', () => {
    refocusCode = document.activeElement === toggle ? code : null;
    setState({
      ...state,
      filters: withFilter(state.filters, SEGMENT, selected ? [] : [code]),
    });
  });

  /* J-94: пометка — иконка в строке объёма, отдельной строки нет: содержимое стоит у нижнего края, числа на общей линии (B-08) */
  const warning = sufficiencyNode(rows);
  appendAll(toggle, figureNode(formatVoc(voc(rows)), leadNode(delta)), metaRowNode(countNode(rows.length), warning));
  /* aria-label кнопки заменяет её текст: пометку выборки screen reader иначе не услышит */
  if (warning) toggle.setAttribute('aria-label', `${toggle.getAttribute('aria-label')}. Мало оценок: ${warning.dataset.threshold.toLowerCase()}`);

  block.setContent(toggle);
  if (refocusCode === code) {
    refocusCode = null;
    toggle.focus();
  }
}
