/*
  J-?: статусы страниц меню и крупных блоков — что видят продакты. Единственное место правки:
  «выпускаем X» = смена DEV на PROD здесь и строка журнала (docs/ui-shell.md#в-проде-и-в-разработке).

  PROD — видят все. DEV — только в режиме разработчика (файл-флаг приложения или локальный start.sh,
  docs/desktop-app.md#режим-разработчика): в обычном режиме страницы нет в меню, прямая ссылка открывает «Главную»,
  блок не рисуется.
*/

export const PROD = 'prod';
export const DEV = 'dev';

/* Каждая страница меню — с явным статусом: новая страница без строки здесь валит test/features.test.js */
export const PAGE_STATUS = {
  voc: PROD,
  analyst: PROD,
  roles: PROD,
  digest: DEV,
};

/* Крупные блоки внутри страниц; блок без строки — в проде вместе со своей страницей */
export const BLOCK_STATUS = {
  'call-stats': DEV,
  emotions: DEV,
};

export const pageStatus = (page) => PAGE_STATUS[page] ?? DEV;
export const blockStatus = (id) => BLOCK_STATUS[id] ?? PROD;

/** Видна ли страница: в проде — всем, в разработке — только в режиме разработчика. Неизвестная — никому, кроме него. */
export const pageShown = (page, developer) => developer || pageStatus(page) === PROD;
export const blockShown = (id, developer) => developer || blockStatus(id) === PROD;
