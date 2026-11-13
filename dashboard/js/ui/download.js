/* Скачивание книги Excel (J-15): кнопка в шапке блока и сохранение файла браузером */

import { buildXlsx } from '../core/xlsx.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REVOKE_DELAY_MS = 30_000;
const DOWNLOAD_LABEL = 'Скачать Excel';

export function downloadXlsx(fileName, sheets, doc = document) {
  const blob = new Blob([buildXlsx(sheets)], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = /\.xlsx$/i.test(fileName) ? fileName : `${fileName}.xlsx`;
  link.style.display = 'none';
  doc.body.append(link);
  link.click();
  link.remove();
  /* Safari и Firefox читают Blob после click асинхронно: ранний отзыв URL срывает скачивание */
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function downloadAction(fileName, sheets) {
  return {
    id: 'download',
    label: DOWNLOAD_LABEL,
    icon: 'download',
    onClick: () => downloadXlsx(fileName(), sheets()),
  };
}
