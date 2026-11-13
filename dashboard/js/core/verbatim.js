import { annotationValues } from './annotations.js';
import { complaintAnnotations, complaintValues, categoryValues } from './analytical-causes.js';
import { latestDate, weekdayOf } from './dates.js';
import { OS_ANDROID, OS_IOS, osCode, osName } from './dimensions.js';
import { createLabels, normalizeLabel } from './labels.js';
import { CATEGORY_CUT } from './antidrivers.js';
import { voc } from './metrics.js';
import { formatNumber } from './format.js';

export function validateVerbatim(verbatim) {
  if (!verbatim || typeof verbatim !== 'object' || Array.isArray(verbatim)) {
    throw new Error('verbatim: ожидался объект');
  }
  if (!verbatim.items || typeof verbatim.items !== 'object' || Array.isArray(verbatim.items)) {
    throw new Error('verbatim.items: ожидался объект по voc_ccode');
  }
  return verbatim.items;
}

const textOf = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

const commentFor = (items, row) => textOf(items[row.voc_ccode]?.client_comment);

/**
 * Разрезы «Топ проблем» (R-49): значения разреза у одной оценки. Метки D-58 дают оценку
 * каждому своему значению ровно один раз; оценка без категории негатива в разрез ДКО не входит.
 */
/* ФО стоит и на похвале без проблемы: в «Топ проблем» — только ФО меток с проблемой */
const complaintDomains = (row, reference) => [...new Set(complaintAnnotations(row, reference)
  .filter((annotation) => textOf(annotation.problem))
  .map((annotation) => textOf(annotation.domain))
  .filter(Boolean))];

/*
  J-119: разрез «ФО и проблематика» — пара (ФО, проблема) из одной метки: проблема в таблице стоит под своей ФО.
  Проблема без ФО — под «Без ФО». Ключ пары — текст из двух частей с невидимым разделителем, части — в полях карточки
*/
export const NO_DOMAIN = 'Без ФО';
/* J-121: ДКО — тем же видом: группа негатива `category_group` и категории под ней; без группы — «Без группы» */
export const NO_CATEGORY_GROUP = 'Без группы';
const PAIR = '\u001f';
export const pairKey = (group, name) => `${group}${PAIR}${name}`;
const pairParts = (key) => {
  const [group, name] = key.split(PAIR);
  return { group, name };
};
/*
  J-123: метка с типом проблемы «позитив» — похвала, а не жалоба: её проблема стоит в отдельной группе «Позитив»,
  а не под своей ФО, иначе похвала смешалась бы с жалобами ФО и подняла её частотность
*/
export const POSITIVE_GROUP = 'Позитив';
const isPositive = (annotation) => textOf(annotation.problem_type)?.toLocaleLowerCase('ru') === 'позитив';
const domainProblems = (row, reference) => [...new Set(complaintAnnotations(row, reference)
  .filter((annotation) => textOf(annotation.problem))
  .map((annotation) => pairKey(isPositive(annotation) ? POSITIVE_GROUP : textOf(annotation.domain) ?? NO_DOMAIN, textOf(annotation.problem))))];
/*
  J-128: ДКО топа считается как ДКО антидрайверов: `dko_category` с подстановкой группы (J-33), без «Клиент отказался
  говорить» (J-34) и технических категорий (J-109) — иначе цифры двух блоков разошлись бы
*/
const categoryPairs = (row, reference) => CATEGORY_CUT.values(row, reference)
  .map((category) => pairKey(textOf(row.category_group) ?? NO_CATEGORY_GROUP, category));

/* Разрезы-пары: какая часть — группа, какая — значение; проверка скрытых подписей идёт по своим измерениям */
const PAIR_CUTS = {
  domainProblem: { group: 'domain', name: 'problem' },
  categoryPair: { group: 'category_group', name: 'category' },
};

export const PROBLEM_CUTS = {
  problem: (row, reference) => complaintValues(row, 'problem', reference),
  domain: complaintDomains,
  domainProblem: domainProblems,
  category: categoryValues,
  categoryPair: categoryPairs,
};

/* J-27: скрываем служебные категории только в соответствующем разрезе топа. */
const emptyTopLabels = { problem: 'проблема не определена', domainProblem: 'проблема не определена', category: 'нет категории', categoryPair: 'нет категории' };
const normalizedTopLabel = value => normalizeLabel(value, { dashes: 'hyphen' });
const hiddenTopLabels = new Set(['dlp-блок']);

/*
  J-133: база доли топа — кейсы с обратной связью, в которых проблема выявлена. Обратная связь — комментарий клиента
  или экспертиза; экспертиза «Выявить / выяснить причину снижения не удалось…» при пустом комментарии — недозвон или
  отказ, а не обратная связь. Проблема не выявлена, если ни у одной метки оценки нет проблемы вне «Проблема не
  определена» / «Невозможно выделить проблему» с ФО вне «без категории». В разрезах ДКО «выявлено» — у оценки есть
  показанная категория негатива (без «Нет категории» и исключённых, J-27, J-34, J-109): ДКО ставит эксперт, а не модель
*/
const NO_REASON = /(выявить|выяснить) причину снижения не удалось/u;
const UNIDENTIFIED_PROBLEMS = new Set(['проблема не определена', 'невозможно выделить проблему']);
const UNIDENTIFIED_DOMAIN = 'без категории';

/* Строки оценок неизменяемы, а база считается на каждой отрисовке: признаки — один раз на строку, тексты и справочник */
const feedbackByRow = new WeakMap();
const identifiedByRow = new WeakMap();

function isFeedbackCase(row, items) {
  const saved = feedbackByRow.get(row);
  if (saved?.items === items) return saved.value;
  const item = items[row.voc_ccode];
  const expertise = textOf(item?.oslk_expertise_name);
  const value = Boolean(textOf(item?.client_comment)) || (Boolean(expertise) && !NO_REASON.test(normalizedTopLabel(expertise)));
  feedbackByRow.set(row, { items, value });
  return value;
}

function hasIdentifiedProblem(row, reference = null) {
  const saved = identifiedByRow.get(row);
  if (saved?.reference === reference) return saved.value;
  const value = identifiedProblem(row, reference);
  identifiedByRow.set(row, { reference, value });
  return value;
}

function identifiedProblem(row, reference) {
  const label = createLabels(reference);
  return complaintAnnotations(row, reference).some((annotation) => {
    const problem = textOf(annotation.problem);
    /* Скрытая метка (DLP-блок, J-32) — текст закрыт, проблема по нему не выявлена */
    const unknown = (field, value, rejected) => [value, label(field, value)].some((text) => rejected(normalizedTopLabel(text)) || hiddenTopLabels.has(normalizedTopLabel(text)));
    if (!problem || unknown('problem', problem, (text) => UNIDENTIFIED_PROBLEMS.has(text))) return false;
    const domain = textOf(annotation.domain);
    return !domain || !unknown('domain', domain, (text) => text === UNIDENTIFIED_DOMAIN);
  });
}

const CATEGORY_CUTS = new Set(['category', 'categoryPair']);
const shareBase = (rows, items, identified) => rows.filter((row) => isFeedbackCase(row, items) && identified(row));

function groupByCut(rows, valuesOf) {
  const groups = new Map();
  for (const row of rows) {
    for (const value of valuesOf(row)) {
      const group = groups.get(value) ?? [];
      group.push(row);
      groups.set(value, group);
    }
  }
  return groups;
}

function cardOrder(mode) {
  if (mode === 'frequent') {
    return (left, right) => right.count - left.count || left.key.localeCompare(right.key, 'ru');
  }
  if (mode === 'emerging') {
    return (left, right) => right.lastSeen.localeCompare(left.lastSeen)
      || right.count - left.count
      || left.key.localeCompare(right.key, 'ru');
  }
  throw new Error(`Неизвестный вид прямой речи: ${mode}`);
}

/* J-123: код ОС без учёта регистра: данные, собранные до J-112, хранят `And` как есть */
function osCounts(rows) {
  const counts = { [OS_IOS]: 0, [OS_ANDROID]: 0 };
  for (const row of rows) {
    const code = osCode(row.device_os);
    if (code) counts[code] += 1;
  }
  return counts;
}

/* Частое значение и его доля в жалобах проблемы; без значений — null */
function mostFrequent(values, total) {
  const counts = new Map();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  const [value, count] = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))[0] ?? [];
  return value ? { value, share: (count / total) * 100 } : null;
}

const WEEKEND = new Set([0, 6]);
const WEEKDAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/* J-114: «когда чаще» — допущение без требования заказчика: от 20 жалоб, перекос в 1,5 раза и от 5 жалоб в дне */
export const PEAK_RULE = { minComplaints: 20, ratio: 1.5, minInGroup: 5, dateRatio: 2 };

function weekdayCounts(rows) {
  const counts = Array(7).fill(0);
  for (const row of rows) counts[weekdayOf(row.appeal_date)] += 1;
  return counts;
}

/* J-140: оценки и жалобы по датам и по частям месяца — для пика в конкретные числа и цикличности внутри месяца */
function dateCounts(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.appeal_date, (counts.get(row.appeal_date) ?? 0) + 1);
  return counts;
}
const MONTH_PARTS = [
  { label: 'в начале месяца', title: '1–10 число', test: (day) => day <= 10 },
  { label: 'в середине месяца', title: '11–20 число', test: (day) => day > 10 && day <= 20 },
  { label: 'в конце месяца', title: 'с 21 числа', test: (day) => day > 20 },
];
const monthPartOf = (date) => MONTH_PARTS.findIndex(({ test }) => test(Number(date.slice(8, 10))));
const dayMonth = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/**
 * Когда у проблемы жалоб больше обычного: доля жалоб среди всех оценок дня, дня недели или части месяца против той
 * же доли по всему срезу. Объём оценок в разные дни разный, поэтому сравнивается доля, а не число жалоб.
 * J-140: кроме дней недели — пик в конкретную дату (скученность: доля в 2 раза выше обычной) и часть месяца
 * (начало, середина, конец — цикличность по числам). Показываются до двух самых сильных закономерностей.
 * Времени оценки в выгрузке нет, поэтому времени суток здесь нет
 */
function peakOf(rows, { weekdays, dates }) {
  if (rows.length < PEAK_RULE.minComplaints) return { kind: 'few', label: 'мало жалоб' };
  const total = weekdays.reduce((sum, value) => sum + value, 0);
  const base = rows.length / total;
  const complaints = weekdayCounts(rows);
  const rate = (hits, all) => ({ hits, ratio: all ? hits / all / base : 0 });
  const sum = (list, days) => days.reduce((acc, day) => acc + list[day], 0);
  const found = [];

  const weekend = rate(sum(complaints, [0, 6]), sum(weekdays, [0, 6]));
  const workdays = rate(sum(complaints, [1, 2, 3, 4, 5]), sum(weekdays, [1, 2, 3, 4, 5]));
  const [day, best] = [0, 1, 2, 3, 4, 5, 6].map((index) => [index, rate(complaints[index], weekdays[index])])
    .sort((left, right) => right[1].ratio - left[1].ratio || left[0] - right[0])[0];
  if (weekend.hits >= PEAK_RULE.minInGroup && weekend.ratio >= PEAK_RULE.ratio) found.push({ kind: 'weekend', label: 'чаще в выходные', ratio: weekend.ratio });
  else if (best.hits >= PEAK_RULE.minInGroup && best.ratio >= PEAK_RULE.ratio) found.push({ kind: 'weekday', label: `чаще по ${WEEKDAY_NAMES[day]}`, ratio: best.ratio });
  else if (workdays.hits >= PEAK_RULE.minInGroup && weekend.ratio <= 1 / PEAK_RULE.ratio && !WEEKEND.has(day)) found.push({ kind: 'workdays', label: 'чаще в будни', ratio: workdays.ratio });

  const byDate = dateCounts(rows);
  const spike = [...byDate].map(([date, hits]) => [date, rate(hits, dates.get(date) ?? 0)])
    .sort((left, right) => right[1].ratio - left[1].ratio || right[1].hits - left[1].hits || left[0].localeCompare(right[0]))[0];
  if (spike && spike[1].hits >= PEAK_RULE.minInGroup && spike[1].ratio >= PEAK_RULE.dateRatio) {
    found.push({ kind: 'date', label: `пик ${dayMonth(spike[0])}`, ratio: spike[1].ratio });
  }

  const partHits = [0, 0, 0];
  const partAll = [0, 0, 0];
  for (const row of rows) partHits[monthPartOf(row.appeal_date)] += 1;
  for (const [date, count] of dates) partAll[monthPartOf(date)] += count;
  const part = [0, 1, 2].map((index) => [index, rate(partHits[index], partAll[index])])
    .sort((left, right) => right[1].ratio - left[1].ratio || left[0] - right[0])[0];
  /* Часть месяца, в которой весь пик — один день, — это пик даты, а не цикличность */
  const partIsSpike = spike && monthPartOf(spike[0]) === part[0] && spike[1].hits >= part[1].hits * 0.8;
  if (part[1].hits >= PEAK_RULE.minInGroup && part[1].ratio >= PEAK_RULE.ratio && !partIsSpike) {
    found.push({ kind: 'month', label: `чаще ${MONTH_PARTS[part[0]].label}`, ratio: part[1].ratio, title: MONTH_PARTS[part[0]].title });
  }

  if (!found.length) return { kind: 'none', label: 'нет закономерности' };
  const top = found.sort((left, right) => right.ratio - left.ratio).slice(0, 2);
  return {
    kind: top[0].kind,
    label: top.map(({ label }) => label).join(' · '),
    title: top.map(({ label, ratio, title }) => `${label}${title ? ` (${title})` : ''}: доля жалоб в ${formatNumber(ratio, 1)} раза выше обычной`).join('; '),
  };
}

function feedOf(rows, items, reference) {
  return rows
    .map((row) => ({ id: row.voc_ccode, date: row.appeal_date, rating: row.mark, segment: segmentOf(row), comment: commentFor(items, row),
      products: operationValues(row, reference, 'product'), triggers: row.operations ?? [],
      /* J-114: ОС и версия приложения — сразу у цитаты; версия есть только у АБМ, у других каналов поле пустое */
      os: row.device_os ? osName(row.device_os) : null, version: textOf(items[row.voc_ccode]?.app_version) }))
    .filter(({ comment }) => comment)
    .sort((left, right) => right.date.localeCompare(left.date) || left.rating - right.rating || left.id.localeCompare(right.id));
}

/* Без сегмента — отдельной строкой в конце: «нет пина» не теряется и не смешивается с сегментом */
/* J-123: значение «Без сегмента» из выгрузки (J-85) и пустой сегмент — одна колонка, а не две */
const segmentOf = (row) => (!row.segment || row.segment === 'Без сегмента' ? null : row.segment);

function segmentCounts(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(segmentOf(row), (counts.get(segmentOf(row)) ?? 0) + 1);
  return [...counts].map(([code, count]) => ({ code, count }))
    .sort((left, right) => (left.code === null) - (right.code === null) || right.count - left.count || String(left.code).localeCompare(String(right.code), 'ru'));
}

const TOP_MARK = 5;

/**
 * J-129: доля негатива — какая часть негатива (оценки 1–4) приходится на значение, если растянуть размеченные отзывы
 * на весь негатив: потери уникальных оценок со значением / потери всех размеченных оценок 1–4, потери — 5 − оценка.
 * Оценка с несколькими значениями целиком входит в каждое, поэтому сумма долей может быть больше 100 %, как у триггеров.
 * Похвала (J-123) и скрытые метки (J-27, J-32) — не размеченный негатив. В пунктах VOC — доля × (5 − VOC среза).
 * Покрытие — доля оценок 1–4 среза, у которых есть показанная метка: чем оно меньше, тем грубее растягивание.
 */
export function negativeBase(rows, valuesOf, excluded = () => false) {
  let labeledLoss = 0;
  let negatives = 0;
  let labeled = 0;
  for (const row of rows) {
    const loss = TOP_MARK - row.mark;
    if (!(loss > 0)) continue;
    negatives += 1;
    if (!valuesOf(row).some((value) => !excluded(value))) continue;
    labeled += 1;
    labeledLoss += loss;
  }
  return { labeledLoss, gap: rows.length ? TOP_MARK - voc(rows) : 0, negatives, labeled, coverage: negatives ? labeled / negatives : null };
}

/** J-110: урон жалоб — их доля потерь размеченного негатива × (5 − VOC среза); без доли или базы урона нет. */
export const damageOf = (share, base) => (share === null || share === undefined || !base ? null : share * base.gap);

/** Доля негатива набора оценок против базы; каждая оценка — один раз, даже если стоит в наборе дважды. */
export function negativeShare(rows, base) {
  if (!(base.labeledLoss > 0)) return null;
  let loss = 0;
  for (const row of new Set(rows)) if (row.mark < TOP_MARK) loss += TOP_MARK - row.mark;
  return loss / base.labeledLoss;
}

/* J-129: при малом числе жалоб доля скачет от периода к периоду — строка помечается, значение остаётся */
export const FEW_COMPLAINTS = 10;

/** Значения разреза у оценки без служебных и скрытых меток (J-27, J-32). */
function shownCutValues(cut, reference) {
  const cutValues = PROBLEM_CUTS[cut];
  if (!cutValues) throw new Error(`Неизвестный разрез топа проблем: ${cut}`);
  const label = createLabels(reference);
  const omitted = emptyTopLabels[cut];
  const allowed = (text, emptyLabel) => {
    const normalized = normalizedTopLabel(text);
    return !hiddenTopLabels.has(normalized) && (!emptyLabel || normalized !== emptyLabel);
  };
  /* J-119, J-121: у пары значение проверяется как в своём разрезе, группа — как в своём (скрытая метка прячет пару, J-32) */
  const pair = PAIR_CUTS[cut];
  const shown = (value) => {
    if (!pair) return [value, label(cut, value)].every((text) => allowed(text, omitted));
    const { group, name } = pairParts(value);
    return [name, label(pair.name, name)].every((text) => allowed(text, omitted))
      && [group, label(pair.group, group)].every((text) => allowed(text, null));
  };
  return (row) => cutValues(row, reference).filter(shown);
}

/** Карточки выбранного разреза: доля — от кейсов с обратной связью и выявленной проблемой (J-133), у любого разреза (R-49); порядок — по числу жалоб. */
export function buildProblemCards(previous, current, period, verbatim, mode = 'frequent', { cut = 'problem', limit = 5, reference = null, buckets = [] } = {}) {
  const items = validateVerbatim(verbatim);
  const pair = PAIR_CUTS[cut];
  const valuesOf = shownCutValues(cut, reference);
  if (!current.length) return [];

  const weekdays = weekdayCounts(current);
  const dates = dateCounts(current);
  /* J-133: доля — от кейсов с обратной связью и выявленной проблемой, а не от всех оценок среза */
  const identified = CATEGORY_CUTS.has(cut) ? (row) => valuesOf(row).length > 0 : (row) => hasIdentifiedProblem(row, reference);
  const currentBaseRows = new Set(shareBase(current, items, identified));
  const previousBaseRows = new Set(shareBase(previous, items, identified));
  const currentBase = currentBaseRows.size;
  const previousBase = previousBaseRows.size;
  /* Числитель — те же кейсы базы: жалоба недозвона или без текста в «Жалоб» остаётся, в долю не входит */
  const inBase = (rows, base) => rows.reduce((count, row) => count + (base.has(row) ? 1 : 0), 0);
  const previousGroups = groupByCut(previous, valuesOf);
  const currentGroups = groupByCut(current, valuesOf);
  /* J-128: урон за период и за каждый шаг — по всем оценкам этого отрезка среза */
  const positiveKey = (key) => (cut === 'domainProblem' && pairParts(key).group === POSITIVE_GROUP);
  const base = negativeBase(current, valuesOf, positiveKey);
  const bucketBases = buckets.map(({ from, to }) => negativeBase(current.filter(({ appeal_date: date }) => date >= from && date <= to), valuesOf, positiveKey));

  const cards = [...currentGroups.entries()].map(([key, rows]) => {
    const previousCount = previousGroups.get(key)?.length ?? 0;
    const currentShare = currentBase ? (inBase(rows, currentBaseRows) / currentBase) * 100 : null;
    /*
      Без прошлого периода изменения доли нет — не «выросла с нуля». J-132: и без значения в прошлом периоде —
      проблемы размечаются заново каждый месяц, «было 0» со стрелкой роста стояло бы почти у каждой строки
    */
    const previousShare = previousBase && previousCount ? (inBase(previousGroups.get(key), previousBaseRows) / previousBase) * 100 : null;
    return {
      /* J-113: лента комментариев проблемы — каждая оценка с текстом, свежие сверху; жалобы по сегментам */
      feed: feedOf(rows, items, reference),
      segments: segmentCounts(rows),
      /* J-114: разрезы строки таблицы — ОС, частая версия и триггер с долей в жалобах проблемы, когда чаще */
      os: osCounts(rows),
      version: mostFrequent(rows.map((row) => textOf(items[row.voc_ccode]?.app_version)), rows.length),
      trigger: mostFrequent(rows.flatMap((row) => [...new Set(row.operations ?? [])]), rows.length),
      peak: peakOf(rows, { weekdays, dates }),
      rows,
      key,
      /* Пара — группа и значение отдельно; у ФО и проблематики — ещё под их именами (J-119) */
      ...(pair ? pairParts(key) : {}),
      ...(cut === 'domainProblem' && pairParts(key).group === POSITIVE_GROUP ? { positive: true } : {}),
      ...(cut === 'domainProblem' ? { domain: pairParts(key).group, problem: pairParts(key).name } : {}),
      count: rows.length,
      negativeShare: positiveKey(key) ? null : negativeShare(rows, base),
      buckets: buckets.map(({ from, to }, index) => {
        const inBucket = rows.filter(({ appeal_date: date }) => date >= from && date <= to);
        return { count: inBucket.length, negativeShare: positiveKey(key) || !inBucket.length ? null : negativeShare(inBucket, bucketBases[index]) };
      }),
      /* J-51: частотность прошлого периода рядом с текущей; без прошлого периода — null */
      previousCount: previous.length ? previousCount : null,
      currentShare,
      previousShare,
      shareDelta: previousShare === null || currentShare === null ? null : currentShare - previousShare,
      lastSeen: latestDate(rows),
    };
  }).filter(({ feed }) => feed.length);

  const top = cards.sort(cardOrder(mode)).slice(0, limit);
  /* J-129: база доли негатива — для групп и покрытия в блоке; неперечислимым полем массива: список карточек остаётся списком */
  Object.defineProperty(top, 'negative', { value: { base, buckets: bucketBases } });
  return top;
}

/* Дирекция и продукт выводятся из триггеров через справочник канала (data-model §3.2). */
function operationValues(row, reference, field) {
  const mapping = reference?.operations?.[row.channel] ?? {};
  return [...new Set((row.operations ?? []).map((trigger) => mapping[trigger]?.[field]).filter(Boolean))];
}

/* J-21: escape-переносы и пункты списка восстанавливаются только в экспертизе. */
export function normalizeExpertise(value) {
  const text = textOf(value);
  if (!text) return null;
  return text
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]*(?<![\d.])([1-4]\.)(?=\s|[^\d\s])/g, (match, marker, offset, source) =>
      offset === 0 || source[offset - 1] === '\n' ? marker : `\n${marker}`)
    .trim() || null;
}

/* Строка детализации на оценку не зависит от среза: одна на оценку, тексты и справочник */
const detailByRow = new WeakMap();

/* Строка детализации — оценка с комментарием клиента или экспертизой УИУКО (D-05, J-21). */
export function buildVerbatimRows(rows, verbatim, reference = null) {
  const items = validateVerbatim(verbatim);
  return rows
    .map((row) => {
      const saved = detailByRow.get(row);
      if (saved?.items === items && saved.reference === reference) return saved.detail;
      const detail = detailRow(row, items, reference);
      detailByRow.set(row, { items, reference, detail });
      return detail;
    })
    .filter(Boolean)
    .sort((left, right) => right.date.localeCompare(left.date) || left.vocCcode.localeCompare(right.vocCcode));
}

function detailRow(row, items, reference) {
  const item = items[row.voc_ccode];
  const comment = textOf(item?.client_comment);
  const expertise = normalizeExpertise(item?.oslk_expertise_name);
  if (!comment && !expertise) return null;
  const domains = annotationValues(row, 'domain');
  const problemTypes = annotationValues(row, 'problem_type');
  const problems = annotationValues(row, 'problem');
  return {
    vocCcode: row.voc_ccode,
    channel: row.channel,
    date: row.appeal_date,
    segment: row.segment || null,
    triggers: row.operations ?? [],
    cps: operationValues(row, reference, 'kp'),
    products: operationValues(row, reference, 'product'),
    domain: domains.join(' · ') || null,
    ...(domains.length > 1 ? { domains } : {}),
    problemTypes,
    problemType: problemTypes.join(' · ') || null,
    problems,
    problem: problems.join(' · ') || null,
    role: row.role || null,
    categoryGroup: textOf(item.category_group),
    category: textOf(item.category),
    os: osName(item.device_os),
    appVersion: textOf(item.app_version),
    rating: row.mark,
    comment,
    expertise,
  };
}

/* Столбцы с фильтром по значению: у триггера и КП значений в строке может быть несколько */
const VERBATIM_FILTERS = [
  { key: 'segment', values: (row) => [row.segment] },
  { key: 'triggers', values: (row) => row.triggers },
  { key: 'cps', values: (row) => row.cps },
  { key: 'products', values: (row) => row.products ?? [] },
  { key: 'domain', values: (row) => row.domains ?? [row.domain] },
  { key: 'problemType', values: (row) => row.problemTypes ?? [row.problemType] },
  { key: 'problem', values: (row) => row.problems ?? [row.problem] },
  { key: 'role', values: (row) => [row.role] },
  { key: 'categoryGroup', values: (row) => [row.categoryGroup] },
  { key: 'category', values: (row) => [row.category] },
  { key: 'os', values: (row) => [row.os] },
  { key: 'appVersion', values: (row) => [row.appVersion] },
  { key: 'rating', values: (row) => [String(row.rating)] },
];

const byKey = new Map(VERBATIM_FILTERS.map((filter) => [filter.key, filter]));

/* Значения фильтра — из всей выборки: иначе выбор в одном столбце сужал бы список в другом до тупика */
export function verbatimFilterOptions(rows, key) {
  const values = new Set();
  for (const row of rows) for (const value of byKey.get(key).values(row)) if (value) values.add(value);
  return [...values].sort((left, right) => left.localeCompare(right, 'ru', { numeric: true }));
}

/* Внутри колонки выбранные значения складываются через «или», колонки между собой — через «и» */
export function filterVerbatimRows(rows, selected) {
  const active = Object.entries(selected).filter(([, values]) => values?.length);
  if (!active.length) return rows;
  return rows.filter((row) => active.every(([key, values]) => byKey.get(key).values(row).some((value) => values.includes(value))));
}

/* Сегмент виден кодом, а полная подпись — в подсказке (D-53): искать можно и по ней */
export function searchVerbatimRows(rows, query, label = (dimension, code) => code) {
  const needle = String(query ?? '').trim().toLocaleLowerCase('ru');
  if (!needle) return rows;
  return rows.filter((row) => [...Object.values(row).flat(), label('segment', row.segment)]
    .some((value) => String(value ?? '').toLocaleLowerCase('ru').includes(needle)));
}
