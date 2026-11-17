/*
  Плитка второй строки метрик (J-85, композиция J-87): сколько дней периода VOC среза
  был ниже, выше и в коридоре плана. Слева подписи с числами дней, кольцо справа —
  их доли, поэтому цвет здесь не единственный носитель (D-26).
*/

import { EMPTY } from '../shell/block.js';
import { element } from '../ui/dom.js';
import { legendMarker } from '../components/legend.js';
import { formatCount } from '../core/format.js';
import { ABOVE_PLAN, BELOW_PLAN, IN_PLAN, planDays } from '../core/plan.js';
import { isWholeMonth } from '../core/conversion.js';
import { renderConversion } from './conversion.js';

export const PLAN_DAYS_TITLE = 'Дни относительно плана';

const PARTS = [
  { status: BELOW_PLAN, caption: 'Ниже плана', tone: 'negative' },
  { status: ABOVE_PLAN, caption: 'Выше плана', tone: 'positive' },
  { status: IN_PLAN, caption: 'В плане', tone: 'plan-in' },
];
const CSS_STOP = (name, at) => `var(--plan-days-${name}) ${at}%`;

/*
  Каждая дуга — от насыщенного начала к прозрачному концу по ходу часовой стрелки (J-106).
  У SVG-обводки нет градиента вдоль окружности, поэтому кольцо — конический градиент
  с маской. Границы дуг — резкие: начало следующей стоит в той же точке, что конец прошлой
*/
function ringArcs(parts) {
  const shown = parts.filter(({ value }) => value > 0);
  const total = shown.reduce((sum, { value }) => sum + value, 0);
  let passed = 0;
  return shown.map(({ status, value }, index) => {
    const from = passed;
    passed = index === shown.length - 1 ? 100 : passed + (value * 100) / total;
    return { status, from, to: passed };
  });
}

export function ringSectors(days) {
  return ringArcs(PARTS.map(({ status }) => ({ status, value: days[status] })));
}

function ringNode(parts) {
  const ring = element('div', 'plan-days__ring');
  ring.setAttribute('aria-hidden', 'true');
  ring.style.setProperty('--plan-days-arcs', ringArcs(parts)
    .flatMap(({ status, from, to }) => [CSS_STOP(`${status}-start`, from), CSS_STOP(`${status}-end`, to)])
    .join(', '));
  return ring;
}

function legendNode(parts, row) {
  const legend = element(row ? 'div' : 'ul', 'plan-days__legend');
  for (const part of parts) {
    /* J-198: точка → подпись → число: числа одной колонкой справа, вровень по правому краю */
    const cells = [legendMarker(part.tone, 'dot', { large: true }), element('span', 'plan-days__caption', part.caption), element('span', 'plan-days__count', part.count)];
    const item = row ? row(part) : element('li');
    item.classList.add('plan-days__item');
    item.append(...cells);
    legend.append(item);
  }
  return legend;
}

/*
  Кольцо с легендой «Дней относительно плана» — общий вид для долей из трёх частей (плитка «Эмоции» над «Топ проблем»):
  `parts` — { status: 'below' | 'above' | 'in' (цвета дуги --plan-days-*), caption, tone (точка легенды), value, count }.
  `row(part)` — свой элемент строки (кнопка выбора); без него строки — пункты списка
*/
export function ringLegend(parts, { row } = {}) {
  const layout = element('div', 'plan-days');
  /* Ячейка кольца: её ширину задаёт сетка — остаток после легенды, не больше токена */
  const slot = element('div', 'plan-days__ring-slot');
  slot.append(ringNode(parts));
  layout.append(legendNode(parts, row), slot);
  return layout;
}

/*
  На главной на этом месте всегда «Конверсия опроса» (решение пользователя); в разделе «Для аналитика» —
  конверсия за целый месяц, за другой период — дни плана
*/
export function renderPlanDays(block, context) {
  const conversion = !context.analyst || isWholeMonth(context.period, context.rows);
  block.element?.classList.toggle('card--conversion', conversion);
  /* Пометку заглушки ставит сама конверсия; дни плана её снимают, иначе их «Нет плана» осталось бы без прочерка */
  if (!conversion) block.element?.classList.remove('card--conversion-pending');
  if (conversion) {
    /* «Для продакта» карточка на две колонки — пять ступеней, как в макете; у аналитика узкая (≈280 px) — три ступени */
    renderConversion(block, { ...context, compact: Boolean(context.analyst) });
    return;
  }
  block.setTitle?.(PLAN_DAYS_TITLE);
  const { slice, state, reference } = context;
  block.setHead();
  if (slice.length === 0) {
    block.setState(EMPTY);
    return;
  }
  const days = planDays(slice, reference?.plan, state.channel);
  if (days.total === 0) {
    block.setState(EMPTY, 'Нет плана на этот период.');
    return;
  }
  block.setContent(ringLegend(PARTS.map((part) => ({ ...part, value: days[part.status], count: formatCount(days[part.status]) }))));
}
