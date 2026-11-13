/*
  Дни отдыха: суббота, воскресенье и нерабочие праздники РФ. Общий модуль пропажи данных (J-191) и таблицы
  аномалий главного вывода: обоим нужно одно правило, а `anomalies.js` и `data-loss.js` друг друга не импортируют.
*/

import { shiftDay, weekdayOf } from './dates.js';

const isWeekday = (date) => {
  const weekday = weekdayOf(date);
  return weekday >= 1 && weekday <= 5;
};

/*
  Нерабочие праздники РФ по фиксированным датам: оценок в них как в выходной. Переносы выходных по годам не известны —
  производственного календаря в выгрузке нет, поэтому перенесённый рабочий день считается обычным
*/
const HOLIDAYS = new Set(['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08', '02-23', '03-08', '05-01', '05-09', '06-12', '11-04']);
/* Праздник на субботе или воскресенье переносится на следующий рабочий день (ст. 112 ТК РФ); январские — постановлением, их переносы не известны */
const SHIFTED_HOLIDAYS = ['02-23', '03-08', '05-01', '05-09', '06-12', '11-04'];

function shiftedHoliday(date) {
  if (!isWeekday(date)) return false;
  /* Будний день — перенесённый праздник, если перед ним подряд идут только выходные и праздники, среди которых праздник на выходном */
  for (let day = shiftDay(date, -1); !isWeekday(day) || HOLIDAYS.has(day.slice(5)); day = shiftDay(day, -1)) {
    if (!isWeekday(day) && SHIFTED_HOLIDAYS.includes(day.slice(5))) return true;
  }
  return false;
}

/** День отдыха — суббота, воскресенье, праздник или перенесённый с выходного праздник: его база — такие же дни, а не будни. */
export function isRestDay(date) {
  return !isWeekday(date) || HOLIDAYS.has(date.slice(5)) || shiftedHoliday(date);
}
