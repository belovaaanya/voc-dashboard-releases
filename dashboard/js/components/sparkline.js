/* Sparkline (C-05, Figma 3030:3263, 3030:3283): сглаженная линия цвета тона без осей и точки ряда на ней; шаг точек — D-52 */

import { areaPaths, linePaths, planZoneStops, plotPoints } from '../core/chart-geometry.js';
import { element, svgNode } from '../ui/dom.js';

const VIEWBOX = { width: 91, height: 28 };
const DOT_RADIUS = 1.5;
/*
  Скругление коридора плана — токен --radius-plan-band-line в пикселях экрана (неделя 16–22.11, везде скруглённый);
  блок может дать свой радиус через --sparkline-band-radius (плитки ролей).
  Растянутая линия масштабируется по осям по-разному: rx и ry в единицах viewBox пересчитываются по реальному размеру,
  иначе угол вытягивался бы в эллипс. До замера — запасное значение
*/
const BAND_RADIUS_FALLBACK = 4;
/* Прогрессивное размытие коридора (planBandLayers): радиус слева в пикселях экрана и переход долями длины — макет плитки роли */
const BAND_BLUR_PX = 4;
const BAND_FADE = [0.38, 1];

function roundBands(svg) {
  /* Полосы коридора — прямые дети svg; ровный `crispBand` с границами-линиями остаётся прямоугольным */
  /* Слои прогрессивного размытия лежат в группах масок — ищем во всём svg */
  const rects = () => [...(svg.querySelectorAll?.('.sparkline__band') ?? [])].filter((node) => {
    const names = (node.getAttribute?.('class') ?? '').split(' ');
    return !names.includes('sparkline__band--crisp');
  });
  const apply = () => {
    const width = svg.clientWidth;
    const height = svg.clientHeight;
    if (!width || !height) return;
    const style = globalThis.getComputedStyle?.(svg);
    const own = parseFloat(style?.getPropertyValue('--sparkline-band-radius'));
    const token = Number.isFinite(own) ? own : parseFloat(style?.getPropertyValue('--radius-plan-band-line'));
    const radius = Number.isFinite(token) ? token : BAND_RADIUS_FALLBACK;
    for (const rect of rects()) {
      const rectWidth = Number(rect.getAttribute('width'));
      const rectHeight = Number(rect.getAttribute('height'));
      rect.setAttribute('rx', Math.min((radius * VIEWBOX.width) / width, rectWidth / 2));
      rect.setAttribute('ry', Math.min((radius * VIEWBOX.height) / height, rectHeight / 2));
    }
    /* Радиус прогрессивного размытия — в пикселях экрана: растянутая линия масштабирует единицы по Y */
    for (const blur of svg.querySelectorAll?.('.plan-band__deviation') ?? []) blur.setAttribute('stdDeviation', `0 ${(BAND_BLUR_PX * VIEWBOX.height) / height}`);
  };
  /* До замера — радиус по типовому размеру: узкая линия 91 × 28 без растяжения, широкая — около 300 × 60 */
  const wide = svg.getAttribute('preserveAspectRatio') === 'none';
  const [estimateX, estimateY] = wide ? [VIEWBOX.width / 300, VIEWBOX.height / 60] : [1, 1];
  for (const rect of rects()) {
    rect.setAttribute('rx', Math.min(BAND_RADIUS_FALLBACK * estimateX, Number(rect.getAttribute('width')) / 2));
    rect.setAttribute('ry', Math.min(BAND_RADIUS_FALLBACK * estimateY, Number(rect.getAttribute('height')) / 2));
  }
  if (typeof globalThis.ResizeObserver !== 'function') return;
  /* Первый вызов приходит до вставки линии в документ — наблюдение снимается, только когда линию из него убрали */
  let shown = false;
  const observer = new globalThis.ResizeObserver(() => {
    if (svg.isConnected) {
      shown = true;
      apply();
    } else if (shown) observer.disconnect();
  });
  observer.observe(svg);
}
let sequence = 0;

/*
  Прогрессивное размытие коридора плана — по макетам плитки роли (Figma `5415:21`, `5416:24`: размытие слоя 8, до
  38 % длины полное, к правому краю — ноль) и графика VOC (`5362:4252`: 10, с 12 % до 80 %). Слева, где полоса почти
  прозрачна, края мягкие; справа, у последних точек, граница плана чёткая. Две копии полосы: размытая под маской,
  гаснущей вправо, и чёткая под обратной; кривая маски гладкая (smoothstep) — шва нет. Размытие только по вертикали:
  по горизонтали градиент полосы и так плавный, а в растянутой линии радиус по X расплылся бы.
  `region` — рамка масок в координатах svg (с запасом под размытие), `fade` — начало и конец перехода долями полосы,
  `deviation` — радиус по вертикали в единицах svg. Возвращает узлы defs и два слоя полосы. Вариант с тонким контуром
  поверх полосы пользователь не выбрал (17.11): граница плана читается чётким правым краем и сменой тона линии
*/
const BAND_MASK_STOPS = 8;
export function planBandLayers({ id, rect, className, fill, fade, deviation, region }) {
  const filter = svgNode('filter', 'plan-band__blur', { id: `${id}-blur`, x: '-5%', y: '-100%', width: '110%', height: '300%' });
  filter.append(svgNode('feGaussianBlur', 'plan-band__deviation', { stdDeviation: `0 ${deviation}` }));
  /* Плавная кривая перехода; стопы белые — альфа маски, не цвет */
  const ramp = (name, rising) => {
    const gradient = svgNode('linearGradient', null, { id: `${id}-${name}-ramp`, gradientUnits: 'userSpaceOnUse', x1: rect.x + fade[0] * rect.width, x2: rect.x + fade[1] * rect.width, y1: 0, y2: 0 });
    for (let step = 0; step <= BAND_MASK_STOPS; step += 1) {
      const t = step / BAND_MASK_STOPS;
      const eased = t * t * (3 - 2 * t);
      gradient.append(svgNode('stop', null, { offset: t, 'stop-color': 'white', 'stop-opacity': rising ? eased : 1 - eased }));
    }
    const mask = svgNode('mask', null, { id: `${id}-${name}`, maskUnits: 'userSpaceOnUse', ...region });
    mask.append(svgNode('rect', null, { ...region, fill: `url(#${id}-${name}-ramp)` }));
    return [gradient, mask];
  };
  const layer = (name, extra) => {
    const group = svgNode('g', `plan-band plan-band--${name}`, { mask: `url(#${id}-${name})` });
    group.append(svgNode('rect', className, { ...rect, fill, ...extra }));
    return group;
  };
  return {
    defs: [filter, ...ramp('soft', false), ...ramp('crisp', true)],
    layers: [layer('soft', { filter: `url(#${id}-blur)` }), layer('crisp')],
  };
}

/* Заливка под линией гаснет к низу, как у графика динамики (R-50) */
function appendFill(svg, points) {
  const id = `sparkline-fill-${sequence += 1}`;
  const gradient = svgNode('linearGradient', 'sparkline__gradient', { id, x1: 0, x2: 0, y1: 0, y2: 1 });
  gradient.append(svgNode('stop', 'sparkline__stop', { offset: 0 }), svgNode('stop', 'sparkline__stop sparkline__stop--clear', { offset: 1 }));
  const defs = svgNode('defs');
  defs.append(gradient);
  svg.append(defs);
  for (const d of areaPaths(points, VIEWBOX.height).filter((path) => path.includes(' C '))) svg.append(svgNode('path', 'sparkline__area', { d, fill: `url(#${id})` }));
}

/*
  `planFill` — заливка как у графика динамики (appendSeries в dynamics.js): выше коридора плана — зелёная под линией до
  его верхнего края, ниже — красная над линией до нижнего края, внутри коридора заливки нет. Та же геометрия
  (areaPaths от линии до края коридора, обрезка по краю), градиент гаснет к коридору
*/
/* Ступени коридора плана — общие: прозрачный край, --color-plan-band-mid к 30 %, --color-plan-band-high к 75 %, --color-plan-band у края */
function bandStops() {
  return [
    svgNode('stop', 'sparkline__band-stop sparkline__band-stop--clear', { offset: 0 }),
    svgNode('stop', 'sparkline__band-stop sparkline__band-stop--mid', { offset: 0.3 }),
    svgNode('stop', 'sparkline__band-stop sparkline__band-stop--high', { offset: 0.75 }),
    svgNode('stop', 'sparkline__band-stop', { offset: 1 }),
  ];
}

function appendPlanFill(svg, points, scale, band) {
  const y = (value) => VIEWBOX.height - ((value - scale.min) / (scale.max - scale.min)) * VIEWBOX.height;
  const top = Math.max(0, Math.min(VIEWBOX.height, y(band.max)));
  const bottom = Math.max(0, Math.min(VIEWBOX.height, y(band.min)));
  const ys = points.filter((point) => point.y !== null).map((point) => point.y);
  if (!ys.length) return;
  const defs = svgNode('defs');
  const part = (tone, edge, extreme, clip) => {
    const id = `sparkline-plan-${tone}-${sequence += 1}`;
    const gradient = svgNode('linearGradient', `sparkline__plan-fill sparkline__plan-fill--${tone}`, {
      id: `${id}-fill`, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: extreme, y2: extreme === edge ? edge + 0.01 : edge,
    });
    gradient.append(svgNode('stop', 'sparkline__plan-stop', { offset: 0 }), svgNode('stop', 'sparkline__plan-stop sparkline__plan-stop--clear', { offset: 1 }));
    const clipPath = svgNode('clipPath', null, { id: `${id}-clip` });
    clipPath.append(svgNode('rect', null, { x: 0, width: VIEWBOX.width, ...clip }));
    defs.append(gradient, clipPath);
    return areaPaths(points, edge).filter((path) => path.includes(' C '))
      .map((d) => svgNode('path', 'sparkline__area', { d, fill: `url(#${id}-fill)`, 'clip-path': `url(#${id}-clip)` }));
  };
  const above = part('positive', top, Math.min(...ys), { y: 0, height: top });
  const below = part('negative', bottom, Math.max(...ys), { y: bottom, height: Math.max(0, VIEWBOX.height - bottom) });
  svg.append(defs, ...above, ...below);
}

/** Шкала по умолчанию — от минимума до максимума ряда: форма важнее абсолютного уровня. */
/*
  J-151: `wide` — линия на ширину колонки (дайджест): та же геометрия, растянута по ширине.
  J-153: `band` — коридор плана полосой за линией; шкала тогда включает и его, чтобы план было видно рядом с точками
*/
/*
  J-157: `label` — подпись значения над каждой точкой широкой линии. Подписи — HTML поверх растянутого SVG:
  текст внутри SVG растянулся бы вместе с линией. Крайние подписи прижаты к краю, чтобы не срезаться
*/
/* J-163: `fill` — широкая линия на всю высоту контейнера (плитка роли), а не фиксированной высоты */
/* J-165: `axis` — подписи под точками широкой линии (даты недель), по одной на значение */
/*
  `zones: false` — коридор плана полосой, но линия и точки своего тона, без перекраски по зонам: так две линии
  на одном графике (iOS и Android дайджеста) различаются цветом ряда, а не попаданием в план
*/
/*
  `glow` — широкая линия дайджеста (имя прежнее): заливки под линией нет, точки 3 px, подписи значений — над каждой
  точкой; коридор плана со скруглёнными углами. Свечения с редизайна 16–22.11 нет
*/
/*
  `crispBand` — коридор плана ровной полосой с границами-линиями на шкале, без размытия и скругления: размытие в единицах
  растянутого viewBox расплывалось в пятно. `labelBelow(index)` — подпись точки под ней; `label` вернул null — без подписи
*/
/*
  Мини-тренд сегмента (стиль Apple Health): `halo` — под линией её размытая копия тем же тоном, заливка остаётся;
  `dots: 'sm'` — точки 3 × 3 px (`--sparkline-dot-sm`, мини-тренд карточек по редизайну).
  `endRule` — тонкая вертикаль последней точки во всю высоту линии до оси; `level` — тихая пунктирная горизонталь уровня
  (граница плана), только если он внутри шкалы ряда: иначе она сплющила бы линию
*/
/*
  `bands` — коридор плана по точкам (у каждого месяца свой план): одинаковые — обычная полоса `band`, разные — полоса
  ступенькой (граница ступени — посередине между точками), линия своего тона, а точки красятся по своему коридору.
  `flatBand` — коридор без размытия и скругления; заливка та же, что везде: зелёный градиент `--color-plan-band` слева направо
  (неделя 16–22.11 — коридор плана везде зелёный, раньше `flatBand` давал серую ровную заливку)
*/
/* `partial` — по точкам: неполный интервал (месяц ещё идёт) — полая точка, как `chart-point--partial` графика динамики */
/*
  `pointTitle(index)` — подсказка точки широкой линии: прозрачная полоса во всю высоту на долю шага вокруг точки
  с `title`, в том числе у шага без оценок. Точка 3 px — слишком мелкая цель для наведения
*/
export function sparkline(values, { tone, domain, wide = false, fill = false, band: singleBand = null, bands = null, zones = true, label = null, axis = null, glow = false, crispBand = false, flatBand = false, labelBelow = null, halo = false, endRule = false, level = null, planFill = false, dots = null, partial = null, pointTitle = null }) {
  const sameBand = (left, right) => left && right && left.min === right.min && left.max === right.max;
  const known = bands?.filter(Boolean) ?? [];
  const stepped = known.length > 0 && !known.every((item) => sameBand(item, known[0])) ? bands : null;
  const band = singleBand ?? (!stepped && known.length ? known[0] : null);
  const bandAt = (index) => (stepped ? stepped[index] ?? null : band);
  const bandValues = [band, ...(stepped ?? [])].filter(Boolean).flatMap(({ min, max }) => [min, max]);
  const scale = domain ?? rangeOf([...values, ...bandValues]);
  const points = plotPoints(values.map((voc) => ({ voc })), { ...VIEWBOX, ...scale });
  const svg = svgNode('svg', `sparkline${wide ? ' sparkline--wide' : ''}${wide && fill ? ' sparkline--fill' : ''} tone--${tone}`, {
    viewBox: `0 0 ${VIEWBOX.width} ${VIEWBOX.height}`, 'aria-hidden': 'true', focusable: 'false', ...(wide ? { preserveAspectRatio: 'none' } : {}),
  });
  if (stepped) appendSteppedBand(svg, points, stepped, scale, flatBand);
  if (band) {
    const y = (value) => VIEWBOX.height - ((value - scale.min) / (scale.max - scale.min)) * VIEWBOX.height;
    /* Коридор плана — горизонтальный градиент тона «хорошо»: прозрачный слева, насыщеннее к текущей точке справа */
    const id = `sparkline-band-${sequence += 1}`;
    const gradient = svgNode('linearGradient', 'sparkline__band-gradient', { id, x1: 0, x2: 1, y1: 0, y2: 0 });
    gradient.append(...bandStops());
    const defs = svgNode('defs');
    defs.append(gradient);
    svg.append(defs);
    const rect = { x: 0, y: y(band.max), width: VIEWBOX.width, height: Math.max(0.5, y(band.min) - y(band.max)) };
    const className = `sparkline__band${crispBand ? ' sparkline__band--crisp' : ''}${flatBand ? ' sparkline__band--flat' : ''}`;
    if (crispBand || flatBand) svg.append(svgNode('rect', className, { ...rect, fill: `url(#${id})` }));
    else {
      /* Радиус размытия — до замера по типовой высоте; roundBands пересчитает его в пикселях экрана */
      const blurred = planBandLayers({ id, rect, className, fill: `url(#${id})`, fade: BAND_FADE, deviation: BAND_BLUR_PX * (VIEWBOX.height / 60),
        region: { x: -VIEWBOX.width, y: -VIEWBOX.height, width: VIEWBOX.width * 3, height: VIEWBOX.height * 3 } });
      defs.append(...blurred.defs);
      svg.append(...blurred.layers);
    }
    if (crispBand) {
      for (const edge of [band.max, band.min]) svg.append(svgNode('line', 'sparkline__band-edge', { x1: 0, x2: VIEWBOX.width, y1: y(edge), y2: y(edge) }));
    }
  }
  if (stepped || band) roundBands(svg);
  if (Number.isFinite(level) && level >= scale.min && level <= scale.max) {
    const y = VIEWBOX.height - ((level - scale.min) / (scale.max - scale.min)) * VIEWBOX.height;
    svg.append(svgNode('line', 'sparkline__level', { x1: 0, x2: VIEWBOX.width, y1: y, y2: y }));
  }
  /* Без плана у `planFill` заливки нет: серая заливка под всей линией не повторяет смысл графика динамики */
  if (planFill) {
    if (band) appendPlanFill(svg, points, scale, band);
  } else if (!glow) appendFill(svg, points);
  /* Точка без соседей — отрезок нулевой длины: её видно только кружком */
  const lines = linePaths(points).filter((path) => path.includes(' C '));
  if (band && zones) appendPlanLines(svg, lines, scale, band);
  else {
    if (halo) for (const d of lines) svg.append(svgNode('path', 'sparkline__line sparkline__line--glow', { d }));
    for (const d of lines) svg.append(svgNode('path', 'sparkline__line', { d }));
  }
  /* J-156: с коридором плана точка ниже него — тоном негатива, выше — позитива, в коридоре — тоном линии */
  const planTone = (value, index) => {
    const own = bandAt(index);
    return !own || !zones || value === null ? '' : value < own.min ? ' tone--negative' : value > own.max ? ' tone--positive' : '';
  };
  if (!wide) {
    points.forEach(({ x, y }, index) => {
      if (y !== null) svg.append(svgNode('circle', `sparkline__dot${planTone(values[index], index)}`, { cx: x, cy: y, r: DOT_RADIUS }));
    });
    return svg;
  }
  /*
    J-177: точки растянутой линии — HTML-кружки поверх SVG, как подписи. Точка из SVG (J-152: отрезок нулевой длины
    с круглым концом и толщиной в пикселях экрана) в WebKit — окне десктопного приложения и Safari — растягивалась
    в овал вместе с линией; HTML-кружок круглый в любом движке
  */
  const plot = element('div', 'sparkline-labels__plot');
  plot.append(svg);
  const at = (node, x, y) => {
    node.style.setProperty('--x', `${(x / VIEWBOX.width) * 100}%`);
    node.style.setProperty('--y', `${(y / VIEWBOX.height) * 100}%`);
    return node;
  };
  const last = points.findLast(({ y }) => y !== null);
  if (endRule && last) plot.append(at(element('span', `sparkline__rule tone--${tone}`), last.x, last.y));
  if (pointTitle) {
    points.forEach(({ x }, index) => {
      const text = pointTitle(index);
      if (!text) return;
      const hit = at(element('span', 'sparkline__hit'), x, 0);
      hit.style.setProperty('--w', `${100 / points.length}%`);
      hit.title = text;
      plot.append(hit);
    });
  }
  points.forEach(({ x, y }, index) => {
    if (y === null) return;
    plot.append(at(element('span', `sparkline__marker${partial?.[index] ? ' sparkline__marker--partial' : ''}${planTone(values[index], index) || ` tone--${tone}`}`), x, y));
    const text = label?.(values[index], index);
    if (text === null || text === undefined) return;
    const edge = index === 0 && points.length > 1 ? ' sparkline-labels__value--start' : index === points.length - 1 && points.length > 1 ? ' sparkline-labels__value--end' : '';
    const below = labelBelow?.(index) ? ' sparkline-labels__value--below' : '';
    plot.append(at(element('span', `sparkline-labels__value${edge}${below}`, text), x, y));
  });
  const wrap = element('div', ['sparkline-labels', fill && 'sparkline-labels--fill', glow && 'sparkline-labels--glow', labelBelow && 'sparkline-labels--below', dots === 'sm' && 'sparkline-labels--dots-sm'].filter(Boolean).join(' '));
  wrap.append(plot);
  if (axis) {
    const row = element('div', 'sparkline-labels__axis');
    points.forEach(({ x }, index) => {
      const edge = index === 0 && points.length > 1 ? ' sparkline-labels__tick--start' : index === points.length - 1 && points.length > 1 ? ' sparkline-labels__tick--end' : '';
      const tick = element('span', `sparkline-labels__tick${edge}`, axis[index] ?? '');
      tick.style.setProperty('--x', `${(x / VIEWBOX.width) * 100}%`);
      row.append(tick);
    });
    wrap.append(row);
  }
  return wrap;
}

/*
  J-160: с коридором плана линия красится, как на графике динамики, — тем же градиентом зон (`planZoneStops`,
  стопы `chart-zones__stop`): зелёная выше коридора, серая в нём, красная ниже, с плавным переходом на границе
*/
const ZONE_FADE = VIEWBOX.height / 4;

/* Линия тоном зон коридора. Свечения у линий дайджеста больше нет (редизайн 16–22.11: «у графиков я убрала свечение») */
function appendPlanLines(svg, lines, scale, band) {
  const y = (value) => VIEWBOX.height - ((value - scale.min) / (scale.max - scale.min)) * VIEWBOX.height;
  const defs = svgNode('defs');
  const zoneGradient = (className) => {
    const id = `sparkline-zones-${sequence += 1}`;
    const gradient = svgNode('linearGradient', className, { id, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: 0, y2: VIEWBOX.height });
    for (const { offset, zone } of planZoneStops(y(band.max), y(band.min), VIEWBOX.height, ZONE_FADE)) {
      gradient.append(svgNode('stop', `chart-zones__stop chart-zones__stop--${zone}`, { offset }));
    }
    defs.append(gradient);
    return id;
  };
  const id = zoneGradient('chart-zones');
  svg.append(defs);
  for (const d of lines) {
    const path = svgNode('path', 'sparkline__line sparkline__line--zones', { d });
    path.style.setProperty('--sparkline-zones', `url(#${id})`);
    svg.append(path);
  }
}

/* Коридор ступенькой: у точки своя полоса от середины до соседей слева и справа; градиент — один на всю ширину */
function appendSteppedBand(svg, points, bands, scale, flat) {
  const y = (value) => VIEWBOX.height - ((value - scale.min) / (scale.max - scale.min)) * VIEWBOX.height;
  /* Градиент — и у ровного коридора: `flat` снимает только размытие (класс), заливка везде зелёная */
  let fillRef = null;
  {
    const id = `sparkline-band-${sequence += 1}`;
    const gradient = svgNode('linearGradient', 'sparkline__band-gradient', { id, gradientUnits: 'userSpaceOnUse', x1: 0, x2: VIEWBOX.width, y1: 0, y2: 0 });
    gradient.append(...bandStops());
    const defs = svgNode('defs');
    defs.append(gradient);
    svg.append(defs);
    fillRef = `url(#${id})`;
  }
  points.forEach(({ x }, index) => {
    const own = bands[index];
    if (!own) return;
    const left = index === 0 ? 0 : (points[index - 1].x + x) / 2;
    const right = index === points.length - 1 ? VIEWBOX.width : (points[index + 1].x + x) / 2;
    svg.append(svgNode('rect', `sparkline__band sparkline__band--step${flat ? ' sparkline__band--flat' : ''}`, {
      x: left, y: y(own.max), width: Math.max(0, right - left), height: Math.max(0.5, y(own.min) - y(own.max)), ...(fillRef ? { fill: fillRef } : {}),
    }));
  });
}

function rangeOf(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return min === max ? { min: min - 1, max: max + 1 } : { min, max };
}
