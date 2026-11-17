import { annotationValues } from './annotations.js';
import { complaintAnnotations, complaintValues, categoryValues } from './analytical-causes.js';
import { latestDate, weekdayOf } from './dates.js';
import { OS_ANDROID, OS_IOS, osCode, osName } from './dimensions.js';
import { createLabels, normalizeLabel } from './labels.js';
import { CATEGORY_CUT } from './antidrivers.js';
import { voc } from './metrics.js';
import { formatNumber, monthGenitive } from './format.js';

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
export const NO_DOMAIN = 'Без функ. области';
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
  Разметка со справочником проблематик: ключ строки — `problem_id`, название — `problem_final` (обычно оно и есть
  `problem`), группа — итоговая ФО `domain_final`. Свободная формулировка `problem` бывает разной у одной проблематики,
  а `domain` — у одной проблематики разным: группировка по ним дробила проблематику. Оценка входит в проблематику один
  раз, сколько бы строк разметки с этим ключом у неё ни было. Метка без `problem_id` — месяц прежней разметки в том же
  срезе или прошлый период — не пропадает: она встаёт в проблематику с тем же названием (`problem` прежней разметки —
  это `suggested_replacement`, то есть название проблематики), иначе — прежней парой `domain` и `problem`. В новой
  разметке у строки без ключа нет и `problem`, поэтому она по-прежнему не считается.
  Ключ отличается от названия невидимым префиксом — название подставляется в карточке
*/
const PROBLEM_ID = '\u001d';
const problemIdOf = (annotation) => textOf(annotation.problem_id);
const annotationsOf = (row) => (row.annotations?.length ? row.annotations : [row]);
export const hasProblemIds = (rows) => rows.some((row) => annotationsOf(row).some(problemIdOf));
const idKey = (annotation) => `${PROBLEM_ID}${problemIdOf(annotation)}`;
const keyProblemId = (name) => (name?.startsWith(PROBLEM_ID) ? name.slice(PROBLEM_ID.length) : null);
const idGroup = (annotation) => (isPositive(annotation) ? POSITIVE_GROUP
  : textOf(annotation.domain_final) ?? textOf(annotation.domain) ?? NO_DOMAIN);
/* `byName` — ключ строки проблематики по её названию: метка прежней разметки встаёт в ту же строку */
const idCut = ({ byName }) => (row, reference) => [...new Set(complaintAnnotations(row, reference).flatMap((annotation) => {
  if (problemIdOf(annotation)) return [pairKey(idGroup(annotation), idKey(annotation))];
  const problem = textOf(annotation.problem);
  if (!problem) return [];
  return [(!isPositive(annotation) && byName.get(problem)) || pairKey(isPositive(annotation) ? POSITIVE_GROUP : textOf(annotation.domain) ?? NO_DOMAIN, problem)];
}))];
/* Название проблематики — первое у ключа; без `problem_final` в выгрузке — `problem` той же строки */
function problemNames(rows) {
  const names = new Map();
  const byName = new Map();
  for (const row of rows) {
    for (const annotation of annotationsOf(row)) {
      const id = problemIdOf(annotation);
      const name = textOf(annotation.problem_final) ?? textOf(annotation.problem);
      if (!id || !name) continue;
      if (!names.has(id)) names.set(id, name);
      if (!byName.has(name) && !isPositive(annotation)) byName.set(name, pairKey(idGroup(annotation), idKey(annotation)));
    }
  }
  return { names, byName };
}

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
/** Экспертиза без установленной причины — недозвон или отказ от ОС; одной фразой их не различить (J-134). */
export const isNoReasonExpertise = (text) => NO_REASON.test(normalizedTopLabel(text));
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
  const value = Boolean(textOf(item?.client_comment)) || (Boolean(expertise) && !isNoReasonExpertise(expertise));
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

function versionsByOs(rows, items) {
  const of = (name) => {
    const platform = rows.filter((row) => osName(row.device_os) === name);
    return mostFrequent(platform.map((row) => textOf(items[row.voc_ccode]?.app_version)), platform.length);
  };
  return { ios: of('iOS'), and: of('Android') };
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
    /* Закономерности по одной: таблица ставит каждую своей строкой, а не одной строкой через точку */
    lines: top.map(({ label }) => label),
    title: top.map(({ label, ratio, title }) => `${label}${title ? ` (${title})` : ''}: доля жалоб в ${formatNumber(ratio, 1)} раза выше обычной`).join('; '),
  };
}

/*
  Лента значения. У разметки со справочником проблематик (`problemId`) текст отзыва — цитата строки разметки этой
  проблематики (`quotes` в verbatim), а не комментарий обращения: у обращения с несколькими проблемами под каждой — своя
  цитата, и обращение без комментария клиента (жалоба только в экспертизе) не пропадает. Цитата из экспертизы помечена.
  Без цитаты — комментарий клиента, как без разметки
*/
function feedOf(rows, items, reference, problemId = null) {
  return rows
    .map((row) => {
      const quote = problemId ? items[row.voc_ccode]?.quotes?.[problemId] : null;
      const text = textOf(quote?.text);
      return { id: row.voc_ccode, date: row.appeal_date, rating: row.mark, segment: segmentOf(row), comment: text ?? commentFor(items, row),
        ...(text && quote.expertise ? { expertise: true } : {}),
      products: operationValues(row, reference, 'product'), triggers: row.operations ?? [],
      /* J-114: ОС и версия приложения — сразу у цитаты; версия есть только у АБМ, у других каналов поле пустое */
      os: row.device_os ? osName(row.device_os) : null, version: textOf(items[row.voc_ccode]?.app_version) };
    })
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

/*
  J-348: накал жалоб — по тону эмоции, а не по точной эмоции: слепая проверка разметки показала, что тон и накал
  надёжны, а соседние эмоции путаются. Тон: негатив, позитив, нейтрально; без эмоции (нет комментария или месяц
  не размечен) — «нет данных». «Нет» — это данные: эмоции нет, тон нейтральный
*/
export const NEGATIVE_EMOTIONS = ['Злость', 'Разочарование', 'Тревога', 'Усталость', 'Растерянность', 'Недоверие'];
export const POSITIVE_EMOTIONS = ['Удовлетворение'];
/*
  Подписи накала — одна константа на дашборд (правка пользователя): 0 — «Нет», 1 — «Слабый», 2 — «Выраженный»,
  3 — «Острый»; расшифровка — в подсказку. Накалённая жалоба — негативный тон с накалом «Выраженный» или «Острый»
  (от 2): «острый» — только 3, поэтому доля и сортировка называются «накалённые»
*/
export const INTENSITY_LABELS = ['Нет', 'Слабый', 'Выраженный', 'Острый'];
export const INTENSITY_HINTS = ['накала нет', 'сожаление, сдержанная претензия', 'явная претензия', 'угроза уйти, деньги под угрозой, ругань'];
export const intensityLabel = (intensity) => INTENSITY_LABELS[intensity] ?? null;

/* Месяц начала разметки эмоций (YYYY-MM) — по самой ранней размеченной оценке среза; разметки нет — null.
   Месяцы раньше него — «нет разметки», а не накал 0 */
export function emotionsLabelledSince(rows) {
  let first = null;
  for (const row of rows) {
    if ((row.emotion ?? null) === null || !row.appeal_date) continue;
    if (first === null || row.appeal_date < first) first = row.appeal_date;
  }
  return first === null ? null : first.slice(0, 7);
}

/*
  Подпись блока, когда период шапки начинается раньше разметки: «Эмоции размечены с сентября»; иначе — null.
  Месяц начала — `context.emotions.labelledFrom` (первый размеченный месяц канала, импорт); без него — по данным среза
*/
export function emotionsNoteFor(context) {
  const from = context.emotions?.labelledFrom ?? emotionsLabelledSince(context.rows ?? context.slice ?? []);
  return emotionsSinceNote(context.period, from ? String(from).slice(0, 7) : null);
}
/* Подпись блока, когда период шапки начинается раньше разметки: «Эмоции размечены с сентября»; иначе — null */
export function emotionsSinceNote(period, since) {
  if (!since || !period?.from || period.from.slice(0, 7) >= since) return null;
  return `Эмоции размечены с ${monthGenitive(since)}`;
}
export const SHARP_INTENSITY = 2;
/* Доля накалённых — от 5 комментариев с негативным тоном: на меньшем числе доля скачет, показывается их число */
export const HEAT_MIN_NEGATIVE = 5;

export function emotionTone(emotion) {
  if (emotion === null || emotion === undefined) return null;
  if (NEGATIVE_EMOTIONS.includes(emotion)) return 'negative';
  return POSITIVE_EMOTIONS.includes(emotion) ? 'positive' : 'neutral';
}

export const isSharp = (row) => emotionTone(row.emotion ?? null) === 'negative' && (row.emotion_intensity ?? -1) >= SHARP_INTENSITY;

/*
  Полоса зон накала (J-348): четыре зоны по накалу 0–3 среди размеченных комментариев с негативным тоном — позитив и
  нейтральное в полосу не входят. Ширина зоны — доля жалоб в ней, число — над зоной
*/
export const HEAT_ZONES = [0, 1, 2, 3];
export const inHeatZone = (row, zone) => emotionTone(row.emotion ?? null) === 'negative' && (row.emotion_intensity ?? null) === zone;
export function heatZones(rows) {
  const counts = HEAT_ZONES.map((zone) => ({ zone, count: 0 }));
  for (const row of rows) {
    if (emotionTone(row.emotion ?? null) !== 'negative') continue;
    const intensity = row.emotion_intensity ?? null;
    if (HEAT_ZONES.includes(intensity)) counts[intensity].count += 1;
  }
  const total = counts.reduce((sum, { count }) => sum + count, 0);
  return { total, zones: counts.map((zone) => ({ ...zone, share: total ? (zone.count / total) * 100 : 0 })) };
}

/*
  Блок «Эмоции» (J-348): точные эмоции по группам тона, у каждой — всего и по накалу 0–3. База — размеченные
  комментарии: у оценки без комментария поля эмоции пусты, она не считается. Точная эмоция размечена с меньшей
  уверенностью, чем тон и накал, — поэтому группы тона идут заголовками, а точная эмоция — строками под ними
*/
export const EMOTION_TONES = [
  { tone: 'negative', label: 'Негатив', emotions: NEGATIVE_EMOTIONS },
  { tone: 'neutral', label: 'Нейтрально', emotions: ['Пожелание', 'Нет'] },
  { tone: 'positive', label: 'Позитив', emotions: POSITIVE_EMOTIONS },
];
export const EMOTION_INTENSITIES = [0, 1, 2, 3];

const emptyCounts = () => ({ total: 0, byIntensity: EMOTION_INTENSITIES.map(() => 0) });
function addTo(counts, intensity) {
  counts.total += 1;
  if (EMOTION_INTENSITIES.includes(intensity)) counts.byIntensity[intensity] += 1;
}

export function emotionTable(rows) {
  const byEmotion = new Map(EMOTION_TONES.flatMap(({ emotions }) => emotions.map((emotion) => [emotion, emptyCounts()])));
  const byTone = new Map(EMOTION_TONES.map(({ tone }) => [tone, emptyCounts()]));
  let total = 0;
  for (const row of rows) {
    const emotion = row.emotion ?? null;
    const tone = emotionTone(emotion);
    if (tone === null) continue;
    total += 1;
    const intensity = row.emotion_intensity ?? null;
    addTo(byTone.get(tone), intensity);
    if (byEmotion.has(emotion)) addTo(byEmotion.get(emotion), intensity);
  }
  return {
    total,
    groups: EMOTION_TONES.map(({ tone, label, emotions }) => ({
      tone, label, ...byTone.get(tone),
      rows: emotions.map((emotion) => ({ emotion, ...byEmotion.get(emotion) })),
    })),
  };
}

/** Выбор блока «Эмоции»: { tone? | emotion?, intensities? } — тон или эмоция и, если заданы, накал из списка. */
export function inEmotionPick(row, pick) {
  const emotion = row.emotion ?? null;
  if (emotion === null) return false;
  if (pick.emotion !== undefined && emotion !== pick.emotion) return false;
  if (pick.tone !== undefined && emotionTone(emotion) !== pick.tone) return false;
  if (pick.intensities && !pick.intensities.includes(row.emotion_intensity ?? null)) return false;
  return true;
}

/** Лента выбора: комментарии клиента оценок, свежие сверху — как лента «Топ проблем». */
export const emotionFeed = (rows, verbatim, reference = null) => feedOf(rows, validateVerbatim(verbatim), reference);

/*
  Накал строк: база — размеченные комментарии (эмоция не null: у оценки без комментария поля эмоции пусты),
  острые — негативный тон с накалом ≥ 2; средний накал — по комментариям с негативным тоном.
  Ни одного размеченного комментария — null, «нет данных», а не 0
*/
export function heatOf(rows, base = rows) {
  /* База (размеченные и негатив) — `base`, острые и средний накал — `rows`: при зоне накала (J-348) острые — жалобы
     зоны, а база — все комментарии проблемы, как у доли и урона «жалобы зоны от всех оценок среза» */
  let labelled = 0;
  let negative = 0;
  for (const row of base) {
    const tone = emotionTone(row.emotion ?? null);
    if (tone === null) continue;
    labelled += 1;
    if (tone === 'negative') negative += 1;
  }
  if (!labelled) return null;
  let sharp = 0;
  let intensitySum = 0;
  let intensityCount = 0;
  for (const row of rows) {
    if (emotionTone(row.emotion ?? null) !== 'negative') continue;
    const intensity = row.emotion_intensity ?? null;
    if (intensity === null) continue;
    intensitySum += intensity;
    intensityCount += 1;
    if (intensity >= SHARP_INTENSITY) sharp += 1;
  }
  return {
    labelled,
    negative,
    sharp,
    share: negative >= HEAT_MIN_NEGATIVE ? (sharp / labelled) * 100 : null,
    averageIntensity: intensityCount ? intensitySum / intensityCount : null,
  };
}

/** Значения разреза у оценки без служебных и скрытых меток (J-27, J-32). */
function shownCutValues(cut, reference, markup = null) {
  const cutValues = markup ? idCut(markup) : PROBLEM_CUTS[cut];
  const names = markup?.names;
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
    const { group, name: key } = pairParts(value);
    const id = names ? keyProblemId(key) : null;
    const name = id ? names.get(id) ?? id : key;
    return [name, label(pair.name, name)].every((text) => allowed(text, omitted))
      && [group, label(pair.group, group)].every((text) => allowed(text, null));
  };
  return (row) => cutValues(row, reference).filter(shown);
}

/** Карточки выбранного разреза: доля — от кейсов с обратной связью и выявленной проблемой (J-133), у любого разреза (R-49); порядок — по числу жалоб. */
/*
  `only` — сужение жалоб строк (J-348: зона накала): группы и их жалобы — только из подходящих оценок, а базы доли,
  доли негатива и урона — от всего среза: доля и урон зоны сравнимы с обычными, а не пересчитаны от её подмножества
*/
export function buildProblemCards(previous, current, period, verbatim, mode = 'frequent', { cut = 'problem', limit = 5, reference = null, buckets = [], only = null } = {}) {
  const items = validateVerbatim(verbatim);
  const pair = PAIR_CUTS[cut];
  /* Выгрузка с ключом проблематики справочника группирует по нему; старая — по `problem` и `domain` */
  const markup = cut === 'domainProblem' && (hasProblemIds(current) || hasProblemIds(previous)) ? problemNames([...current, ...previous]) : null;
  const names = markup?.names;
  const valuesOf = shownCutValues(cut, reference, markup);
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
  const narrowed = (rows) => (only ? rows.filter(only) : rows);
  const previousLabelled = previous.some((row) => (row.emotion ?? null) !== null);
  const previousGroups = groupByCut(narrowed(previous), valuesOf);
  const currentGroups = groupByCut(narrowed(current), valuesOf);
  /* База накала проблемы — все её комментарии: при зоне острые — жалобы зоны, база та же, что у доли и урона */
  const fullGroups = only ? groupByCut(current, valuesOf) : currentGroups;
  /* J-128: урон за период и за каждый шаг — по всем оценкам этого отрезка среза */
  const positiveKey = (key) => (cut === 'domainProblem' && pairParts(key).group === POSITIVE_GROUP);
  const base = negativeBase(current, valuesOf, positiveKey);
  const bucketBases = buckets.map(({ from, to }) => negativeBase(current.filter(({ appeal_date: date }) => date >= from && date <= to), valuesOf, positiveKey));

  const cards = [...currentGroups.entries()].map(([key, rows]) => {
    const problemId = names ? keyProblemId(pairParts(key).name) : null;
    const parts = pair ? pairParts(key) : {};
    if (problemId) parts.name = names.get(problemId) ?? problemId;
    const previousCount = previousGroups.get(key)?.length ?? 0;
    const currentShare = currentBase ? (inBase(rows, currentBaseRows) / currentBase) * 100 : null;
    /*
      Без прошлого периода изменения доли нет — не «выросла с нуля». J-132: и без значения в прошлом периоде —
      проблемы размечаются заново каждый месяц, «было 0» со стрелкой роста стояло бы почти у каждой строки
    */
    const previousShare = previousBase && previousCount && (!only || previousLabelled) ? (inBase(previousGroups.get(key), previousBaseRows) / previousBase) * 100 : null;
    return {
      /* J-113: лента комментариев проблемы — каждая оценка с текстом, свежие сверху; жалобы по сегментам */
      feed: feedOf(rows, items, reference, problemId),
      segments: segmentCounts(rows),
      /* J-114: разрезы строки таблицы — ОС, частая версия и триггер с долей в жалобах проблемы, когда чаще */
      os: osCounts(rows),
      /* J-190: частая версия — у каждой ОС своя, доля — от жалоб проблемы с этой ОС: номера версий iOS и Android не сравнимы */
      versions: versionsByOs(rows, items),
      trigger: mostFrequent(rows.flatMap((row) => [...new Set(row.operations ?? [])]), rows.length),
      peak: peakOf(rows, { weekdays, dates }),
      rows,
      key,
      /* Пара — группа и значение отдельно; у ФО и проблематики — ещё под их именами (J-119) */
      ...parts,
      ...(problemId ? { problemId } : {}),
      ...(cut === 'domainProblem' && parts.group === POSITIVE_GROUP ? { positive: true } : {}),
      ...(cut === 'domainProblem' ? { domain: parts.group, problem: parts.name } : {}),
      count: rows.length,
      negativeShare: positiveKey(key) ? null : negativeShare(rows, base),
      buckets: buckets.map(({ from, to }, index) => {
        const inBucket = rows.filter(({ appeal_date: date }) => date >= from && date <= to);
        return { count: inBucket.length, negativeShare: positiveKey(key) || !inBucket.length ? null : negativeShare(inBucket, bucketBases[index]) };
      }),
      /* J-51: частотность прошлого периода рядом с текущей; без прошлого периода — null */
      /* При зоне накала прошлый период без разметки эмоций — «нет данных», а не 0 жалоб зоны */
      previousCount: previous.length && (!only || previousLabelled) ? previousCount : null,
      currentShare,
      previousShare,
      shareDelta: previousShare === null || currentShare === null ? null : currentShare - previousShare,
      lastSeen: latestDate(rows),
      /* J-348: накал — доля накалённых жалоб среди размеченных комментариев проблемы */
      heat: heatOf(rows, fullGroups.get(key) ?? rows),
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

/*
  Пара «группа + значение» — ключ групповых фильтров детализации: одна проблема под двумя ФО или одна категория
  под двумя группами негатива — два разных выбора, выбор группы находит ровно её строки
*/
export const FILTER_PAIR_SEPARATOR = '\u001f';
export const filterPair = (group, value) => `${group ?? ''}${FILTER_PAIR_SEPARATOR}${value}`;
export function filterPairParts(key) {
  const at = key.indexOf(FILTER_PAIR_SEPARATOR);
  return at < 0 ? [null, key] : [key.slice(0, at) || null, key.slice(at + FILTER_PAIR_SEPARATOR.length)];
}

/* Пары «ФО + проблема» оценки — из каждой метки: проблема под несколькими ФО даёт несколько пар */
function problemPairsOf(row) {
  const pairs = new Map();
  for (const annotation of (row.annotations?.length ? row.annotations : [row])) {
    const problem = textOf(annotation.problem);
    if (!problem) continue;
    const domain = textOf(annotation.domain);
    pairs.set(filterPair(domain, problem), [domain, problem]);
  }
  return [...pairs.values()];
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
    /* ФО каждой проблемы — из её метки: фильтр «Проблема» выбирает пары «ФО + проблема» */
    problemPairs: problemPairsOf(row),
    role: row.role || null,
    categoryGroup: textOf(item.category_group),
    category: textOf(item.category),
    os: osName(item.device_os),
    appVersion: textOf(item.app_version),
    rating: row.mark,
    comment,
    expertise,
    /* J-348: точная эмоция, накал и признаки — только в детализации; цитата эмоции — текст клиента, из lazy verbatim */
    emotion: row.emotion ?? null,
    intensity: row.emotion_intensity ?? null,
    signals: signalsOf(row),
    emotionQuote: textOf(item?.emotion_quote),
    /*
      Пины клиента — персональные данные, только из lazy verbatim: колонки таблицы детализации и её Excel.
      Не в ratings, не в URL, не в копировании отзыва с контекстом
    */
    uPin: textOf(item?.legalclientid),
    xPin: textOf(item?.legclientauthorizedpersonid),
  };
}

/*
  Признаки отзыва — тегами одной колонки: флаги разметки, надёжные в слепой проверке, — «Угроза уйти», «Повтор»
  (повторяющееся событие — правило пересмотрено) и «Деньги под угрозой»; сарказм не проверен — поле в данных есть,
  но не показывается.
  «Скрытый негатив» — оценка 4–5 с накалённой жалобой (негативный тон, накал от «Выраженного»): клиент поставил
  высокую оценку, но пишет резко. Фильтр, не метрика
*/
export const SIGNALS = [
  ['churn_threat', 'Угроза уйти'],
  ['repeat_issue', 'Повтор'],
  ['money_at_risk', 'Деньги под угрозой'],
];
export const HIDDEN_NEGATIVE = 'Скрытый негатив';
export const isHiddenNegative = (row) => row.mark >= 4 && isSharp(row);
function signalsOf(row) {
  const signals = SIGNALS.filter(([field]) => row[field] === true).map(([, name]) => name);
  return isHiddenNegative(row) ? [...signals, HIDDEN_NEGATIVE] : signals;
}

/*
  Три классификации жалобы — откуда каждая: одна формулировка для подсказок разреза, шапок «Топ проблем»,
  колонок «Обратной связи» и «Как считаются данные». «ДКО» не расшифровывается: расшифровка не подтверждена
*/
export const CLASSIFICATION_HINTS = {
  trigger: 'Операция, после которой клиент поставил оценку; из выгрузки',
  dko: 'Категория недовольства, присвоенная оценке при разборе; из выгрузки',
  labeling: 'Наша разметка комментария и экспертизы по справочнику проблематик: функциональная область и конкретная проблема',
};

/* Столбцы с фильтром по значению: у триггера и КП значений в строке может быть несколько */
const VERBATIM_FILTERS = [
  { key: 'segment', values: (row) => [row.segment] },
  { key: 'triggers', values: (row) => row.triggers },
  { key: 'cps', values: (row) => row.cps },
  { key: 'products', values: (row) => row.products ?? [] },
  { key: 'domain', values: (row) => row.domains ?? [row.domain] },
  { key: 'problemType', values: (row) => row.problemTypes ?? [row.problemType] },
  /* Проблема и категория — парой с группой (filterPair): фильтр с группами выбирает значение именно этой группы */
  { key: 'problem', values: (row) => (row.problemPairs ?? []).map(([domain, problem]) => filterPair(domain, problem)) },
  { key: 'role', values: (row) => [row.role] },
  { key: 'categoryGroup', values: (row) => [row.categoryGroup] },
  { key: 'category', values: (row) => (row.category ? [filterPair(row.categoryGroup, row.category)] : []) },
  { key: 'os', values: (row) => [row.os] },
  { key: 'appVersion', values: (row) => [row.appVersion] },
  { key: 'rating', values: (row) => [String(row.rating)] },
  { key: 'emotion', values: (row) => [row.emotion] },
  { key: 'intensity', values: (row) => [intensityLabel(row.intensity)] },
  { key: 'signals', values: (row) => row.signals ?? [] },
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
