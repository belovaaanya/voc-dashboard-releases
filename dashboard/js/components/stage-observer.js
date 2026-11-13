/* Размер сцены известен только в документе: график рисуется после вставки, при смене размера и после загрузки шрифта — им мерены подписи */
export function observeStage(stage, draw) {
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
  redraw();
  if (document.fonts?.status === 'loading') document.fonts.ready.then(() => stage.isConnected && redraw(true));
}
