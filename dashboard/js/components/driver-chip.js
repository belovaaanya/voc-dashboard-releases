import { selectionChip } from './focus-chip.js';
import { formatDayRange } from '../core/format.js';
import { normalizeDriver } from '../state/driver-pick.js';

const CUT_NAMES = { trigger: 'Триггер', product: 'Продукт', app_version: 'Версия' };

/* J-128: чип выбранного антидрайвера — что сужает блок; клик снимает выбор во всех блоках */
export function driverChip(context) {
  const driver = normalizeDriver(context.state.driver);
  if (!driver) return null;
  const name = driver.cut === 'app_version' ? driver.key : context.label(driver.cut, driver.key);
  const range = driver.from ? ` · ${formatDayRange(driver.from, driver.to)}` : '';
  return selectionChip({
    caption: CUT_NAMES[driver.cut],
    value: `${name}${range}`,
    action: 'driver-clear',
    label: `Снять выбор антидрайвера: ${CUT_NAMES[driver.cut].toLowerCase()} ${name}${range}`,
    title: `Выбрано в антидрайверах: ${name}${range}`,
    /* Чипа после снятия нет: фокус — на выбранный таб разреза своей карточки, а не в начало страницы */
    onClear: (chip) => {
      const card = chip.closest?.('.card') ?? null;
      context.setState({ ...context.state, driver: null });
      card?.querySelector('.segmented__tab[aria-selected="true"]')?.focus();
    },
  });
}
