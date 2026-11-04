'use strict';
/* Мінімальний генератор .docx без зовнішніх залежностей.
 * Документ описується блоками:
 *  {t:'logos'} {t:'h1',text} {t:'h2',text} {t:'p',text,bold,italic,align,size}
 *  {t:'table',head:[..],rows:[[..]],widths:[..] (у відсотках),fontSize}
 *  {t:'signatures',items:[{role,name}]} {t:'pagebreak'} */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat([cd, end]));
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function run(text, o) {
  o = o || {};
  const rpr = (o.bold ? '<w:b/>' : '') + (o.italic ? '<w:i/>' : '') + (o.size ? `<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/>` : '') + (o.color ? `<w:color w:val="${o.color}"/>` : '');
  const lines = String(text === null || text === undefined ? '' : text).split('\n');
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${lines.map((l, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${esc(l)}</w:t>`).join('')}</w:r>`;
}
function para(text, o) {
  o = o || {};
  const ppr = `<w:pPr>${o.keepNext ? '<w:keepNext/>' : ''}<w:spacing w:before="${o.before || 0}" w:after="${o.after === undefined ? 80 : o.after}"/>${o.align ? `<w:jc w:val="${o.align}"/>` : ''}</w:pPr>`;
  return `<w:p>${ppr}${run(text, o)}</w:p>`;
}

const BORDER = '<w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:color="808080"/>';
const NOBORDER = '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>';

function table(b, pageW) {
  const cols = (b.head || b.rows[0] || []).length;
  const widths = b.widths || Array(cols).fill(100 / cols);
  const tw = widths.map(w => Math.round(pageW * w / 100));
  const fs = b.fontSize || 10;
  const cell = (txt, i, head) => `<w:tc><w:tcPr><w:tcW w:w="${tw[i]}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="DCE6F2"/>' : ''}<w:vAlign w:val="center"/></w:tcPr>${para(txt, { bold: head, size: fs, after: 0, align: (head || (b.center || []).indexOf(i) >= 0) ? 'center' : undefined })}</w:tc>`;
  let x = `<w:tbl><w:tblPr><w:tblW w:w="${pageW}" w:type="dxa"/><w:tblBorders>${BORDER}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${tw.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  if (b.head) x += `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${b.head.map((h, i) => cell(h, i, true)).join('')}</w:tr>`;
  (b.rows || []).forEach(r => { x += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(c, i, false)).join('')}</w:tr>`; });
  x += '</w:tbl>';
  return x + para('', { after: 60 });
}

function signatures(b, pageW) {
  const tw = [Math.round(pageW * 0.38), Math.round(pageW * 0.27), Math.round(pageW * 0.35)];
  let x = para('', { after: 120 });
  x += `<w:tbl><w:tblPr><w:tblW w:w="${pageW}" w:type="dxa"/><w:tblBorders>${NOBORDER}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${tw.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  b.items.forEach(it => {
    x += `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="620"/></w:trPr>` +
      `<w:tc><w:tcPr><w:tcW w:w="${tw[0]}" w:type="dxa"/><w:vAlign w:val="bottom"/></w:tcPr>${para(it.role, { size: 12, after: 0 })}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="${tw[1]}" w:type="dxa"/><w:vAlign w:val="bottom"/></w:tcPr>${para('____________________', { after: 0, align: 'center' })}${para('(підпис)', { size: 8, after: 0, align: 'center', italic: true })}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="${tw[2]}" w:type="dxa"/><w:vAlign w:val="bottom"/></w:tcPr>${para(it.name || '______________________________', { size: 12, after: 0 })}${para('(ПІБ)', { size: 8, after: 0, italic: true })}</w:tc></w:tr>`;
  });
  return x + '</w:tbl>';
}

/* Логотипи: зчитуються один раз */
const IMG_DIR = path.join(__dirname, '..', 'public', 'img');
const LOGOS = [
  { file: 'robogames.png', h: 2.2 },
  { file: 'puet.png', h: 1.2 },
  { file: 'pano.png', h: 1.7 },
  { file: '2d3d.png', h: 1.0 }
];
function pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }

function drawing(rid, id, wcm, hcm) {
  const cx = Math.round(wcm * 360000), cy = Math.round(hcm * 360000);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Logo${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="logo${id}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function logosRow(media, pageW) {
  const n = media.length;
  if (!n) return '';
  const tw = Math.round(pageW / n);
  let x = `<w:tbl><w:tblPr><w:tblW w:w="${pageW}" w:type="dxa"/><w:tblBorders>${NOBORDER}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${media.map(() => `<w:gridCol w:w="${tw}"/>`).join('')}</w:tblGrid><w:tr>`;
  media.forEach((m, i) => {
    x += `<w:tc><w:tcPr><w:tcW w:w="${tw}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr>${drawing(m.rid, i + 1, m.wcm, m.hcm)}</w:p></w:tc>`;
  });
  return x + '</w:tr></w:tbl>' + para('', { after: 60 });
}

function build(blocks, opts) {
  opts = opts || {};
  const landscape = !!opts.landscape;
  const pgW = landscape ? 16838 : 11906, pgH = landscape ? 11906 : 16838;
  const mL = 1134, mR = 850;
  const pageW = pgW - mL - mR;
  const media = [];
  if (blocks.some(b => b.t === 'logos')) {
    LOGOS.forEach((l, i) => {
      const f = path.join(IMG_DIR, l.file);
      if (!fs.existsSync(f)) return;
      const data = fs.readFileSync(f);
      const s = pngSize(data);
      media.push({ rid: 'rIdImg' + i, name: `media/logo${i}.png`, data, hcm: l.h, wcm: l.h * s.w / s.h });
    });
  }
  let body = '';
  for (const b of blocks) {
    if (b.t === 'logos') body += logosRow(media, pageW);
    else if (b.t === 'h1') body += para(b.text, { bold: true, size: 16, align: 'center', after: 60, keepNext: true });
    else if (b.t === 'h2') body += para(b.text, { bold: true, size: 13, before: 160, after: 80, keepNext: true });
    else if (b.t === 'h3') body += para(b.text, { bold: true, size: 12, before: 100, after: 60, keepNext: true });
    else if (b.t === 'p') body += para(b.text, b);
    else if (b.t === 'table') body += table(b, pageW);
    else if (b.t === 'signatures') body += signatures(b, pageW);
    else if (b.t === 'pagebreak') body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }
  const sect = `<w:sectPr><w:pgSz w:w="${pgW}" w:h="${pgH}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="850" w:right="${mR}" w:bottom="850" w:left="${mL}" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}${sect}</w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="uk-UA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media.map(m => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.name}"/>`).join('')}</Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title || 'RoboGames')}</dc:title><dc:creator>Система суддівства RoboGames</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`;
  return zip([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: doc },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'docProps/core.xml', data: core }
  ].concat(media.map(m => ({ name: 'word/' + m.name, data: m.data }))));
}

/* HTML-версія тих самих блоків — для друку з браузера */
function html(blocks, opts) {
  opts = opts || {};
  const e = s => esc(s).replace(/\n/g, '<br>');
  let out = '';
  for (const b of blocks) {
    if (b.t === 'logos') out += `<div class="logos">${LOGOS.map(l => `<img src="/img/${l.file}" style="height:${l.h * 0.9}cm">`).join('')}</div>`;
    else if (b.t === 'h1') out += `<h1>${e(b.text)}</h1>`;
    else if (b.t === 'h2') out += `<h2>${e(b.text)}</h2>`;
    else if (b.t === 'h3') out += `<h3>${e(b.text)}</h3>`;
    else if (b.t === 'p') out += `<p style="text-align:${b.align === 'center' ? 'center' : b.align === 'right' ? 'right' : 'left'};${b.bold ? 'font-weight:bold;' : ''}${b.italic ? 'font-style:italic;' : ''}">${e(b.text)}</p>`;
    else if (b.t === 'table') {
      const w = b.widths || [];
      out += `<table>${b.head ? `<thead><tr>${b.head.map((h, i) => `<th style="width:${w[i] || ''}%">${e(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${(b.rows || []).map(r => `<tr>${r.map((c, i) => `<td${(b.center || []).indexOf(i) >= 0 ? ' class="c"' : ''}>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else if (b.t === 'signatures') out += `<table class="sig">${b.items.map(it => `<tr><td>${e(it.role)}</td><td class="line">____________________<br><small>(підпис)</small></td><td>${e(it.name || '______________________________')}<br><small>(ПІБ)</small></td></tr>`).join('')}</table>`;
    else if (b.t === 'pagebreak') out += '<div class="pb"></div>';
  }
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>${esc(opts.title || 'Документ')}</title><style>
@page{size:A4 ${opts.landscape ? 'landscape' : 'portrait'};margin:15mm}
body{font-family:"Times New Roman",serif;font-size:12pt;color:#000;max-width:${opts.landscape ? '27cm' : '19cm'};margin:0 auto;padding:10px}
h1{font-size:16pt;text-align:center;margin:6px 0}h2{font-size:13pt;margin:14px 0 6px}h3{font-size:12pt;margin:10px 0 4px}
p{margin:0 0 5px}table{border-collapse:collapse;width:100%;margin:4px 0 10px;font-size:10pt;page-break-inside:auto}
th,td{border:1px solid #777;padding:3px 5px;vertical-align:middle}th{background:#dce6f2}td.c{text-align:center}tr{page-break-inside:avoid}
table.sig td{border:none;padding:14px 6px 2px;vertical-align:bottom}table.sig small{font-size:8pt;font-style:italic}table.sig td.line{text-align:center}
.logos{display:flex;justify-content:space-around;align-items:center;margin-bottom:8px}.pb{page-break-after:always}
.bar{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid #ccc;margin-bottom:10px;font-family:sans-serif}
.bar button{font-size:14px;padding:6px 14px;cursor:pointer}@media print{.bar{display:none}}
</style></head><body><div class="bar"><button onclick="print()">🖨 Друкувати / зберегти PDF</button> <a href="${esc(opts.docxUrl || '#')}">⬇ Завантажити .docx</a></div>${out}</body></html>`;
}

module.exports = { build, html, zip };
