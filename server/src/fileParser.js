import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import csv from 'csv-parser';

let pdfParserModulePromise;

async function loadPdfParserModule() {
  if (!pdfParserModulePromise) {
    pdfParserModulePromise = (async () => {
      // pdfjs expects these browser geometry APIs even for text-only parsing.
      // Load the native Node polyfills lazily so unrelated serverless routes do
      // not initialize the relatively heavy PDF runtime during cold starts.
      const canvasModule = await import('@napi-rs/canvas');
      const canvas = canvasModule.default || canvasModule;
      globalThis.DOMMatrix ||= canvas.DOMMatrix;
      globalThis.ImageData ||= canvas.ImageData;
      globalThis.Path2D ||= canvas.Path2D;

      return import('pdf-parse');
    })();
  }

  return pdfParserModulePromise;
}

class FileParser {
  constructor() {
    this.supportedFormats = {
      '.txt': this.parseText,
      '.md': this.parseText,
      '.docx': this.parseDocx,
      '.pdf': this.parsePdf,
      '.xlsx': this.parseExcel,
      '.csv': this.parseCsv,
      '.json': this.parseJson,
      '.xml': this.parseXml,
      '.html': this.parseHtml,
      '.htm': this.parseHtml
    };
  }

  // 检查文件格式是否支持
  isSupportedFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedFormats.hasOwnProperty(ext);
  }

  // 获取文件类型
  getFileType(filePath) {
    return path.extname(filePath).toLowerCase().slice(1);
  }

  // 解析文件内容
  async parseFile(filePath, options = {}) {
    // 从options中获取原始文件名，如果没有则使用filePath
    const originalFileName = options.originalFileName || path.basename(filePath);
    const ext = path.extname(originalFileName).toLowerCase();
    const parser = this.supportedFormats[ext];
    
    if (!parser) {
      throw new Error(`不支持的文件格式: ${ext}`);
    }

    try {
      const result = await parser.call(this, filePath, options);
      return {
        success: true,
        content: result.content,
        metadata: result.metadata || {},
        fileType: this.getFileType(originalFileName),
        fileName: path.basename(originalFileName)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        fileType: this.getFileType(originalFileName),
        fileName: path.basename(originalFileName)
      };
    }
  }

  // 解析文本文件
  async parseText(filePath, options = {}) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      content: String(content || ''), // 确保content是字符串
      metadata: {
        encoding: 'utf-8',
        size: content.length
      }
    };
  }

  // 解析Word文档
  async parseDocx(filePath, options = {}) {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    
    return {
      content: String(result.value || ''), // 确保content是字符串
      metadata: {
        warnings: result.messages,
        size: buffer.length
      }
    };
  }

  // 解析PDF文件
  async parsePdf(filePath, options = {}) {
    const { PDFParse } = await loadPdfParserModule();
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const [textResult, infoResult] = await Promise.all([
        parser.getText(),
        parser.getInfo().catch(() => null),
      ]);
      return {
        content: String(textResult?.text || ''),
        metadata: {
          pages: textResult?.total || textResult?.pages?.length || 0,
          info: infoResult?.info || null,
          size: buffer.length
        }
      };
    } finally {
      await parser.destroy();
    }
  }

  // 解析Excel文件
  async parseExcel(filePath, options = {}) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheets = [];

    const normalizeCell = value => {
      if (value === null || value === undefined) return '';
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'object') {
        if ('text' in value) return String(value.text);
        if ('result' in value) return String(value.result ?? '');
        if ('richText' in value) return value.richText.map(item => item.text).join('');
        return JSON.stringify(value);
      }
      return String(value);
    };

    workbook.eachSheet(worksheet => {
      const jsonData = [];
      worksheet.eachRow({ includeEmpty: false }, row => {
        const values = row.values.slice(1).map(normalizeCell);
        jsonData.push(values);
      });
      
      // 将Excel数据转换为文本
      let sheetText = `工作表: ${worksheet.name}\n`;
      if (jsonData.length > 0) {
        // 添加表头
        if (jsonData[0] && jsonData[0].length > 0) {
          sheetText += `表头: ${jsonData[0].join(' | ')}\n`;
        }
        
        // 添加数据行
        jsonData.slice(1).forEach((row, index) => {
          if (row && row.some(cell => cell !== undefined && cell !== '')) {
            sheetText += `行${index + 1}: ${row.join(' | ')}\n`;
          }
        });
      }
      
      sheets.push({
        name: worksheet.name,
        content: sheetText,
        rowCount: jsonData.length,
        columnCount: jsonData.length > 0 ? jsonData[0].length : 0
      });
    });
    
    const content = sheets.map(sheet => sheet.content).join('\n\n');
    
    return {
      content: content,
      metadata: {
        sheets: sheets.map(s => ({ name: s.name, rows: s.rowCount, cols: s.columnCount })),
        totalSheets: sheets.length,
        size: fs.statSync(filePath).size
      }
    };
  }

  // 解析CSV文件
  async parseCsv(filePath, options = {}) {
    return new Promise((resolve, reject) => {
      const results = [];
      const headers = [];
      
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          if (headers.length === 0) {
            headers.push(...Object.keys(row));
          }
          results.push(row);
        })
        .on('end', () => {
          // 将CSV数据转换为文本
          let content = `CSV数据文件\n`;
          if (headers.length > 0) {
            content += `列名: ${headers.join(' | ')}\n\n`;
            
            results.forEach((row, index) => {
              const values = headers.map(header => row[header] || '').join(' | ');
              content += `行${index + 1}: ${values}\n`;
            });
          }
          
          resolve({
            content: content,
            metadata: {
              headers: headers,
              rowCount: results.length,
              columnCount: headers.length,
              size: fs.statSync(filePath).size
            }
          });
        })
        .on('error', reject);
    });
  }

  // 解析JSON文件
  async parseJson(filePath, options = {}) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const jsonData = JSON.parse(content);
    
    // 将JSON转换为可读文本
    const textContent = JSON.stringify(jsonData, null, 2);
    
    return {
      content: textContent,
      metadata: {
        type: Array.isArray(jsonData) ? 'array' : 'object',
        size: content.length,
        keys: typeof jsonData === 'object' ? Object.keys(jsonData) : []
      }
    };
  }

  // 解析XML文件
  async parseXml(filePath, options = {}) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // 简单的XML解析，提取文本内容
    const textContent = content
      .replace(/<[^>]*>/g, ' ') // 移除XML标签
      .replace(/\s+/g, ' ') // 合并多个空格
      .trim();
    
    return {
      content: textContent,
      metadata: {
        size: content.length,
        hasTags: content.includes('<') && content.includes('>')
      }
    };
  }

  // 解析HTML文件
  async parseHtml(filePath, options = {}) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // 简单的HTML解析，提取文本内容
    const textContent = content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // 移除script标签
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // 移除style标签
      .replace(/<[^>]*>/g, ' ') // 移除HTML标签
      .replace(/\s+/g, ' ') // 合并多个空格
      .trim();
    
    return {
      content: textContent,
      metadata: {
        size: content.length,
        hasScripts: content.includes('<script'),
        hasStyles: content.includes('<style')
      }
    };
  }

  // 智能文本分块
  chunkText(text, options = {}) {
    const {
      chunkSize = 800,
      overlap = 100,
      maxChunks = 50,
      preserveStructure = true
    } = options;

    // 限制文本长度
    if (text.length > 100000) {
      text = text.substring(0, 100000) + '...';
    }

    let chunks = [];

    if (preserveStructure) {
      // 尝试按结构分块
      chunks = this.structuredChunking(text, chunkSize, overlap);
    }

    // 如果结构化分块失败或结果太少，使用滑动窗口
    if (chunks.length === 0 || chunks.length < 3) {
      chunks = this.slidingWindowChunking(text, chunkSize, overlap);
    }

    // 限制chunk数量
    return chunks.slice(0, maxChunks);
  }

  // 结构化分块
  structuredChunking(text, chunkSize, overlap) {
    const chunks = [];
    
    // 按段落分割（双换行符）
    let paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
    
    if (paragraphs.length <= 1) {
      // 如果没有双换行符，尝试按单个换行符分割
      paragraphs = text.split('\n').filter(p => p.trim().length > 0);
    }

    for (const paragraph of paragraphs) {
      if (paragraph.length <= chunkSize) {
        chunks.push(paragraph.trim());
      } else {
        // 段落太长，按句子分割
        const sentences = paragraph.split(/[.!?。！？]\s+/).filter(s => s.trim().length > 0);
        let currentChunk = '';
        
        for (const sentence of sentences) {
          if ((currentChunk + sentence).length <= chunkSize) {
            currentChunk += (currentChunk ? '. ' : '') + sentence;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
          }
        }
        
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
      }
    }

    return chunks;
  }

  // 滑动窗口分块
  slidingWindowChunking(text, chunkSize, overlap) {
    const chunks = [];
    let start = 0;
    
    // 防止无限循环
    const maxIterations = Math.ceil(text.length / Math.max(chunkSize - overlap, 1));
    let iterations = 0;
    
    while (start < text.length && iterations < maxIterations) {
      const end = Math.min(start + chunkSize, text.length);
      let chunk = text.slice(start, end);
      
      // 尝试在单词边界分割
      if (end < text.length) {
        const lastSpace = chunk.lastIndexOf(' ');
        const lastNewline = chunk.lastIndexOf('\n');
        const splitPoint = Math.max(lastSpace, lastNewline);
        
        if (splitPoint > chunkSize * 0.7) { // 如果分割点不太靠前
          chunk = chunk.slice(0, splitPoint);
        }
      }
      
      if (chunk.trim().length > 0) {
        chunks.push(chunk.trim());
      }
      
      // 确保前进
      const nextStart = start + Math.max(chunk.length - overlap, 1);
      if (nextStart <= start) {
        start = start + 1; // 至少前进1个字符
      } else {
        start = nextStart;
      }
      
      iterations++;
    }
    
    return chunks;
  }

  // 获取文件统计信息
  getFileStats(filePath) {
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      extension: path.extname(filePath).toLowerCase(),
      name: path.basename(filePath)
    };
  }
}

export default FileParser;
