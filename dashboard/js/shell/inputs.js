/* Входы блока записываются при чтении контекста: забыть зависимость нельзя (docs/ui-shell.md#обновление-на-месте) */

const SLICE = ['channel', 'preset', 'from', 'to', 'filters', 'includeCashback'];
const SLICED = new Set(['slice', 'previousSlice', 'select', 'period', 'previousPeriod', 'periodControl', 'previewPeriod']);
const DERIVED = { rows: ['includeCashback'], dimensions: ['channel', 'includeCashback'], channelRows: ['channel'], analyst: ['page'] };
const KEY_SET = '#keys';
const STALE = { values: new Map() };

const LOCAL = 'local.';
const valueOf = (state, key) => {
  if (key === KEY_SET) return Object.keys(state).sort().join(',');
  return JSON.stringify((key.startsWith(LOCAL) ? state.local?.[key.slice(LOCAL.length)] : state[key]) ?? null);
};
/* Тексты до прихода — одно состояние: блок сам переводит `idle` в `loading`, запросив их */
const textsOf = (verbatim) => (verbatim?.status === 'idle' || verbatim?.status === 'loading' ? 'pending' : verbatim);

/** После `seal()` состояние живое (`latest()`): обработчик сохранённого блока не откатывает новое состояние. */
export function watchInputs(context, { latest = () => context.state, local = null, texts = false } = {}) {
  const values = new Map();
  let sealed = false;
  const source = () => (sealed ? latest() : context.state);
  const record = (key) => {
    if (typeof key === 'string' && !values.has(key)) values.set(key, valueOf(source(), key));
  };
  const sliceKeys = local ? [...SLICE, `${LOCAL}${local}`] : SLICE;
  /* Копия состояния после отрисовки (ключи, затем по каждому описание и значение) строит следующее состояние — не вход */
  let copy = null;
  let copying = null;
  const read = (key) => {
    copy = null;
    copying = null;
    record(key);
  };
  const state = new Proxy({}, {
    get(_target, key) {
      if (key === copying) copying = null;
      else read(key);
      return Reflect.get(source(), key);
    },
    has(_target, key) { read(key); return Reflect.has(source(), key); },
    ownKeys() {
      const keys = Reflect.ownKeys(source());
      if (sealed) copy = [...keys];
      else read(KEY_SET);
      return keys;
    },
    getOwnPropertyDescriptor(_target, key) {
      if (copy?.[0] === key) copying = copy.shift();
      else read(key);
      const descriptor = Reflect.getOwnPropertyDescriptor(source(), key);
      return descriptor && { ...descriptor, configurable: true };
    },
  });
  const readSlice = () => sliceKeys.forEach(record);
  const watched = new Proxy(context, {
    get(target, key, receiver) {
      if (key === 'state') return state;
      /* Тексты — по последнему чтению: блок запрашивает их по ходу отрисовки */
      if (key === 'verbatim' && texts) values.set('#verbatim', textsOf(target.verbatim));
      if (SLICED.has(key)) readSlice();
      DERIVED[key]?.forEach(record);
      return Reflect.get(target, key, receiver);
    },
    ownKeys(target) {
      readSlice();
      return Reflect.ownKeys(target);
    },
  });
  const seal = () => {
    sealed = true;
    return { values };
  };
  return { context: watched, seal };
}

/** Прочитанное прошлой отрисовкой не изменилось: тот же ключ — то же значение, тексты — тот же объект. */
export function sameInputs(previous, context) {
  if (!previous || previous === STALE) return false;
  for (const [key, value] of previous.values) {
    if (key === '#verbatim' ? value !== textsOf(context.verbatim) : value !== valueOf(context.state, key)) return false;
  }
  return true;
}

/** Входы, которые не совпадут ни с чем: блок с содержимым перерисуется при следующей отрисовке. */
export const staleInputs = () => STALE;
