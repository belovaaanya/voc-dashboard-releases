/*
  Измерения, по которым дашборд фильтруется. Шапка генерируется из этого
  списка, а не из вёрстки, поэтому вернуть или убрать фильтр — правка одной
  строки (D-13).

  `Роли` — из необязательной колонки `role_name`: без неё измерение пусто и
  фильтр не выводится (D-13, R-31). `ФО` — это `domain`. `ОС` — `device_os`
  факта оценки (R-38, R-40): фильтр только у `АБМ`, у `НИБ` его нет (J-118).
  `Сценарии` и `Триггеры` — одно измерение под именем «Триггеры» (D-14, V-21).

  `КП` и `Продукты` выводятся из триггера через справочник по паре
  (канал, триггер) — join только по триггеру дал бы неверный разрез
  (data-model §3.2). Значения внутри строки дедуплицируются: несколько
  триггеров одной оценки могут сойтись в один продукт (data-model §5.2).
*/

import { annotationValues } from './annotations.js';
import { recentCache } from './recent.js';

function viaReference(row, reference, field) {
  const mapping = reference?.operations?.[row.channel];
  if (!mapping) return [];
  const values = new Set();
  for (const trigger of row.operations ?? []) {
    const value = mapping[trigger]?.[field];
    if (value) values.add(value);
  }
  return [...values];
}

/* Коды выгрузки — подписями без учёта регистра (J-112), неизвестная ОС локальной выгрузки — исходным текстом (D-58) */
export const OS_IOS = 'ios';
export const OS_ANDROID = 'and';
const OS_CODES = new Map([['ios', OS_IOS], ['and', OS_ANDROID], ['android', OS_ANDROID]]);
const OS_TITLES = new Map([[OS_IOS, 'iOS'], [OS_ANDROID, 'Android']]);

/** Код iOS или Android; другая ОС — `null`. */
export function osCode(value) {
  return typeof value === 'string' ? OS_CODES.get(value.trim().toLowerCase()) ?? null : null;
}

export function osName(code) {
  const text = typeof code === 'string' ? code.trim() : '';
  return text ? OS_TITLES.get(osCode(text)) ?? text : null;
}

/* Подпись измерения в тексте события; «Триггер», а не «операция»: так измерение называется в шапке (`D-14`) */
export const DIMENSION_CAPTION = {
  segment: 'Сегмент',
  trigger: 'Триггер',
  product: 'Продукт',
  problem_type: 'Категория негатива',
  problem: 'Проблема',
  os: 'ОС',
  category: 'Основной негатив',
};

/* Канал не входит в DIMENSIONS: он выше фильтров, но подпись берёт так же (D-02) */
export const CHANNEL_DIMENSION = 'channel';

/* Мобильный канал: только у него есть ОС устройства (J-118) */
export const MOBILE_CHANNEL = 'АБМ';

/* J-85: оценки без сегмента — не сегмент наравне с другими, в списке фильтра они внизу */
const NO_SEGMENT = 'Без сегмента';

export const DIMENSIONS = [
  {
    key: 'segment',
    title: 'Сегменты',
    allCaption: 'Все сегменты',
    last: NO_SEGMENT,
    values: (row) => [row.segment],
  },
  {
    key: 'trigger',
    title: 'Триггеры',
    allCaption: 'Все триггеры',
    values: (row) => row.operations ?? [],
  },
  {
    key: 'cp',
    title: 'Дирекции',
    allCaption: 'Все дирекции',
    values: (row, reference) => viaReference(row, reference, 'kp'),
  },
  {
    key: 'product',
    title: 'Продукты',
    allCaption: 'Все продукты',
    values: (row, reference) => viaReference(row, reference, 'product'),
  },
  {
    key: 'domain',
    title: 'ФО',
    allCaption: 'Все ФО',
    values: (row) => annotationValues(row, 'domain'),
  },
  {
    key: 'role',
    title: 'Роли',
    allCaption: 'Все роли',
    values: (row) => [row.role],
  },
  {
    key: 'os',
    title: 'Опер. система',
    allCaption: 'Все опер. системы',
    /* J-118: ОС — только у мобильного канала; device_os других каналов в выгрузке фильтра не открывает */
    channels: [MOBILE_CHANNEL],
    values: (row) => [osName(row.device_os)],
  },
];

/* Измерение без значений в данных не выводится: фильтровать нечем */
export function availableDimensions(rows, reference) {
  return DIMENSIONS.map((dimension) => {
    const values = new Set();
    for (const row of rows) {
      for (const value of dimension.values(row, reference)) {
        if (value) values.add(value);
      }
    }
    const options = [...values].sort((a, b) => a.localeCompare(b, 'ru'));
    return { ...dimension, options: dimension.last && values.has(dimension.last) ? [...options.filter((value) => value !== dimension.last), dimension.last] : options };
  }).filter((dimension) => dimension.options.length > 0);
}

/* Шапка — по оценкам выбранного канала за всю выгрузку; фильтр ОС — только у `АБМ`, даже если у `НИБ` в выгрузке есть device_os (R-40, J-118) */
const byChannel = recentCache();

export function channelDimensions(rows, channel, reference) {
  return byChannel(rows, channel ?? null, () => ({
    reference,
    dimensions: availableDimensions(rows.filter((row) => !channel || row.channel === channel), reference)
      .filter((dimension) => !channel || !dimension.channels || dimension.channels.includes(channel)),
  }), (cached) => cached.reference === reference).dimensions;
}

/* Значение без чекбокса в списке канала снять из UI нельзя: иначе оно молча сужало бы срез и убирало коридор плана */
export function servableFilters(filters, dimensions) {
  const options = new Map(dimensions.map(({ key, options }) => [key, new Set(options)]));
  return Object.fromEntries(Object.entries(filters ?? {})
    .map(([key, values]) => [key, (values ?? []).filter((value) => options.get(key)?.has(value))])
    .filter(([, values]) => values.length > 0));
}

/*
  Табы каналов генерируются по данным (D-01). Манифест несёт свой список
  каналов, но источником остаются сами оценки: канал без единой оценки
  показывать нечем
*/
export function channelsOf(rows) {
  const channels = new Set();
  for (const row of rows) {
    if (row.channel) channels.add(row.channel);
  }
  return [...channels].sort((a, b) => a.localeCompare(b, 'ru'));
}

/*
  D-59: три плитки, остальные сегменты остаются в данных и фильтрах.
  J-42: порядок фиксированный — ММБ, СБ, КИБ, а не по объёму оценок
*/
const METRIC_SEGMENTS = ['ММБ', 'СБ', 'КИБ'];

export function metricSegments() {
  return [...METRIC_SEGMENTS];
}
