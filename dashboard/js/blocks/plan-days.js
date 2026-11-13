/*
  Плитка второй строки метрик (J-85, композиция J-87): сколько дней периода VOC среза
  был ниже, выше и в коридоре плана. Слева подписи с числами дней, кольцо справа —
  их доли, поэтому цвет здесь не единственный носитель (D-26).
*/

import { EMPTY } from '../shell/block.js';
import { element } from '../ui/dom.js';
import { formatCount } from '../core/format.js';
import { ABOVE_PLAN, BELOW_PLAN, IN_PLAN, planDays } from '../core/plan.js';
import { isWholeMonth } from '../core/conversion.js';
import { renderConversion } from './conversion.js';

export const PLAN_DAYS_TITLE = 'Дни относительно плана';

const PARTS = [
  { status: BELOW_PLAN, caption: 'Ниже плана' },
  { status: ABOVE_PLAN, caption: 'Выше плана' },
  { status: IN_PLAN, caption: 'В плане' },
];
const CSS_STOP = (name, at) => `var(--plan-days-${name}) ${at}%`;

/*
  Каждая дуга — от насыщенного начала к прозрачному концу по ходу часовой стрелки (J-106).
  У SVG-обводки нет градиента вдоль окружности, поэтому кольцо — конический градиент
  с маской. Границы дуг — резкие: начало следующей стоит в той же точке, что конец прошлой
*/
export function ringSectors(days) {
  let passed = 0;
  return PARTS.filter(({ status }) => days[status] > 0).map(({ status }) => {
    const from = passed;
    passed = status === PARTS.findLast((part) => days[part.status] > 0).status ? 100 : passed + (days[status] * 100) / days.total;
    return { status, from, to: passed };
  });
}

function ringNode(days) {
  const ring = element('div', 'plan-days__ring');
  ring.setAttribute('aria-hidden', 'true');
  ring.style.setProperty('--plan-days-arcs', ringSectors(days)
    .flatMap(({ status, from, to }) => [CSS_STOP(`${status}-start`, from), CSS_STOP(`${status}-end`, to)])
    .join(', '));
  return ring;
}

function legendNode(days) {
  const legend = element('ul', 'plan-days__legend');
  for (const { status, caption } of PARTS) {
    const item = element('li', 'plan-days__item');
    const swatch = element('span', `plan-days__swatch plan-days__swatch--${status}`);
    swatch.setAttribute('aria-hidden', 'true');
    /* J-198: точка → подпись → число: числа одной колонкой справа, вровень по правому краю */
    item.append(swatch, element('span', 'plan-days__caption', caption), element('span', 'plan-days__count', formatCount(days[status])));
    legend.append(item);
  }
  return legend;
}

/*
  На главной на этом месте всегда «Конверсия опроса» на две колонки (решение пользователя); в разделе «Для аналитика» —
  конверсия за целый месяц, за другой период — дни плана
*/
export function renderPlanDays(block, context) {
  const conversion = !context.analyst || isWholeMonth(context.period, context.rows);
  block.element?.classList.toggle('card--conversion', conversion);
  if (conversion) {
    renderConversion(block, context);
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
  const layout = element('div', 'plan-days');
  /* Ячейка кольца: её ширину задаёт сетка — остаток после легенды, не больше токена */
  const slot = element('div', 'plan-days__ring-slot');
  slot.append(ringNode(days));
  layout.append(legendNode(days), slot);
  block.setContent(layout);
}
