/*
  Движение подтверждает действие пользователя и смысла не несёт (D-56): выбор
  таба переезжает рамкой, перестроенное содержимое проявляется. При
  prefers-reduced-motion и без Web Animations API ничего не анимируется.
*/

const REDUCED = '(prefers-reduced-motion: reduce)';

export function motionAllowed() {
  return typeof matchMedia === 'function' && !matchMedia(REDUCED).matches;
}

/* Длительность и кривая — токены tokens.css: у движения один дом, как у цвета */
function timing(duration) {
  const tokens = getComputedStyle(document.documentElement);
  return { duration: milliseconds(tokens.getPropertyValue(duration)), easing: tokens.getPropertyValue('--ease-standard').trim() || 'ease-out' };
}

/** CSS-время в миллисекундах: токен может быть записан и в `ms`, и в `s`. */
export function milliseconds(value) {
  const number = parseFloat(value);
  if (!Number.isFinite(number)) return 0;
  return /\ds$/i.test(value.trim()) ? number * 1000 : number;
}

/** Откуда едет рамка выбора: края прошлого выбранного таба относительно нового. */
export function selectionOffsets(from, to) {
  return { left: from.left - to.left, right: to.right - from.right };
}

/** Рамка выбора (`::before` таба) едет от прошлого таба к новому. */
export function slideSelection(fromRect, tab) {
  if (!fromRect || !tab?.animate || !motionAllowed()) return;
  const { left, right } = selectionOffsets(fromRect, tab.getBoundingClientRect());
  if (Math.abs(left) < 1 && Math.abs(right) < 1) return;
  tab.animate(
    [{ left: `${left}px`, right: `${right}px` }, { left: '0px', right: '0px' }],
    { ...timing('--motion-base'), pseudoElement: '::before' },
  );
}

/* Перестройка всего дашборда стартует не с нуля: иначе каждый клик мигал бы страницей */
const DASHBOARD_FROM = 0.5;

/** Перестроенное содержимое проявляется; `from` — стартовая непрозрачность. */
export function reveal(nodes, from = 0) {
  if (!motionAllowed()) return;
  const options = timing('--motion-base');
  for (const node of nodes) {
    node.animate?.([{ opacity: from, transform: `translateY(${from ? 0 : 4}px)` }, { opacity: 1, transform: 'none' }], options);
  }
}

/** Проявляет перестроенное содержимое вокруг `keep`: нажатый переключатель не гаснет под указателем. */
export function revealAround(container, keep) {
  const rebuilt = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (child === keep) continue;
      if (keep && child.contains(keep)) walk(child);
      else rebuilt.push(child);
    }
  };
  walk(container);
  reveal(rebuilt);
}

let clicked = null;
globalThis.document?.addEventListener?.('click', (event) => {
  clicked = event.target;
  setTimeout(() => { clicked = null; });
}, true);

/*
  J-40: тело карточки-группы не карточка блока — оно содержит тела вложенных блоков. Иначе `acted`
  стало бы телом группы, и блок, где было действие, проявлялся бы вопреки D-56, а при смене
  фильтра прозрачность группы и вложенного блока перемножалась бы
*/
export const CARD_BODIES = '.card__body:not(.card--group > .card__body)';

/** Снимок карточек до действия; `acted` — карточка, где оно случилось: клик ещё в обработке или фокус клавиатуры. */
export function snapshotCards(bodies = document.querySelectorAll(CARD_BODIES), origin = clicked ?? document.activeElement) {
  return { html: new Map([...bodies].map((body) => [body, body.innerHTML])), acted: [...bodies].find((body) => body.contains(origin)) };
}

/** Изменившиеся карточки, кроме той, где было действие: её контрол сам показывает выбор. */
export const changedCards = (bodies, before, active) =>
  [...bodies].filter((body) => before.html.get(body) !== body.innerHTML && body !== before.acted && !body.contains(active));

export function revealDashboard(before, bodies = document.querySelectorAll(CARD_BODIES)) {
  reveal(changedCards(bodies, before, document.activeElement), DASHBOARD_FROM);
}
