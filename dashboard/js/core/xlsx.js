const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const MIN_WIDTH = 8;
const MAX_WIDTH = 60;
const MAX_SHEET_NAME = 31;
const FALLBACK_SHEET_NAME = 'Лист1';

const ILLEGAL_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;
const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const encoder = new TextEncoder();

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const escapeXml = (text) => String(text).replace(ILLEGAL_XML, '').replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);

export function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function sheetNames(sheets) {
  const taken = new Set();
  return sheets.map((sheet) => {
    const base = String(sheet.name ?? '').replace(/[[\]:*?/\\]/g, '').replace(/^'+|'+$/g, '').trim().slice(0, MAX_SHEET_NAME) || FALLBACK_SHEET_NAME;
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = base.slice(0, MAX_SHEET_NAME - suffix.length) + suffix;
    }
    taken.add(name.toLowerCase());
    return name;
  });
}

const isEmptyCell = (value) => value == null || (typeof value === 'number' && !Number.isFinite(value));

function cellXml(value, ref, style) {
  if (isEmptyCell(value)) return '';
  const s = style ? ' s="1"' : '';
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function columnWidths(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((value, col) => {
      if (isEmptyCell(value)) return;
      widths[col] = Math.max(widths[col] ?? 0, String(value).length);
    });
  }
  return widths.map((len = 0) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, len + 2)));
}

function sheetXml(rows) {
  const cols = columnWidths(rows)
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join('');
  const data = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cellXml(value, `${columnName(c)}${r + 1}`, r === 0)).join('')}</row>`)
    .join('');
  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}"><sheetViews><sheetView workbookViewId="0">` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData></worksheet>`
  );
}

const STYLES_XML =
  `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';

function packageParts(sheets) {
  const names = sheetNames(sheets);
  const nums = sheets.map((_, i) => i + 1);
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="${REL_BASE}/${type}" Target="${target}"/>`;
  const override = (part, type) => `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${type}+xml"/>`;
  return [
    ['[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' + override('/xl/workbook.xml', 'sheet.main') +
      override('/xl/styles.xml', 'styles') + nums.map((n) => override(`/xl/worksheets/sheet${n}.xml`, 'worksheet')).join('') + '</Types>'],
    ['_rels/.rels', `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${rel('rId1', 'officeDocument', 'xl/workbook.xml')}</Relationships>`],
    ['xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>` +
      nums.map((n) => `<sheet name="${escapeXml(names[n - 1])}" sheetId="${n}" r:id="rId${n}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
      nums.map((n) => rel(`rId${n}`, 'worksheet', `worksheets/sheet${n}.xml`)).join('') +
      rel(`rId${nums.length + 1}`, 'styles', 'styles.xml') + '</Relationships>'],
    ['xl/styles.xml', STYLES_XML],
    ...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet.rows ?? [])]),
  ];
}

function zipStore(entries) {
  const files = entries.map(([name, text]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    return { nameBytes, data, crc: crc32(data) };
  });
  const localSize = files.reduce((sum, f) => sum + 30 + f.nameBytes.length + f.data.length, 0);
  const centralSize = files.reduce((sum, f) => sum + 46 + f.nameBytes.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;
  const u16 = (v) => { view.setUint16(pos, v, true); pos += 2; };
  const u32 = (v) => { view.setUint32(pos, v, true); pos += 4; };
  const put = (bytes) => { out.set(bytes, pos); pos += bytes.length; };
  const common = (f) => { u16(20); u16(0x0800); u16(0); u16(DOS_TIME); u16(DOS_DATE); u32(f.crc); u32(f.data.length); u32(f.data.length); u16(f.nameBytes.length); };

  for (const f of files) {
    f.offset = pos;
    u32(0x04034b50);
    common(f);
    u16(0);
    put(f.nameBytes);
    put(f.data);
  }
  const centralStart = pos;
  for (const f of files) {
    u32(0x02014b50);
    u16(20);
    common(f);
    u16(0); u16(0); u16(0); u16(0); u32(0);
    u32(f.offset);
    put(f.nameBytes);
  }
  u32(0x06054b50);
  u16(0); u16(0); u16(files.length); u16(files.length);
  u32(centralSize);
  u32(centralStart);
  u16(0);
  return out;
}

export function buildXlsx(sheets) {
  return zipStore(packageParts(sheets));
}

export function safeFileName(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(0, 120);
}
