/* Шкала Y в сотых: круглый шаг из ряда, не больше семи подписей (B-01) */
const STEPS = [5, 10, 20, 25, 50, 100];
const MAX_TICKS = 7;
const MIN_SPAN = 20;
const SCALE = { min: 100, max: 500 };

function shown(value) {
  return Math.round(value * 100) / 100;
}

const hundredths = (value) => Math.round(value * 1e4) / 100;

function domainForStep(low, high, step) {
  let min = Math.max(SCALE.min, Math.floor(low / step) * step);
  let max = Math.min(SCALE.max, Math.ceil(high / step) * step);
  while (max - min < MIN_SPAN) {
    if (min > SCALE.min) min -= step;
    if (max < SCALE.max) max += step;
  }
  return { min, max };
}

export function chartDomain(current, previous = [], plan = null) {
  const values = [...current, ...previous]
    .map(({ voc }) => voc)
    .filter((value) => Number.isFinite(value));
  if (Number.isFinite(plan?.min)) values.push(plan.min);
  if (Number.isFinite(plan?.max)) values.push(plan.max);
  if (!values.length) return { min: 1, max: 5, ticks: [1, 2, 3, 4, 5] };

  const low = Math.floor(hundredths(Math.min(...values)));
  const high = Math.ceil(hundredths(Math.max(...values)));
  const step = STEPS.find((candidate) => {
    const { min, max } = domainForStep(low, high, candidate);
    return (max - min) / candidate + 1 <= MAX_TICKS;
  });
  const { min, max } = domainForStep(low, high, step);

  const ticks = [];
  for (let value = min; value <= max; value += step) ticks.push(value / 100);
  return { min: min / 100, max: max / 100, ticks };
}

export function plotPoints(series, { width, height, min, max }) {
  const last = Math.max(1, series.length - 1);
  return series.map(({ voc }, index) => ({
    index,
    x: shown(series.length === 1 ? width / 2 : (index / last) * width),
    y: Number.isFinite(voc) ? shown(height - ((voc - min) / (max - min)) * height) : null,
    value: Number.isFinite(voc) ? voc : null,
  }));
}

/* Контрольная точка в пределах сегмента: кривая не рисует экстремум, которого нет в данных, и не выходит за шкалу */
const withinSegment = (y, start, end) => Math.min(Math.max(y, Math.min(start.y, end.y)), Math.max(start.y, end.y));

function runSegments(run) {
  return run.slice(0, -1).map((start, index) => {
    const before = run[index - 1] ?? start;
    const end = run[index + 1];
    const after = run[index + 2] ?? end;
    const control1 = {
      x: shown(start.x + (end.x - before.x) / 6),
      y: shown(withinSegment(start.y + (end.y - before.y) / 6, start, end)),
    };
    const control2 = {
      x: shown(end.x - (after.x - start.x) / 6),
      y: shown(withinSegment(end.y - (after.y - start.y) / 6, start, end)),
    };
    return { start, control1, control2, end };
  });
}

function pathForRun(run) {
  const curves = runSegments(run).map(({ control1, control2, end }) => ` C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${end.x} ${end.y}`);
  return `M ${run[0].x} ${run[0].y}${curves.join('')}`;
}

function cubicAt({ start, control1, control2, end }, t) {
  const u = 1 - t;
  const at = (key) => u ** 3 * start[key] + 3 * u ** 2 * t * control1[key] + 3 * u * t ** 2 * control2[key] + t ** 3 * end[key];
  return { x: at('x'), y: at('y') };
}

function continuousRuns(points) {
  const runs = [];
  let run = [];
  for (const point of points) {
    if (point.y === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(point);
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

export function linePaths(points) {
  return continuousRuns(points).map(pathForRun);
}

export function areaPaths(points, baseline) {
  return continuousRuns(points).map((run) => {
    const first = run[0];
    const last = run.at(-1);
    return `${pathForRun(run)} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
  });
}

/* Пропуск интервала — пунктирный мост между соседними участками: ряд читается одной линией, а пропуск виден (D-54) */
export function gapPaths(points) {
  const runs = continuousRuns(points);
  return runs.slice(1).map((run, index) => {
    const end = runs[index].at(-1);
    return `M ${end.x} ${end.y} L ${run[0].x} ${run[0].y}`;
  });
}

/* Точки нарисованной линии и мостов не дальше step друг от друга: препятствие для подписей без измерения пути в DOM */
export function curveSamples(points, step) {
  const runs = continuousRuns(points);
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  /* Скорость кривой Безье не больше трёх длин самого длинного плеча её ломаной: шаг по t с запасом */
  const along = (reach, at) => {
    const steps = Math.max(1, Math.ceil(reach / step));
    return Array.from({ length: steps }, (_, index) => at(index / steps));
  };
  const curves = runs.flatMap((run) => [
    ...runSegments(run).flatMap((segment) => {
      const { start, control1, control2, end } = segment;
      return along(3 * Math.max(distance(start, control1), distance(control1, control2), distance(control2, end)), (t) => cubicAt(segment, t));
    }),
    run.at(-1),
  ]);
  const bridges = runs.slice(1).flatMap((run, index) => {
    const [start, end] = [runs[index].at(-1), run[0]];
    return along(distance(start, end), (t) => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }));
  });
  return [...curves, ...bridges].map(({ x, y }) => ({ x, y }));
}

const overlaps = (a, b, gap) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap
  && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
const within = (box, bounds) => box.x >= bounds.x && box.y >= bounds.y
  && box.x + box.width <= bounds.x + bounds.width && box.y + box.height <= bounds.y + bounds.height;

/* Подпись берёт первое свободное место из своих; экстремуму, которому иначе некуда, разрешено лечь на линию (B-03) */
export function placeLabels(labels, { marks, line, bounds, gap = 0 }) {
  const taken = [...marks];
  const crossings = (box) => line.filter((point) => overlaps(box, { ...point, width: 0, height: 0 }, gap)).length;
  const open = (box) => within(box, bounds) && !taken.some((other) => overlaps(box, other, gap));
  return labels.map(({ boxes, extreme }) => {
    let choice = boxes.findIndex((box) => open(box) && crossings(box) === 0);
    /* Экстремум без чистого места ложится туда, где линия задевает его меньше всего */
    if (choice < 0 && extreme) {
      const fits = boxes.map((box, index) => ({ index, cost: open(box) ? crossings(box) : Infinity })).filter(({ cost }) => cost < Infinity);
      choice = fits.reduce((best, fit) => (best && best.cost <= fit.cost ? best : fit), null)?.index ?? -1;
    }
    if (choice >= 0) taken.push(boxes[choice]);
    return choice;
  });
}

/* Порядок подписей значений: при коллизии остаётся экстремум — сначала минимум и максимум ряда, затем пики и впадины по выраженности */
export function labelOrder(values) {
  const finite = values.filter(Number.isFinite);
  const [min, max] = [Math.min(...finite), Math.max(...finite)];
  const rank = (index) => {
    const value = values[index];
    const previous = Number.isFinite(values[index - 1]) ? values[index - 1] : value;
    const next = Number.isFinite(values[index + 1]) ? values[index + 1] : value;
    const turn = (value >= previous && value >= next) || (value <= previous && value <= next);
    const level = value === min || value === max ? 2 : turn && (value !== previous || value !== next) ? 1 : 0;
    return { level, prominence: Math.abs(value - (previous + next) / 2) };
  };
  const ranks = values.map((_, index) => rank(index));
  return values.map((_, index) => index)
    .filter((index) => Number.isFinite(values[index]))
    .sort((left, right) => ranks[right].level - ranks[left].level || ranks[right].prominence - ranks[left].prominence || left - right);
}

/** Столбец наведения каждой точки: до середины шага к соседям, крайние — до края области построения. */
export function hitColumns(points, width) {
  return points.map(({ x }, index) => ({
    left: index > 0 ? (points[index - 1].x + x) / 2 : 0,
    right: index < points.length - 1 ? (x + points[index + 1].x) / 2 : width,
  }));
}

/* Шкала числа оценок справа: два круглых шага из ряда 1 · 2 · 2,5 · 5 × 10ⁿ, верх не ниже максимума столбика */
const COUNT_STEPS = [1, 2, 2.5, 5];

export function countAxis(maxCount, steps = 2) {
  const need = Math.max(Number(maxCount) || 0, 1) / steps;
  const power = 10 ** Math.floor(Math.log10(need));
  /* Шаг — целое число оценок: 2,5 оценки на подписи оси читаются как ошибка */
  const step = [...COUNT_STEPS, 10].map((factor) => factor * power)
    .find((candidate) => candidate >= need && Number.isInteger(candidate)) ?? Math.ceil(need);
  return { max: step * steps, ticks: Array.from({ length: steps + 1 }, (_, index) => index * step) };
}

/*
  J-86: шаг шкалы урона — в баллах VOC, «круглый» и не мельче показанной сотой.
  J-97: верх шкалы — сам максимум, а не следующий круглый шаг: разница столбиков занимает всю высоту.
  Основание остаётся нулём, высоты столбиков пропорциональны урону. Отметки — круглые значения не выше максимума
*/
export function damageAxis(maxDamage, steps = 2) {
  const peak = Math.max(Number(maxDamage) || 0, 0.01);
  const need = peak / steps;
  const power = 10 ** Math.floor(Math.log10(need));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= need * (1 - 1e-9));
  const shown = Math.max(Math.ceil(step * 100 - 1e-9) / 100, 0.01);
  const ticks = Array.from({ length: steps + 1 }, (_, index) => index * shown).filter((tick) => tick <= peak + 1e-9);
  return { max: peak, ticks };
}

/*
  Подписи дат — каждая k-я точка с шагом не уже подписи и зазора. Крайние прижаты к краю области и
  выступают внутрь на всю ширину, поэтому до соседа им нужно полторы подписи; последняя точка подписана всегда.
*/
export function xLabelIndices(width, length, labelWidth, gap = 16) {
  if (length <= 1) return length ? [0] : [];
  const spacing = width / (length - 1);
  const clearance = labelWidth * 1.5 + gap;
  const step = Math.max(1, Math.ceil(clearance / spacing));
  const indices = [];
  for (let index = 0; index < length - 1; index += step) indices.push(index);
  while (indices.length > 1 && (length - 1 - indices.at(-1)) * spacing < clearance) indices.pop();
  if ((length - 1) * spacing >= clearance) indices.push(length - 1);
  return indices;
}

/* Плашка перекрестья у оси — по центру своей отметки, но целиком внутри отведённого отрезка */
export function pillStart(center, size, min, max) {
  return Math.min(Math.max(center - size / 2, min), max - size);
}

/*
  Тон линии относительно коридора плана меняется плавно по высоте, а не скачком на границе (J-15, Figma 3204:2951):
  зелёный выше → серый в коридоре → красный ниже. `fade` — ширина перехода в единицах области построения.
  Общий для графика динамики и широкой линии дайджеста (J-160)
*/
export function planZoneStops(top, bottom, height, fade) {
  const half = fade / 2;
  const inner = Math.min(half, (bottom - top) / 2);
  const offset = (y) => (height > 0 ? Math.min(1, Math.max(0, y / height)) : 0);
  return [[top - half, 'above'], [top + inner, 'in-plan'], [bottom - inner, 'in-plan'], [bottom + half, 'below']]
    .map(([y, zone]) => ({ offset: offset(y), zone }));
}
