import { breakdown } from './breakdown.js';
import { categoryValues, ignoredCauseKey } from './analytical-causes.js';
import { OS_ANDROID, OS_IOS, osCode, osName } from './dimensions.js';
import { createLabels, normalizeLabel } from './labels.js';
import { MARKS, voc } from './metrics.js';
import { ABOVE_PLAN, BELOW_PLAN, planStatus } from './plan.js';
import { roundImpact, roundShare, roundVoc } from './round.js';
import { buildTimeSeries } from './timeseries.js';

export const HIGHLIGHT_NONE = 'none';
export const HIGHLIGHT_PLAN = 'plan';
export const HIGHLIGHT_DAMAGE = 'damage';
/** J-135: влияние — насколько VOC интервала выше, чем без оценок с элементом. */
export const HIGHLIGHT_INFLUENCE = 'influence';
/* Влияние меньше этого по модулю — около нуля: VOC без элемента на экране (два знака) почти не меняется, ячейка серая */
export const INFLUENCE_NEUTRAL = 0.005;
export const HIGHLIGHT_SHARE = 'share';
/** J-38: частотность ДКО — число жалоб категории, подсвечена как доля и damage. */
export const HIGHLIGHT_FREQUENCY = 'frequency';

/* J-33: исключение только для расчётов ДКО антидрайверов, по ключу и подписи. */
function refusedCategory(key, label) {
  return [key, label('category', key)].some(value => typeof value === 'string'
    && normalizeLabel(value) === 'клиент отказался говорить');
}

function antidriverCategoryValues(row, reference) {
  const label = createLabels(reference);
  const category = Object.hasOwn(row, 'dko_category') ? row.dko_category : row.category;
  return categoryValues({ category }, reference).filter(key => !refusedCategory(key, label));
}

/* `ДКО` — категория основного негатива факта (`R-38`, `R-48`): не фильтр шапки, поэтому не в `DIMENSIONS` */
export const CATEGORY_CUT = { key: 'category', title: 'ДКО', fullTitle: 'Категория основного негатива', values: antidriverCategoryValues };

/*
  J-112: разрез версий приложения — только у АБМ, хотя версии бывают и у НИБ. Номера версий
  iOS и Android независимы, поэтому разрез всегда по одной ОС: общей строки версии нет
*/
export const VERSION_CHANNEL = 'АБМ';
export const VERSION_CUT = { key: 'app_version', title: 'Версии', fullTitle: 'Версии приложения' };
export const NO_VERSION = 'Без версии';

const VERSION_OS_ORDER = [OS_IOS, OS_ANDROID];

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

/** Код ОС без учёта регистра: выгрузка пишет его по-разному, а другая ОС не входит ни в iOS, ни в Android. */
export function versionOs(row) {
  return osCode(row.device_os);
}

/* В старой сборке без поля поиск идёт по всем оценкам канала: ответ один на массив оценок, а блок перерисовывается часто */
const versionsFound = new WeakMap();

export function offersVersions(rows, channel) {
  if (channel !== VERSION_CHANNEL) return false;
  if (!versionsFound.has(rows)) versionsFound.set(rows, rows.some((row) => row.channel === channel && textOf(row.app_version)));
  return versionsFound.get(rows);
}

/** ОС, которые есть в срезе: фильтр шапки сужает выбор, а не спорит с ним. */
export function versionOsChoices(rows) {
  const found = new Set();
  for (const row of rows) {
    const os = versionOs(row);
    if (os) found.add(os);
    if (found.size === VERSION_OS_ORDER.length) break;
  }
  return VERSION_OS_ORDER.filter((os) => found.has(os));
}

/** Строка версии — номер как есть. J-135: схлопывания «без последней цифры» больше нет. */
export function versionKey(version) {
  return textOf(version) || NO_VERSION;
}

/* J-128: строка версии — платформа и номер вместе: номера iOS и Android независимы и не склеиваются */
export function versionRowKey(row) {
  const os = versionOs(row);
  return os ? `${osName(os)} ${versionKey(row.app_version)}` : null;
}

export function splitVersionKey(key) {
  const space = key.indexOf(' ');
  return space > 0 ? { os: key.slice(0, space), version: key.slice(space + 1) } : { os: null, version: key };
}

/** «Новый срез» календаря — только версия с номером: «Без версии» новой версией не бывает. */
export function numberedVersionKey(row) {
  return textOf(row.app_version) ? versionRowKey(row) : null;
}

/* J-38: режима «Без подсветки» нет ни в одном разрезе; первый режим разреза — по умолчанию */
const ELEMENT_MODES = [HIGHLIGHT_PLAN, HIGHLIGHT_DAMAGE, HIGHLIGHT_INFLUENCE];
const CATEGORY_MODES = [HIGHLIGHT_FREQUENCY, HIGHLIGHT_SHARE, HIGHLIGHT_DAMAGE];

export function highlightModes(cutKey) {
  return cutKey === CATEGORY_CUT.key ? CATEGORY_MODES : ELEMENT_MODES;
}

/** Режим, которого у разреза нет, сбрасывается на первый режим разреза (`R-48`, `J-38`). */
export function highlightFor(cutKey, mode) {
  const modes = highlightModes(cutKey);
  return modes.includes(mode) ? mode : modes[0];
}

const TOP_MARK = MARKS.at(-1);

/** J-11: текущая частотность — уникальные оценки с элементом, без зависимости от VOC и прошлого периода. */
export function frequentElements(ratings, project, label, dimension = 'trigger') {
  return breakdown(ratings, project)
    .filter(({ key }) => !ignoredCauseKey(dimension, key, label))
    .sort((left, right) => right.mentions - left.mentions || left.key.localeCompare(right.key, 'ru'));
}

export function buildHeatmap(ratings, period, scale, project, keys) {
  const columns = buildTimeSeries(ratings, period, scale).map(({ from, to }) => ({ from, to }));
  const columnRatings = ratingsByColumn(ratings, columns);
  const groupsByColumn = columnRatings.map((rows) => new Map(breakdown(rows, project).map((group) => [group.key, group])));

  const columnVoc = columnRatings.map((rows) => voc(rows));
  const rows = keys.filter(key => !ignoredCauseKey('trigger', key)).map((key) => ({
    key,
    cells: groupsByColumn.map((groups, index) => {
      const group = groups.get(key);
      return {
        voc: group?.voc ?? null,
        mentions: group?.mentions ?? 0,
        damage: elementDamage(group, columnRatings[index].length),
        ...influenceOf(group, columnRatings[index].length, columnVoc[index]),
      };
    }),
  }));

  return { columns, rows };
}

/* Один проход вместо фильтра на столбец: столбцы идут подряд по датам и не пересекаются */
function ratingsByColumn(ratings, columns) {
  const grouped = columns.map(() => []);
  for (const rating of ratings) {
    const date = rating.appeal_date;
    if (typeof date !== 'string') continue;
    let low = 0;
    let high = columns.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (date < columns[middle].from) high = middle - 1;
      else if (date > columns[middle].to) low = middle + 1;
      else {
        grouped[middle].push(rating);
        break;
      }
    }
  }
  return grouped;
}

const uniqueCount = (ratings) => new Set(ratings.map(({ voc_ccode: id }) => id)).size;

/** Жалобы категории, доля среди жалоб с категорией и урон — часть разрыва `5 − VOC среза` по потерям категории (`R-48`, `J-110`). */
function categoryGroups(ratings, reference) {
  const categorised = ratings.filter(row => CATEGORY_CUT.values(row, reference).length > 0);
  const total = uniqueCount(categorised);
  const sliceVoc = voc(ratings);
  const found = breakdown(categorised, row => CATEGORY_CUT.values(row, reference));
  const lossOf = group => group.mentions * (TOP_MARK - group.voc);
  const totalLoss = found.reduce((sum, group) => sum + lossOf(group), 0);
  const groups = found.map(group => ({
    key: group.key,
    complaints: group.mentions,
    share: group.mentions / total,
    damage: totalLoss > 0 ? (TOP_MARK - sliceVoc) * lossOf(group) / totalLoss : 0,
  }));
  return { total, sliceVoc, groups };
}

/** J-11: строки `ДКО` — по числу уникальных жалоб за текущий период. */
export function rankCategories(ratings, limit = 10, reference = null) {
  return categoryGroups(ratings, reference).groups
    .sort((left, right) => right.complaints - left.complaints || left.key.localeCompare(right.key, 'ru'))
    .slice(0, limit);
}

export function buildCategoryHeatmap(ratings, period, scale, keys, reference = null) {
  const columns = buildTimeSeries(ratings, period, scale).map(({ from, to }) => ({ from, to }));
  const byColumn = columns.map(({ from, to }) => {
    const { total, sliceVoc, groups } = categoryGroups(ratings.filter(({ appeal_date: date }) => date >= from && date <= to), reference);
    return { total, sliceVoc, groups: new Map(groups.map((group) => [group.key, group])) };
  });

  const label = createLabels(reference);
  const rows = keys.filter(key => !ignoredCauseKey('category', key, label) && !refusedCategory(key, label)).map((key) => ({
    key,
    cells: byColumn.map(({ total, sliceVoc, groups }) => {
      if (total === 0) return { complaints: 0, share: null, damage: null, sliceVoc };
      const group = groups.get(key);
      return { complaints: group?.complaints ?? 0, share: group?.share ?? 0, damage: group?.damage ?? 0, sliceVoc };
    }),
  }));

  return { columns, rows, byCategory: true };
}

/** Пустая ячейка: у элемента — без оценок с ним, у `ДКО` — интервал без жалоб с категорией. */
export function isBlankCell(heatmap, cell) {
  return heatmap.byCategory ? cell.share === null : cell.voc === null;
}

/** `D-46`: VOC интервала минус VOC с оценками элемента, поднятыми до высшей; `voc_ccode` уникален. */
export function elementDamage(group, intervalSize) {
  if (intervalSize === 0) return null;
  return group ? (group.mentions * (group.voc - TOP_MARK)) / intervalSize : 0;
}

/**
 * J-135: влияние — VOC интервала минус VOC того же интервала без оценок с элементом (оценка с несколькими
 * элементами уходит целиком). Без элемента VOC ниже — влияние положительное, выше — отрицательное.
 * Алгебраически m · (VOC элемента − VOC интервала) / (N − m); все оценки интервала с элементом — сравнивать не с чем.
 */
export function influenceOf(group, intervalSize, intervalVoc) {
  if (!group || intervalSize === 0) return { influence: null, vocWithout: null };
  const rest = intervalSize - group.mentions;
  if (rest <= 0) return { influence: null, vocWithout: null };
  const vocWithout = (intervalVoc * intervalSize - group.voc * group.mentions) / rest;
  return { influence: intervalVoc - vocWithout, vocWithout };
}

/** Отклонение от ближайшей границы коридора по показанным значениям (`D-22`); внутри коридора — ноль. */
export function planDeviation(value, plan) {
  const status = planStatus(value, plan);
  if (status === BELOW_PLAN) return roundVoc(roundVoc(value) - roundVoc(plan.min));
  if (status === ABOVE_PLAN) return roundVoc(roundVoc(value) - roundVoc(plan.max));
  return status === null ? null : 0;
}

const HEATMAP_CUTOFF_QUANTILE = 0.75;
const HEATMAP_CAP_QUANTILE = 0.95;

function quantile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
}

function colourScale(values) {
  const sorted = values.filter(value => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return () => ({ strength: 0, muted: false });
  const lower = sorted.length < 4 ? 0 : quantile(sorted, HEATMAP_CUTOFF_QUANTILE);
  const upper = sorted.length < 4 ? sorted.at(-1) : quantile(sorted, HEATMAP_CAP_QUANTILE);
  return magnitude => {
    if (magnitude < lower) return { strength: 0, muted: true };
    if (upper === lower) return { strength: 1, muted: false };
    const ratio = Math.min(1, Math.max(0, (magnitude - lower) / (upper - lower)));
    return { strength: lower === 0 ? ratio : 0.25 + 0.75 * ratio, muted: false };
  };
}

/** План: квантили ограничены расстоянием до насыщенных VOC 4,00 / 4,85. */
function planColourScale(values, anchor) {
  const sorted = values.filter(value => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return () => ({ strength: 0, muted: false });
  const lower = sorted.length < 4 ? 0 : Math.min(quantile(sorted, HEATMAP_CUTOFF_QUANTILE), anchor * 0.5);
  const upperQuantile = sorted.length < 4 ? sorted.at(-1) : quantile(sorted, HEATMAP_CAP_QUANTILE);
  const upper = Math.min(anchor, Math.max(anchor * 0.5, lower + anchor * 0.25, upperQuantile));
  return magnitude => {
    if (magnitude < lower) return { strength: 0, muted: true };
    const ratio = Math.min(1, Math.max(0, (magnitude - lower) / (upper - lower)));
    return { strength: lower === 0 ? ratio : 0.25 + 0.75 * ratio, muted: false };
  };
}

function planAnchor(columnPlans, negative) {
  const distances = columnPlans.flatMap(plan => {
    if (!Number.isFinite(plan?.min) || !Number.isFinite(plan?.max)) return [];
    return [Math.max(0.01, negative ? roundVoc(plan.min) - 4 : 4.85 - roundVoc(plan.max))];
  });
  // Один anchor на знак: одинаковое показанное отклонение имеет одинаковый цвет во всех колонках.
  return distances.length ? Math.min(...distances) : 1;
}

function highlightValues(heatmap, mode, columnPlans) {
  return heatmap.rows.map(({ cells }) => cells.map((cell, index) => {
    if (isBlankCell(heatmap, cell)) return null;
    if (mode === HIGHLIGHT_PLAN) return planDeviation(cell.voc, columnPlans[index]);
    if (mode === HIGHLIGHT_DAMAGE) return roundImpact(cell.damage);
    if (mode === HIGHLIGHT_INFLUENCE) {
      if (cell.influence === null || cell.influence === undefined) return null;
      return Math.abs(cell.influence) < INFLUENCE_NEUTRAL ? 0 : roundImpact(cell.influence);
    }
    if (mode === HIGHLIGHT_SHARE) return roundShare(cell.share * 100);
    if (mode === HIGHLIGHT_FREQUENCY) return cell.complaints ?? null;
    return null;
  }));
}

/** Q75 / Q95 separately per sign; plan bounds saturation; calibration includes hidden rows. */
export function highlightHeatmap(heatmap, mode, columnPlans = [], calibration = heatmap) {
  const measured = highlightValues(heatmap, mode, columnPlans);
  const values = highlightValues(calibration, mode, columnPlans).flat().filter(value => value !== null);
  const positiveIsBad = mode === HIGHLIGHT_SHARE || mode === HIGHLIGHT_FREQUENCY || (mode === HIGHLIGHT_DAMAGE && heatmap.byCategory);
  const negative = mode === HIGHLIGHT_PLAN
    ? planColourScale(values.map(value => -value), planAnchor(columnPlans, true))
    : colourScale(values.map(value => -value));
  const positive = mode === HIGHLIGHT_PLAN
    ? planColourScale(values, planAnchor(columnPlans, false))
    : colourScale(values);
  return measured.map(row => row.map(value => {
    if (value === null) return { tone: null, strength: 0, muted: false, value: null };
    if (positiveIsBad) {
      return value > 0 ? { tone: 'bad', ...positive(value), value }
        : { tone: null, strength: 0, muted: false, value };
    }
    if (value < 0) return { tone: 'bad', ...negative(-value), value };
    if (value > 0) return { tone: 'good', ...positive(value), value };
    return { tone: mode === HIGHLIGHT_PLAN || mode === HIGHLIGHT_INFLUENCE ? 'neutral' : null, strength: 0, muted: false, value };
  }));
}
