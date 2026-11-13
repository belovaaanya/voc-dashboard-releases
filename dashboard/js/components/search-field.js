/* Имя поля — только скрытый текст label: aria-label перекрыл бы его, и два имени разошлись (J-182) */

import { element } from '../ui/dom.js';

export function searchField({ className, inputClass, label, placeholder, value = '', onInput }) {
  const field = element('label', ['search-field', className].filter(Boolean).join(' '));
  const input = element('input', ['search-field__input', inputClass].filter(Boolean).join(' '));
  input.type = 'search';
  input.placeholder = placeholder;
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  field.append(element('span', 'visually-hidden', label), input);
  return { field, input };
}
