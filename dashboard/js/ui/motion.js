/*
  Движение подтверждает действие пользователя и смысла не несёт (D-56): выбор таба переезжает рамкой,
  данные — и дашборда, и внутри блока — встают на место без проявления. При prefers-reduced-motion и без Web Animations API ничего не анимируется
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
