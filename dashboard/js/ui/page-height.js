/*
  J-187, J-195: на время перерисовки страница держит прежнюю высоту, иначе укоротившееся содержимое прижало бы
  прокрутку и нажатый контрол уехал из-под указателя. Отпускается высота до низа окна, пустой хвост
  снимается целиком, когда содержимое снова закрывает окно: прокрутка высоту не пишет — раскладки на кадре нет
*/
const hold = { depth: 0, previous: '', held: '', view: null, tail: null, grown: null, content: 0 };

const rootOf = (view) => view.document.documentElement;

/* Высота содержимого — по низу body, не по scrollHeight: снятое ради замера удержание уже прижало бы прокрутку */
function contentBottom(view) {
  const body = view.document.body;
  if (!body?.getBoundingClientRect) return Infinity;
  return body.getBoundingClientRect().bottom + view.scrollY + (Number.parseFloat(view.getComputedStyle?.(body).marginBottom) || 0);
}

function stopTail() {
  hold.view?.removeEventListener?.('scroll', hold.tail);
  hold.view?.removeEventListener?.('resize', hold.tail);
  hold.grown?.disconnect();
  hold.tail = null;
  hold.grown = null;
}

/* Низ окна без горизонтальной полосы прокрутки — clientHeight, а не innerHeight: иначе хвост рос бы на её высоту */
function fitTail(view, trim = false) {
  const root = rootOf(view);
  const bottom = view.scrollY + root.clientHeight;
  if (!Number.isFinite(bottom) || hold.content >= bottom) {
    root.style.minHeight = hold.previous;
    stopTail();
    return;
  }
  if (!trim) return;
  const next = `${bottom}px`;
  if (root.style.minHeight !== next) root.style.minHeight = next;
}

export function holdPageHeight(view = globalThis) {
  if (hold.depth > 0 && view !== hold.view) return;
  const root = rootOf(view);
  if (hold.depth === 0) {
    if (hold.tail) stopTail();
    else hold.previous = root.style.minHeight;
    hold.view = view;
  }
  hold.depth += 1;
  hold.held = `${Math.max(root.scrollHeight, Number.parseFloat(root.style.minHeight) || 0)}px`;
  root.style.minHeight = hold.held;
}

/** Вложенные удержания общие: высоту отпускает последнее. */
export function releasePageHeight(view = globalThis) {
  if (hold.depth === 0 || view !== hold.view) return;
  hold.depth -= 1;
  if (hold.depth > 0 || rootOf(view).style.minHeight !== hold.held) return;
  hold.content = contentBottom(view);
  /* Содержимое замеряется заново, только когда меняются окно или body (догрузилась лента) */
  const remeasure = () => {
    hold.content = contentBottom(view);
    fitTail(view, true);
  };
  hold.tail = (event) => (event?.type === 'resize' ? remeasure() : fitTail(view));
  view.addEventListener?.('scroll', hold.tail, { passive: true });
  view.addEventListener?.('resize', hold.tail, { passive: true });
  if (view.ResizeObserver) {
    hold.grown = new view.ResizeObserver(() => hold.tail && remeasure());
    hold.grown.observe(view.document.body);
  }
  fitTail(view, true);
}

/** Действие внутри блока держит высоту страницы до следующего кадра: перерисовка не тянет прокрутку. */
export function holdDuring(node, action) {
  const view = node?.ownerDocument?.defaultView;
  if (!view?.document?.documentElement) return action();
  holdPageHeight(view);
  try {
    return action();
  } finally {
    if (view.requestAnimationFrame) view.requestAnimationFrame(() => releasePageHeight(view));
    else releasePageHeight(view);
  }
}
