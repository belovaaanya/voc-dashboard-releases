/* Дни графика фильтруют события; окно таймлайна меняет только local period. */
import { daysBetween, isIsoDate, shiftDay } from '../core/dates.js';
export function normalizedDays(days = []) {
 return [...new Set(days.filter(isIsoDate))].sort();
}
export const dayIndex = (date, from) => daysBetween(from, date);
export const dateAt = (from, index) => shiftDay(from, Math.round(index));
export function dateRange(from, to) {
 if (from > to) [from,to] = [to,from];
 return Array.from({length:dayIndex(to,from)+1}, (_,i) => dateAt(from,i));
}
export function selectionDays(state) { return normalizedDays(state.days?.length ? state.days : state.focus ? [state.focus] : []); }
export function toggleDays(current, added) {
 const values = new Set(current);
 const remove = added.every((day) => values.has(day));
 for (const day of added) { if (remove) values.delete(day); else values.add(day); }
 return normalizedDays([...values]);
}
export function clampWindow(period, bounds) {
 const last=dayIndex(bounds.to,bounds.from);
 const length=Math.min(last,Math.max(0,dayIndex(period.to,period.from)));
 const start=Math.max(0,Math.min(last-length,dayIndex(period.from,bounds.from)));
 return {from:dateAt(bounds.from,start),to:dateAt(bounds.from,start+length)};
}
export function localChartPeriod(state, period) {
 return {...state,focus:null,days:[],detailEvent:null,local:{...state.local,dynamics:{preset:'custom',from:period.from,to:period.to}}};
}
