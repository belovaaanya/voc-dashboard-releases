/* Значок «i» с правилом подсчёта в подсказке: у названия роли на странице ролей и у чипа фильтра «Роли» (договорённость 19.11) */

import { element } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { hoverTooltip } from './hover-tooltip.js';

/**
 * `title` — первая строка подсказки («Договорённость от 19.11»), `phrases` — правило фразами, каждая — строками не шире
 * подсказки; доступное имя читает каждую фразу целиком, как «?» карточек.
 */
export function ruleHint(title, phrases) {
  const hint = element('span', 'rule-hint');
  hint.append(icon('info', 'rule-hint__icon'));
  hint.setAttribute('role', 'img');
  hint.setAttribute('aria-label', [title, ...phrases.map((phrase) => phrase.join(' '))].join('. '));
  hint.setAttribute('tabindex', '0');
  hoverTooltip(hint, [title, ...phrases.flat()]);
  return hint;
}
