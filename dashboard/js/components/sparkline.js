/* Sparkline (C-05, Figma 3030:3263, 3030:3283): сглаженная линия цвета тона без осей и точки ряда на ней; шаг точек — D-52 */

import { areaPaths, linePaths, planZoneStops, plotPoints } from '../core/chart-geometry.js';
import { element, svgNode } from '../ui/dom.js';

const VIEWBOX = { width: 91, height: 28 };
const DOT_RADIUS = 1.5;
/* Скругление коридора плана у `glow`, в единицах viewBox */
const BAND_RADIUS = 3;
let sequence = 0;

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
  `glow` — широкая линия дайджеста: линия светится своим тоном, заливки под ней нет, точки маленькие, подписи значений —
  над каждой точкой; коридор плана со скруглёнными углами
*/
/*
  `crispBand` — коридор плана ровной полосой с границами-линиями на шкале, без размытия и скругления: размытие в единицах
  растянутого viewBox расплывалось в пятно. `labelBelow(index)` — подпись точки под ней; `label` вернул null — без подписи
*/
/*
  Мини-тренд сегмента (стиль Apple Health): `halo` — под линией её размытая копия тем же тоном, заливка остаётся;
  `endRule` — тонкая вертикаль последней точки во всю высоту линии до оси; `level` — тихая пунктирная горизонталь уровня
  (граница плана), только если он внутри шкалы ряда: иначе она сплющила бы линию
*/
export function sparkline(values, { tone, domain, wide = false, fill = false, band = null, zones = true, label = null, axis = null, glow = false, crispBand = false, labelBelow = null, halo = false, endRule = false, level = null }) {
  const scale = domain ?? rangeOf(band ? [...values, band.min, band.max] : values);
  const points = plotPoints(values.map((voc) => ({ voc })), { ...VIEWBOX, ...scale });
  const svg = svgNode('svg', `sparkline${wide ? ' sparkline--wide' : ''}${wide && fill ? ' sparkline--fill' : ''} tone--${tone}`, {
    viewBox: `0 0 ${VIEWBOX.width} ${VIEWBOX.height}`, 'aria-hidden': 'true', focusable: 'false', ...(wide ? { preserveAspectRatio: 'none' } : {}),
  });
  if (band) {
    const y = (value) => VIEWBOX.height - ((value - scale.min) / (scale.max - scale.min)) * VIEWBOX.height;
    /* Коридор плана — горизонтальный градиент тона «хорошо»: прозрачный слева, насыщеннее к текущей точке справа */
    const id = `sparkline-band-${sequence += 1}`;
    const gradient = svgNode('linearGradient', 'sparkline__band-gradient', { id, x1: 0, x2: 1, y1: 0, y2: 0 });
    gradient.append(svgNode('stop', 'sparkline__band-stop sparkline__band-stop--clear', { offset: 0 }), svgNode('stop', 'sparkline__band-stop', { offset: 1 }));
    const defs = svgNode('defs');
    defs.append(gradient);
    svg.append(defs);
    svg.append(svgNode('rect', `sparkline__band${crispBand ? ' sparkline__band--crisp' : ''}`, { x: 0, y: y(band.max), width: VIEWBOX.width, height: Math.max(0.5, y(band.min) - y(band.max)), fill: `url(#${id})`, ...(glow && !crispBand ? { rx: BAND_RADIUS, ry: BAND_RADIUS } : {}) }));
    if (crispBand) {
      for (const edge of [band.max, band.min]) svg.append(svgNode('line', 'sparkline__band-edge', { x1: 0, x2: VIEWBOX.width, y1: y(edge), y2: y(edge) }));
    }
  }
  if (Number.isFinite(level) && level >= scale.min && level <= scale.max) {
    const y = VIEWBOX.height - ((level - scale.min) / (scale.max - scale.min)) * VIEWBOX.height;
    svg.append(svgNode('line', 'sparkline__level', { x1: 0, x2: VIEWBOX.width, y1: y, y2: y }));
  }
  if (!glow) appendFill(svg, points);
  /* Точка без соседей — отрезок нулевой длины: её видно только кружком */
  const lines = linePaths(points).filter((path) => path.includes(' C '));
  if (band && zones) appendPlanLines(svg, lines, scale, band, glow);
  else {
    if (halo) for (const d of lines) svg.append(svgNode('path', 'sparkline__line sparkline__line--glow', { d }));
    for (const d of lines) svg.append(svgNode('path', 'sparkline__line', { d }));
  }
  /* J-156: с коридором плана точка ниже него — тоном негатива, выше — позитива, в коридоре — тоном линии */
  const planTone = (value) => (!band || !zones || value === null ? '' : value < band.min ? ' tone--negative' : value > band.max ? ' tone--positive' : '');
  if (!wide) {
    points.forEach(({ x, y }, index) => {
      if (y !== null) svg.append(svgNode('circle', `sparkline__dot${planTone(values[index])}`, { cx: x, cy: y, r: DOT_RADIUS }));
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
  points.forEach(({ x, y }, index) => {
    if (y === null) return;
    plot.append(at(element('span', `sparkline__marker${planTone(values[index]) || ` tone--${tone}`}`), x, y));
    const text = label?.(values[index], index);
    if (text === null || text === undefined) return;
    const edge = index === 0 && points.length > 1 ? ' sparkline-labels__value--start' : index === points.length - 1 && points.length > 1 ? ' sparkline-labels__value--end' : '';
    const below = labelBelow?.(index) ? ' sparkline-labels__value--below' : '';
    plot.append(at(element('span', `sparkline-labels__value${edge}${below}`, text), x, y));
  });
  const wrap = element('div', ['sparkline-labels', fill && 'sparkline-labels--fill', glow && 'sparkline-labels--glow', labelBelow && 'sparkline-labels--below'].filter(Boolean).join(' '));
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

/*
  `glow`: под линией — её размытая копия тем же градиентом, но участок в коридоре прозрачный (`chart-zones--glow`, как
  J-72 графика динамики): светятся только красная и зелёная части, у серой свечения нет
*/
function appendPlanLines(svg, lines, scale, band, glow = false) {
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
  const glowId = glow ? zoneGradient('chart-zones chart-zones--glow') : null;
  svg.append(defs);
  if (glowId) {
    for (const d of lines) {
      const halo = svgNode('path', 'sparkline__line sparkline__line--zones sparkline__line--glow', { d });
      halo.style.setProperty('--sparkline-zones', `url(#${glowId})`);
      svg.append(halo);
    }
  }
  for (const d of lines) {
    const path = svgNode('path', 'sparkline__line sparkline__line--zones', { d });
    path.style.setProperty('--sparkline-zones', `url(#${id})`);
    svg.append(path);
  }
}

function rangeOf(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return min === max ? { min: min - 1, max: max + 1 } : { min, max };
}
