import { EMPTY } from '../shell/block.js';
import { distributionForDisplay } from '../core/distribution.js';
import { element } from '../ui/dom.js';
import { formatCount, formatRatings, formatShare, plural } from '../core/format.js';
import { withStars } from '../ui/icons.js';

/*
  J-130: у строки — число оценок и в скобках доля. J-137: изменения доли к прошлому периоду нет — блок был перегружен;
  доля в скобках тише числа
*/
function ratingLabel(mark, count, share) {
  return `${mark} ${plural(mark, ['звезда', 'звезды', 'звёзд'])}: ${formatRatings(count)}, ${formatShare(share)}`;
}

const appendStars = (node, text) => {
  node.append(...withStars(text));
  return node;
};

function distributionRow({ mark, count, share }) {
  const row = element('div', `distribution-row distribution-row--${mark}`);
  const label = ratingLabel(mark, count, share);
  row.setAttribute('tabindex', '0');
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', label);
  row.title = label;

  const track = element('span', 'distribution-row__track');
  const fill = element('span', 'distribution-row__fill');
  fill.style.setProperty('--distribution-share', `${share}%`);
  track.append(fill);

  /* J-145: число и доля — своими колонками одной ширины во всех строках: числа по правому краю, доли — по левому */
  row.append(appendStars(element('span', 'distribution-row__mark'), `${mark}★`), track,
    element('span', 'distribution-row__share', formatCount(count)),
    element('span', 'distribution-row__percent', `(${formatShare(share)})`));
  return row;
}

export function renderDistribution(block, context) {
  block.setHead();
  if (context.slice.length === 0) {
    block.setState(EMPTY);
    return;
  }

  block.setHead({ note: formatRatings(context.slice.length) });
  const chart = element('div', 'distribution');
  for (const bucket of distributionForDisplay(context.slice).reverse()) chart.append(distributionRow(bucket));
  block.setContent(chart);
}
