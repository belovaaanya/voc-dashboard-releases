/*
  J-?: режим разработчика — видно всё, у непроверенного метка «В разработке» (core/features.js).
  `allowed` — режим разрешён на этой машине (файл-флаг приложения, локальный start.sh); `asProduct` — разработчик
  смотрит актуальную версию для продакта: ровно то, что видят продакты. По умолчанию режим выключен:
  пока среда не ответила, продакт не увидит лишнего.
*/

export const AS_PRODUCT_KEY = 'voc.asProduct';

let allowed = false;
let asProduct = false;

function storedAsProduct() {
  try {
    return globalThis.localStorage?.getItem(AS_PRODUCT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Режим разрешён средой; выбор «как у продакта» читается из хранилища этого окна. */
export function setDeveloperAllowed(on) {
  allowed = on === true;
  asProduct = allowed && storedAsProduct();
}

export const isDeveloperAllowed = () => allowed;
/** Показывать ли непроверенное: режим разрешён и не выбран вид продакта. */
export const isDeveloperMode = () => allowed && !asProduct;
export const isViewingAsProduct = () => allowed && asProduct;

/** Переключить «смотреть как продакт» ↔ режим разработчика; выбор помнится в этом окне. */
export function setViewAsProduct(on) {
  if (!allowed) return;
  asProduct = on === true;
  try {
    if (asProduct) globalThis.localStorage?.setItem(AS_PRODUCT_KEY, '1');
    else globalThis.localStorage?.removeItem(AS_PRODUCT_KEY);
  } catch {
    /* Хранилище недоступно — выбор живёт до перезагрузки */
  }
}
