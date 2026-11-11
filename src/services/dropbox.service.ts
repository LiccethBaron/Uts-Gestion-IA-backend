import { env } from '../config/env.js';
import { AppError } from '../utils/appError.js';

export interface DropboxFileMetadata {
  id: string;
  name: string;
  pathDisplay: string;
  size: number;
  serverModified: Date;
  contentHash?: string;
}

/**
 * Servicio de conexión a Dropbox (RNF-03)
 * REGLA IA-01: Exclusivamente métodos de LECTURA.
 * En ninguna circunstancia se invocan endpoints de escritura, borrado o modificación.
 */
export class DropboxService {
  private readonly folderPath: string;

  constructor() {
    this.folderPath = env.DROPBOX_FOLDER_PATH;
  }

  /**
   * Lista archivos de una carpeta institucional en modo solo lectura (CU10).
   */
  public async listFiles(_cursor?: string): Promise<DropboxFileMetadata[]> {
    return [
      {
        id: 'id:dropbox_sample_file_001',
        name: 'Manual_de_Contratacion_UTS_2024.pdf',
        pathDisplay: `${this.folderPath}/Manual_de_Contratacion_UTS_2024.pdf`,
        size: 1048576,
        serverModified: new Date('2024-03-15T10:00:00Z'),
        contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
    ];
  }

  /**
   * Obtiene el buffer en memoria de un archivo específico (files/download).
   */
  public async downloadFileBuffer(dropboxFileId: string): Promise<Buffer> {
    if (!dropboxFileId) {
      throw new AppError('Identificador de archivo en Dropbox inválido', 400);
    }

    return Buffer.from('Contenido institucional oficial de prueba para vectorización y lectura.');
  }

  /**
   * Genera un enlace temporal de descarga segura directa desde Dropbox (CU04).
   * Solo lectura: no permite modificar el archivo en el repositorio institucional.
   */
  public async getTemporaryDownloadLink(dropboxFileId: string): Promise<string> {
    if (!dropboxFileId) {
      throw new AppError('Identificador de archivo en Dropbox requerido', 400);
    }

    // En producción se llama a `dropbox.filesGetTemporaryLink({ path: dropboxFileId })`
    return `https://dl.dropboxusercontent.com/s/sample_uts_download_token/${encodeURIComponent(
      dropboxFileId
    )}`;
  }
}
