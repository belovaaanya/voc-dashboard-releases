/*
  Загрузка CSV в десктопном приложении (docs/desktop-app.md): с компьютера или
  вложениями страницы Confluence, если ссылка задана в сборке, — в фоне, по галочке, с
  сессией Confluence из окна приложения; логин и токен окно не спрашивает. Кнопка появляется, только если сервер страницы
  отвечает на `api/data` — это делает лишь сервер приложения; на Pages и в
  `start.sh` шапка прежняя.

  Узел один на страницу: шапка перерисовывается на каждый фильтр, а открытое окно
  загрузки и идущая сборка не должны сбрасываться.
*/

import { element } from '../ui/dom.js';
import { formatBuildTime } from '../core/format.js';
import { bindPopover } from '../ui/popover.js';
import { appState, isLocalHost, postJson, request } from '../io/desktop.js';

export { isLocalHost };

const API_DATA = 'api/data';
const API_IMPORT = 'api/data/import';
const API_REMOVE = 'api/data/remove';
const API_CONFLUENCE = 'api/data/confluence';
const API_CONFLUENCE_SYNC = 'api/data/confluence/sync';
const CONFIRM_MS = 4000;
const POLL_BUSY_MS = 2_000;
const POLL_IDLE_MS = 30_000;

let control = null;
let notice = null;

/* Строка над шапкой: появилось новое из Confluence или нужен вход. Узел один, как у обновления приложения */
function noticeNode() {
  if (notice) return notice;
  const item = element('div', 'app-update');
  item.hidden = true;
  item.setAttribute('role', 'status');
  const text = element('span', 'app-update__text');
  const action = element('button', 'app-update__install');
  action.type = 'button';
  action.dataset.action = 'data-notice';
  item.append(text, action);
  let onAction = null;
  action.addEventListener('click', () => onAction?.());
  notice = {
    item,
    kind: null,
    show(kind, message, label, callback) {
      this.kind = kind;
      text.textContent = message;
      action.textContent = label;
      onAction = callback;
      item.hidden = false;
    },
    hide() {
      this.kind = null;
      item.hidden = true;
    },
  };
  return notice;
}

/* Имена и размеры файлов тела запроса: имена кириллические, поэтому заголовок — в URI-кодировке */
export function importHeader(files) {
  return encodeURIComponent(JSON.stringify(files.map((file) => ({ name: file.name, size: file.size }))));
}

/* Новый период выгрузки выбирается по умолчанию только в адресе без параметров (README, «Данные») */
function reloadClean() {
  location.assign(location.pathname);
}

function renderSheets(list, sheets, onRemove) {
  if (!sheets.length) {
    list.replaceChildren(element('li', 'data-import__empty', 'Листы не загружены'));
    return;
  }
  list.replaceChildren(...sheets.map((sheet) => {
    const row = element('li', 'data-import__sheet');
    const name = element('span', 'data-import__name', sheet.name);
    name.title = sheet.name;
    const fragments = sheet.fragments > 1 ? ` · частей: ${sheet.fragments}` : '';
    const time = element('span', 'data-import__time', formatBuildTime(sheet.updated_at) + fragments);
    const remove = element('button', 'data-import__remove', 'Убрать');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Убрать лист «${sheet.name}»`);
    let timer = null;
    /* Второе нажатие подтверждает: убранный лист вернёт только повторная загрузка */
    remove.addEventListener('click', () => {
      if (remove.dataset.confirm === 'true') {
        clearTimeout(timer);
        onRemove(sheet.name);
        return;
      }
      remove.dataset.confirm = 'true';
      remove.textContent = 'Точно убрать';
      timer = setTimeout(() => {
        delete remove.dataset.confirm;
        remove.textContent = 'Убрать';
      }, CONFIRM_MS);
    });
    row.append(name, time, remove);
    return row;
  }));
}

function renderStatus(status, { text, items = [], more = null, action = null }) {
  status.replaceChildren();
  status.hidden = !text;
  if (!text) return;
  for (const part of [{ text, items }, more]) {
    if (!part) continue;
    status.append(element('p', 'data-import__status-text', part.text));
    if (!part.items.length) continue;
    const list = element('ul', 'data-import__issues');
    for (const item of part.items) list.append(element('li', null, item.hint ?? item.code));
    status.append(list);
  }
  if (action) status.append(action);
}

/* Итог успешной сборки для окна; null — сообщать нечего, страница открывается сразу */
export function importOutcome({ rejected = [], warnings = [], waiting_for_ratings: waiting = false }, done) {
  const notice = 'Можно не исправлять:';
  if (waiting) {
    return {
      text: 'Сохранено. Загрузите файлы с оценками: дашборд соберётся вместе с ними.',
      more: rejected.length ? { text: 'Эти файлы не сохранены — исправьте их и загрузите снова:', items: rejected } : null,
      waiting: true,
    };
  }
  if (rejected.length) {
    return {
      text: 'Дашборд обновлён, кроме этих файлов — исправьте их и загрузите снова:',
      items: rejected,
      more: warnings.length ? { text: notice, items: warnings } : null,
    };
  }
  return warnings.length ? { text: `${done} ${notice}`, items: warnings } : null;
}

/* Строка состояния Confluence: подсказка отказа важнее общего текста */
export function confluenceStatus(state) {
  if (state?.state === 'checking') return 'Проверяем Confluence…';
  if (state?.hints?.length) return state.hints.join(' ');
  if (state?.state === 'ok' && state.checked_at) {
    return [`Проверено ${formatBuildTime(state.checked_at)}`, ...(state.warnings ?? []).map((item) => item.hint)].join('. ');
  }
  return '';
}

function importPanel() {
  const panel = element('div', 'control-popover glass data-import');
  panel.id = 'data-import-popover';
  panel.setAttribute('aria-label', 'Обновить данные');
  panel.append(element('h2', 'control-popover__title', 'Обновить данные'));
  panel.append(element('p', 'data-import__lead', 'Оценки дополнят загруженные: если код уже есть, верна новая версия. Справочник и план заменятся.'));
  const list = element('ul', 'data-import__sheets');
  list.setAttribute('aria-label', 'Загруженные листы');
  const status = element('div', 'data-import__status');
  status.setAttribute('role', 'status');
  status.hidden = true;
  const version = element('p', 'data-import__version');
  version.hidden = true;
  return { panel, list, status, version };
}

function diskSource() {
  const input = element('input', 'visually-hidden');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.csv,text/csv';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  const pick = element('button', 'control-popover__apply', 'Выбрать CSV');
  pick.type = 'button';
  pick.addEventListener('click', () => input.click());
  const section = element('section', 'data-import__source');
  section.append(
    element('h3', 'control-popover__subtitle', 'С компьютера'),
    /* J-126: главное — выбрать все файлы разом и как назвать часть листа; иначе ошибка про канал и справочник непонятна */
    element('p', 'data-import__note', 'Выберите сразу все CSV из папки выгрузки (⌘A в окне выбора): оценки проверяются вместе со справочником своего канала. Имя файла — имя листа, буква в букву: АБМ.csv, НИБ.csv, plan.csv, Справочник АБМ.csv. Часть листа — через два подчёркивания: НИБ__переразметка.csv.'),
  );
  const actions = element('div', 'control-popover__actions');
  actions.append(pick, input);
  section.append(actions);
  return { section, pick, input };
}

/* Confluence: вход — на сайте Confluence в окне приложения; раздел есть, только если ссылка задана в сборке */
function wikiSource() {
  const auto = element('input', 'control-popover__checkbox');
  auto.type = 'checkbox';
  auto.dataset.action = 'confluence-auto';
  const autoLabel = element('label', 'data-import__auto');
  autoLabel.append(auto, element('span', null, 'Загружать автоматически'));
  const wikiStatus = element('p', 'data-import__note');
  wikiStatus.hidden = true;
  const fetchPage = element('button', 'control-popover__apply', 'Загрузить сейчас');
  fetchPage.type = 'button';
  fetchPage.dataset.action = 'confluence-sync';
  const section = element('section', 'data-import__source');
  section.hidden = true;
  section.append(
    element('h3', 'control-popover__subtitle', 'Из Confluence'),
    element('p', 'data-import__note', 'Вложения .csv страницы: при запуске и каждые 12 часов, только изменившиеся. Нужен VPN.'),
    autoLabel,
    wikiStatus,
  );
  const actions = element('div', 'control-popover__actions');
  actions.append(fetchPage);
  section.append(actions);
  return { section, auto, wikiStatus, fetchPage };
}

function showConfluence({ auto, wikiStatus, fetchPage }, settings, importing) {
  if (!settings) return;
  auto.checked = Boolean(settings.enabled);
  const checking = settings.state === 'checking';
  auto.disabled = checking || importing;
  fetchPage.disabled = checking || importing;
  fetchPage.textContent = settings.state === 'login' ? 'Войти в Confluence' : 'Загрузить сейчас';
  const text = confluenceStatus(settings);
  wikiStatus.textContent = text;
  wikiStatus.hidden = !text;
}

/* Загрузка и удаление листов: занятость окна, итог в статусе, список листов */
function sheetImporter({ panel, list, status, disk, wiki }) {
  /* Последний известный список: после отказа строки рисуются заново и «Точно убрать» не остаётся взведённым */
  const session = { importing: false, sheets: [] };
  const showSheets = (next) => {
    session.sheets = next;
    renderSheets(list, session.sheets, remove);
  };
  const busy = (on) => {
    session.importing = on;
    disk.pick.disabled = on;
    wiki.fetchPage.disabled = on;
    wiki.auto.disabled = on;
    panel.setAttribute('aria-busy', String(on));
    for (const button of list.querySelectorAll('button')) button.disabled = on;
  };
  const settle = (result, done) => {
    if (result.failed) {
      showSheets(session.sheets);
      /* Пока листов нет, «прежних данных» тоже нет */
      renderStatus(status, { text: session.sheets.length ? 'Дашборд не обновлён — прежние данные на месте:' : 'Файлы не загружены:', items: result.errors });
      return;
    }
    showSheets(result.sheets ?? []);
    const outcome = importOutcome(result, done);
    if (!outcome) {
      reloadClean();
      return;
    }
    if (outcome.waiting) {
      renderStatus(status, outcome);
      return;
    }
    const open = element('button', 'control-popover__reset', 'Открыть дашборд');
    open.type = 'button';
    open.addEventListener('click', reloadClean);
    renderStatus(status, { ...outcome, action: open });
  };
  const run = async (text, done, send) => {
    busy(true);
    renderStatus(status, { text });
    try {
      settle(await send(), done);
    } catch {
      showSheets(session.sheets);
      renderStatus(status, { text: 'Не удалось связаться с приложением. Перезапустите его и повторите.' });
    } finally {
      busy(false);
    }
  };
  async function remove(name) {
    await run('Пересобираем дашборд…', 'Лист убран.', () => request(API_REMOVE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }));
  }
  disk.input.addEventListener('change', async () => {
    const files = [...disk.input.files];
    disk.input.value = '';
    if (!files.length) return;
    /* Blob склеивает файлы без чтения в память страницы; границы сервер берёт из заголовка */
    await run('Собираем дашборд…', 'Данные обновлены.', () => request(API_IMPORT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Import-Files': importHeader(files) },
      body: new Blob(files),
    }));
  });
  return { session, showSheets, settle };
}

/* Итог Confluence приходит не ответом на запрос, а опросом: работа идёт в потоке приложения */
function confluenceSync({ panel, status, wiki }, importer) {
  let revision = null;
  let awaiting = false;
  let timer = null;
  const applyConfluence = (state) => {
    const previous = revision;
    revision = state.revision;
    showConfluence(wiki, state, importer.session.importing);
    const arrived = previous !== null && state.revision > previous;
    if (arrived && awaiting && !panel.hidden) {
      importer.settle({ sheets: state.sheets, warnings: state.warnings, rejected: state.hints?.map((hint) => ({ hint })) }, 'Данные обновлены.');
    } else if (arrived && (awaiting || !importer.session.sheets.length)) {
      /* Окно закрыто (вход из строки над шапкой) или дашборд пуст: показывать предупреждения негде, они останутся в окне */
      reloadClean();
    } else if (arrived) {
      importer.showSheets(state.sheets ?? []);
      noticeNode().show('new-data', 'В Confluence появились новые данные', 'Показать', reloadClean);
    } else if (state.state === 'login' && state.enabled) {
      noticeNode().show('login', 'Войдите в Confluence, чтобы данные обновлялись', 'Войти', syncNow);
    } else if (state.state !== 'checking' && noticeNode().kind === 'login') {
      noticeNode().hide();
    }
    if (state.state !== 'checking') awaiting = false;
  };
  /* Новый опрос отменяет идущий: устаревший ответ не должен снять `awaiting` и продолжить вторую цепочку таймеров */
  let pollId = 0;
  const poll = async () => {
    clearTimeout(timer);
    const id = ++pollId;
    const state = await request(API_CONFLUENCE).catch(() => null);
    if (id !== pollId) return;
    if (state) applyConfluence(state);
    timer = setTimeout(poll, state?.state === 'checking' ? POLL_BUSY_MS : POLL_IDLE_MS);
  };
  const send = async (url, body) => {
    wiki.wikiStatus.hidden = true;
    const result = await postJson(url, body).catch(() => null);
    if (!result) {
      renderStatus(status, { text: 'Не удалось связаться с приложением. Перезапустите его и повторите.' });
      return;
    }
    if (result.failed) {
      awaiting = false;
      wiki.auto.checked = false;
      renderStatus(status, { text: 'Настройки Confluence не сохранены:', items: result.errors });
      return;
    }
    renderStatus(status, { text: '' });
    /* Строка «новые данные» остаётся: проверка её не отменяет */
    if (noticeNode().kind === 'login') noticeNode().hide();
    applyConfluence(result);
    poll();
  };
  function syncNow() {
    awaiting = true;
    return send(API_CONFLUENCE_SYNC);
  }
  wiki.fetchPage.addEventListener('click', syncNow);
  wiki.auto.addEventListener('change', () => {
    awaiting = wiki.auto.checked;
    send(API_CONFLUENCE, { enabled: wiki.auto.checked });
  });
  return { poll };
}

function buildControl() {
  const item = element('div', 'shell-head__action data-import__item');
  item.hidden = true;
  const trigger = element('button', 'data-import__trigger', 'Обновить данные');
  trigger.type = 'button';
  trigger.dataset.action = 'data-import';
  const ui = { ...importPanel(), disk: diskSource(), wiki: wikiSource() };
  const importer = sheetImporter(ui);
  const { poll } = confluenceSync(ui, importer);
  const { panel } = ui;
  panel.append(ui.list, ui.disk.section, ui.wiki.section, ui.status, ui.version);
  item.append(trigger, panel);
  bindPopover(item, trigger, panel);
  /* У правого края окно раскрывается влево; если слева ему не хватает места — вправо */
  trigger.addEventListener('click', () => {
    if (panel.hidden) return;
    const right = trigger.getBoundingClientRect().right;
    panel.classList.toggle('data-import--start', right < panel.getBoundingClientRect().width);
  });

  request(API_DATA).then((body) => {
    if (!Array.isArray(body.sheets)) return;
    importer.showSheets(body.sheets);
    item.hidden = false;
  }).catch(() => {});
  /* Прежняя сборка не знает `api/app`, а без ссылки в сборке Confluence выключен: загрузка с компьютера работает */
  appState().then((state) => {
    if (!state) return;
    if (state.confluence?.available) {
      ui.wiki.section.hidden = false;
      poll();
    }
    ui.version.textContent = `Версия приложения: ${state.version}`;
    ui.version.hidden = false;
  });
  return item;
}

/** Строка «новые данные / нужен вход» над шапкой или null вне локального сервера. */
export function dataNoticeControl() {
  if (!isLocalHost(globalThis.location?.hostname)) return null;
  return noticeNode().item;
}

/** Кнопка «Обновить данные» для шапки или null вне локального сервера. */
export function dataImportControl() {
  if (!isLocalHost(globalThis.location?.hostname)) return null;
  control ??= buildControl();
  return control;
}
