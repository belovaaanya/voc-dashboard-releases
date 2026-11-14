/*
  Сегментная карточка: VOC сегмента, дельта, объём — и фильтр по сегменту
  по клику (P0 №7, D-31).

  Композиция (J-65, J-94): заголовок и бейдж плана в шапке; внизу число,
  дельта VOC справа сверху от него, под ним объём с дельтой объёма и иконка
  пометки выборки. Геометрия наша (V-01…V-03).

  Карточка считает свой срез **без** фильтра по сегменту (D-43): иначе после
  первого же клика три карточки из четырёх показывают «нет данных», и выбрать
  другой сегмент становится нечем.
*/

import { EMPTY } from '../shell/block.js';
import { appendAll, element } from '../ui/dom.js';
import { formatVoc } from '../core/format.js';
import { voc, vocDelta } from '../core/metrics.js';
import { withFilter } from '../state/url-state.js';
import { planFor } from '../core/plan.js';
import { badgeNode, countGroupNode, setPlanGlow, statusGlow, trendTone, forecastNode, leadNode, metaRowNode, pairNode, sufficiencyNode, trendNode } from './metric-card.js';
import { trendDirection, trendStep, trendSteps, trendValues } from '../core/segment-trend.js';

const SEGMENT = 'segment';

/* Клик перерисовывает дашборд и пересоздаёт кнопку: фокус клавиатуры возвращается на карточку того же сегмента */
let refocusCode = null;

/** Реестр держит по строке на карточку, а сегмент карточки — её порядковый номер в данных. */
export function vocSegment(index) {
  return (block, context) => render(block, context, index);
}

function render(block, context, index) {
  const { segments, state, label, select, setState } = context;
  const code = segments[index];

  block.setHead();
  /* Свечение живёт на самой карточке и обязано гаснуть вместе с содержимым */
  setPlanGlow(block, null);
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
  /* Статус плана — бейджем словами справа в шапке, как у карточки канала (было — точка) */
  block.setHead({ note: badgeNode(voc(rows), plan) });
  setPlanGlow(block, statusGlow(voc(rows), plan, rows));

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
  /* Незаконченный месяц или квартал: «?» после дельты оценок, прогноз по темпу — в подсказке */
  const forecast = forecastNode(rows.length, previous?.length, context.period);
  /* Мини-тренд VOC — справа от числа и дельты: три шага периода, последний — выбранный; подписи у крайних точек */
  const steps = trendSteps(context.period);
  const history = steps.length ? select({ filters: withFilter(state.filters, SEGMENT, [code]), from: steps[0].from, to: steps.at(-1).to }).rows : [];
  const values = steps.length ? trendValues(history, steps) : [];
  /* Пунктир уровня — нижняя граница плана: под ней сегмент «Ниже плана»; вне шкалы ряда не рисуется */
  /* Цвет тренда — направление динамики, мало оценок — серый (`trendTone`): план показывают бейдж и свечение */
  const tone = trendTone(rows, trendDirection(values));
  const trend = steps.length ? trendNode(values, steps, trendStep(context.period), { tone, level: plan?.min ?? null }) : null;
  /* Тренд — своей зоной справа под бейджем, число и объём — слева у нижнего края (metrics.css, `.metric--with-trend`) */
  if (trend) toggle.classList.add('metric--with-trend');
  /* Зона тренда — по ширине бейджа плана: невидимая копия бейджа задаёт ширину колонки (metrics.css) */
  const sizerBadge = trend ? badgeNode(voc(rows), plan) : null;
  if (sizerBadge) {
    const sizer = element('span', 'metric__trend-sizer');
    sizer.setAttribute('aria-hidden', 'true');
    sizer.append(sizerBadge);
    trend.append(sizer);
  }
  appendAll(toggle, pairNode(formatVoc(voc(rows)), leadNode(delta)), metaRowNode(countGroupNode(rows.length, previous?.length, context.period), forecast, warning), trend);
  /* aria-label кнопки заменяет её текст: прогноз и пометку выборки screen reader иначе не услышит */
  if (forecast) toggle.setAttribute('aria-label', `${toggle.getAttribute('aria-label')}. Период не закончен: ${forecast.dataset.forecast.toLowerCase()}`);
  if (warning) toggle.setAttribute('aria-label', `${toggle.getAttribute('aria-label')}. Мало оценок: ${warning.dataset.threshold.toLowerCase()}`);

  block.setContent(toggle);
  if (refocusCode === code) {
    refocusCode = null;
    toggle.focus();
  }
}
