/* Размер сцены известен только в документе: график рисуется после вставки, при смене размера и после загрузки шрифта — им мерены подписи */
/* `known` — размер прошлой сцены в том же месте: рисуем сразу, без принудительного layout; ResizeObserver поправит до отрисовки кадра */
export function observeStage(stage, draw, known = null) {
  let drawn = '';
  const redraw = (force = false) => {
    const size = { width: Math.round(stage.clientWidth), height: Math.round(stage.clientHeight) };
    const key = `${size.width}x${size.height}`;
    if (!size.width || !size.height || (key === drawn && !force)) return;
    drawn = key;
    draw(size);
  };
  const observer = new ResizeObserver(() => (stage.isConnected ? redraw() : observer.disconnect()));
  observer.observe(stage);
  if (known?.width && known?.height) {
    drawn = `${known.width}x${known.height}`;
    draw(known);
  } else redraw();
  if (document.fonts?.status === 'loading') document.fonts.ready.then(() => stage.isConnected && redraw(true));
}
