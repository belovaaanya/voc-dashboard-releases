/* Один помощник построения узлов на весь дашборд: блоки пишутся параллельно, и своя копия в каждом расходится. */

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/* Пропускает отсутствующие узлы: часть карточки не рисуется вовсе — нет плана, нет дельты */
export function appendAll(parent, ...nodes) {
  for (const node of nodes) {
    if (node) parent.append(node);
  }
  return parent;
}

/* Подсказка — на видимом тексте, скрытом от screen reader, иначе она прочтётся ещё раз описанием; имя — из скрытого текста (D-53) */
function titleShown(node, title, spoken) {
  const shown = element('span');
  shown.title = title;
  shown.setAttribute('aria-hidden', 'true');
  shown.append(...node.childNodes);
  node.append(shown, element('span', 'visually-hidden', spoken(shown.textContent)));
  return node;
}

/** Код в тесном месте (D-53): видимым остаётся код, полная подпись — в подсказке и в имени. */
export function withFullLabel(node, full) {
  if (!full || node.textContent.includes(full)) return node;
  return titleShown(node, full, (shown) => `${shown} — ${full}`);
}

/** Текст, который режется многоточием: полный — в подсказке, имя не меняется. */
export function withOverflowTitle(node) {
  return titleShown(node, node.textContent, (shown) => shown);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgNode(tag, className, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}
