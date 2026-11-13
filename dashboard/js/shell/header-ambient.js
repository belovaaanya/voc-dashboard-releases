/* R-50: пятна стекла шапки совпадают с подсветкой страницы без background-attachment: fixed (ui-shell — Стекло) */

export function ambientOffset({ windowWidth, windowHeight, headerLeft, headerTop, glassInset }) {
  return {
    '--ambient-attachment': 'scroll',
    '--ambient-size': `${windowWidth}px ${windowHeight}px`,
    '--ambient-position': `${glassInset - headerLeft}px ${-headerTop}px`,
  };
}

export function alignHeaderAmbient(header, win = globalThis) {
  const root = win.document.documentElement;
  let written = {};
  let glassInset = 0;
  const write = () => {
    const box = header.getBoundingClientRect();
    const next = ambientOffset({
      windowWidth: root.clientWidth,
      windowHeight: root.clientHeight,
      headerLeft: box.left,
      headerTop: box.top,
      glassInset,
    });
    for (const [name, value] of Object.entries(next)) {
      if (written[name] !== value) header.style.setProperty(name, value);
    }
    /* Прилипшая шапка получает плотную полосу: на месте она — часть панели рабочей области и своей полосы не рисует */
    header.toggleAttribute?.('data-stuck', box.top <= 0);
    written = next;
  };
  const measure = () => {
    glassInset = -Number.parseFloat(win.getComputedStyle(header, '::before').left) || 0;
    write();
  };
  win.addEventListener('scroll', write, { passive: true });
  win.addEventListener('resize', measure);
  /* Сворачивание меню сдвигает шапку без смены размера окна: меняется ширина страницы или, уже --content-min, body; полоса прокрутки меняет html */
  const observer = new win.ResizeObserver(measure);
  observer.observe(header);
  if (header.parentElement) observer.observe(header.parentElement);
  observer.observe(win.document.body);
  observer.observe(win.document.documentElement);
  measure();
}
