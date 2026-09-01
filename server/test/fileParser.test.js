import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import FileParser from '../src/fileParser.js';

function createMinimalPdf(text) {
  const stream = `BT /F1 12 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf);
}

test('XLSX files are parsed with metadata and legacy XLS files are rejected', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusflow-parser-test-'));
  const workbookPath = path.join(tempDir, 'sample.xlsx');
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(['name', 'count']);
  sheet.addRow(['alpha', 2]);
  await workbook.xlsx.writeFile(workbookPath);

  const parser = new FileParser();
  const result = await parser.parseFile(workbookPath);
  assert.equal(result.success, true);
  assert.equal(result.metadata.totalSheets, 1);
  assert.match(result.content, /alpha \| 2/);
  await assert.rejects(() => parser.parseFile(workbookPath, { originalFileName: 'sample.xls' }), /不支持的文件格式/);
});

test('PDF parsing lazily loads its Node canvas polyfills', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusflow-pdf-test-'));
  const pdfPath = path.join(tempDir, 'sample.pdf');
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(pdfPath, createMinimalPdf('Hello NexusFlow'));

  const parser = new FileParser();
  const result = await parser.parseFile(pdfPath);

  assert.equal(result.success, true);
  assert.equal(result.metadata.pages, 1);
  assert.match(result.content, /Hello NexusFlow/);
});
