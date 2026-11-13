/* Выгрузка блока в Excel (J-15): разрез, период и фильтры — как на экране, первым листом — параметры */

import { CHANNEL_DIMENSION, DIMENSIONS } from './dimensions.js';
import { formatDate, formatDateRange, formatInterval } from './format.js';
import { ABOVE_PLAN, BELOW_PLAN, IN_PLAN, planStatus } from './plan.js';
import { roundImpact, roundShare, roundVoc } from './round.js';
import { SCALE_OPTIONS } from './timeseries.js';
import { safeFileName } from './xlsx.js';

const scaleLabel = (scale) => SCALE_OPTIONS.find(({ value }) => value === scale)?.label ?? scale;

function filterRows(context) {
  const filters = context.state.filters ?? {};
  const applied = DIMENSIONS.filter(({ key }) => filters[key]?.length)
    .map(({ key, title }) => [title, filters[key].map((value) => context.label(key, value)).join('; ')]);
  return applied.length ? applied : [['Фильтры', 'Без фильтров']];
}

export function parameterSheet(context, block, extra = []) {
  return {
    name: 'Параметры',
    rows: [
      ['Параметр', 'Значение'],
      ['Блок', block],
      ['Канал', context.label(CHANNEL_DIMENSION, context.state.channel)],
      ['Период', formatDateRange(context.period.from, context.period.to)],
      ...filterRows(context),
      ...extra,
    ],
  };
}

const ZONE_LABELS = { [BELOW_PLAN]: 'Ниже плана', [IN_PLAN]: 'В плане', [ABOVE_PLAN]: 'Выше плана' };
const zoneOf = (voc, plan) => ZONE_LABELS[planStatus(voc, plan)] ?? null;

/* Прошлый период — та же сетка интервалов со сдвигом: строка N сравнивается с N-м интервалом прошлого */
export function dynamicsSheets(context, { current, previous, plan }, scale) {
  const rows = current.map((bucket, index) => [
    formatDate(bucket.from),
    formatDate(bucket.to),
    roundVoc(bucket.voc),
    bucket.count,
    roundVoc(previous[index]?.voc ?? null),
    plan?.min ?? null,
    plan?.max ?? null,
    zoneOf(bucket.voc, plan),
    roundVoc(bucket.damage),
  ]);
  return [
    parameterSheet(context, 'Динамика VOC', [['Гранулярность', scaleLabel(scale)]]),
    {
      name: 'Динамика VOC',
      rows: [['Начало', 'Конец', 'VOC', 'Оценок', 'VOC прошлого периода', 'План от', 'План до', 'Зона', 'Урон'], ...rows],
    },
  ];
}

const matrix = (name, heatmap, rowLabel, value, rowTitle = 'Элемент') => ({
  name,
  rows: [
    [heatmap.byCategory ? 'Категория' : rowTitle, ...heatmap.columns.map(formatInterval)],
    ...heatmap.rows.map((row) => [rowLabel(row.key), ...row.cells.map(value)]),
  ],
});

/* Все строки разреза, а не только раскрытые на экране: «Показать ещё» — про чтение, не про состав выгрузки */
export function antidriverSheets(context, heatmap, { cut, cutKey, scale, rowTitle, extra = [] }) {
  const label = (key) => context.label(cutKey, key);
  const parameters = parameterSheet(context, 'Антидрайверы', [['Разрез', cut], ['Гранулярность', scaleLabel(scale)], ...extra]);
  if (heatmap.byCategory) {
    return [
      parameters,
      matrix('Жалобы', heatmap, label, (cell) => (cell.share === null ? null : cell.complaints)),
      matrix('Доля, %', heatmap, label, (cell) => (cell.share === null ? null : roundShare(cell.share * 100))),
      matrix('Урон', heatmap, label, (cell) => roundImpact(cell.damage)),
      {
        name: 'VOC среза',
        rows: [['Интервал', 'VOC среза'], ...heatmap.columns.map((column, index) => [formatInterval(column), roundVoc(heatmap.rows[0]?.cells[index].sliceVoc ?? null)])],
      },
    ];
  }
  return [
    parameters,
    matrix('VOC', heatmap, label, (cell) => roundVoc(cell.voc), rowTitle),
    matrix('Оценки', heatmap, label, (cell) => cell.mentions, rowTitle),
    matrix('Урон', heatmap, label, (cell) => (cell.voc === null ? null : roundImpact(cell.damage)), rowTitle),
    /* J-135: VOC интервала минус VOC без оценок с элементом; пусто — элемента нет или без него оценок не остаётся */
    matrix('Влияние', heatmap, label, (cell) => (cell.influence === null || cell.influence === undefined ? null : roundImpact(cell.influence)), rowTitle),
  ];
}

export function exportFileName(block, context) {
  const { from, to } = context.period;
  return safeFileName(`${block} ${context.label(CHANNEL_DIMENSION, context.state.channel)} ${from} — ${to}`);
}
