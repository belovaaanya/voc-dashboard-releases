/*
  J-128: выбор антидрайвера — строка или ячейка тепловой карты. Сужает «Топ проблем» с лентой и таблицу
  детализации до оценок с этим элементом; строка — за весь период блока, ячейка — за свой интервал.
  Это не фильтр шапки: график, календарь и сами антидрайверы его не учитывают. Живёт в URL (D-31),
  смена канала его снимает.
*/
import { DIMENSIONS } from '../core/dimensions.js';
import { versionRowKey } from '../core/antidrivers.js';
import { isIsoDate } from '../core/dates.js';

const DRIVER_CUTS = ['trigger', 'product', 'app_version'];
const cuts = new Map(DIMENSIONS.map((dimension) => [dimension.key, dimension]));

export function normalizeDriver(value) {
  if (!value || !DRIVER_CUTS.includes(value.cut) || typeof value.key !== 'string' || !value.key.trim()) return null;
  const driver = { cut: value.cut, key: value.key };
  if (isIsoDate(value.from) && isIsoDate(value.to) && value.from <= value.to) {
    driver.from = value.from;
    driver.to = value.to;
  }
  return driver;
}

/** Оценка с выбранным элементом; у ячейки — ещё и внутри её интервала. */
export function driverMatches(row, driver, reference) {
  if (driver.from && (row.appeal_date < driver.from || row.appeal_date > driver.to)) return false;
  if (driver.cut === 'app_version') return versionRowKey(row) === driver.key;
  return cuts.get(driver.cut).values(row, reference).includes(driver.key);
}

export function driverRows(rows, driver, reference) {
  return driver ? rows.filter((row) => driverMatches(row, driver, reference)) : rows;
}
