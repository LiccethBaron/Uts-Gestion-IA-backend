import { AppError } from '../utils/appError.js';

export interface ExtractedDocumentData {
  text: string;
  metadata: Record<string, string>;
}

export class ParserService {
  /**
   * Extrae texto plano a partir del buffer y la extensión del archivo (RF-06).
   */
  public async extractText(buffer: Buffer, format: string): Promise<ExtractedDocumentData> {
    const cleanFormat = format.toLowerCase().replace('.', '');

    switch (cleanFormat) {
      case 'pdf':
        return this.parsePdf(buffer);
      case 'docx':
      case 'doc':
        return this.parseDocx(buffer);
      case 'xlsx':
      case 'xls':
        return this.parseXlsx(buffer);
      default:
        throw new AppError(`Formato no soportado para extracción de texto: ${cleanFormat}`, 400);
    }
  }

  private async parsePdf(buffer: Buffer): Promise<ExtractedDocumentData> {
    // En producción se usa pdf-parse / pdf2json
    return {
      text: buffer.toString('utf-8'),
      metadata: { parser: 'pdf-extractor', pages: '1' },
    };
  }

  private async parseDocx(buffer: Buffer): Promise<ExtractedDocumentData> {
    // En producción se usa mammoth
    return {
      text: buffer.toString('utf-8'),
      metadata: { parser: 'docx-extractor' },
    };
  }

  private async parseXlsx(buffer: Buffer): Promise<ExtractedDocumentData> {
    // En producción se usa xlsx / exceljs
    return {
      text: buffer.toString('utf-8'),
      metadata: { parser: 'xlsx-extractor' },
    };
  }
}

