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

export interface DropboxFolderMetadata {
  id: string;
  name: string;
  pathDisplay: string;
}

interface DropboxRawEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  id: string;
  name: string;
  path_display?: string;
  path_lower?: string;
  size?: number;
  server_modified?: string;
  content_hash?: string;
}

const SAMPLE_FILE_ID = 'id:dropbox_sample_file_001';

const ensureLeadingSlash = (targetPath: string): string => {
  const trimmed = targetPath.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const encodeDropboxApiArg = (payload: Record<string, unknown>): string =>
  JSON.stringify(payload).replace(/[\u007f-\uffff]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });

const mapDropboxFileMetadata = (raw: DropboxRawEntry, fallbackPath = ''): DropboxFileMetadata => ({
  id: raw.id,
  name: raw.name,
  pathDisplay: raw.path_display ?? raw.path_lower ?? fallbackPath,
  size: raw.size ?? 0,
  serverModified: raw.server_modified ? new Date(raw.server_modified) : new Date(),
  contentHash: raw.content_hash,
});

/**
 * Servicio de conexión con Dropbox API v2.
 * Soporta lectura de carpetas/archivos y operaciones administrativas de
 * subida (`mode: 'overwrite'`) y eliminación física (`files/delete_v2`)
 * para evitar acumulación de versiones por límite de almacenamiento.
 */
export class DropboxService {
  private readonly folderPath: string;
  private cachedAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    this.folderPath = ensureLeadingSlash(env.DROPBOX_FOLDER_PATH);
  }

  /**
   * Obtiene un access token activo renovándolo mediante OAuth2 refresh_token
   * o usando DROPBOX_ACCESS_TOKEN como respaldo.
   */
  private async getValidAccessToken(): Promise<string | null> {
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedAccessToken;
    }

    if (env.DROPBOX_REFRESH_TOKEN && env.DROPBOX_CLIENT_ID && env.DROPBOX_CLIENT_SECRET) {
      try {
        const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: env.DROPBOX_REFRESH_TOKEN,
            client_id: env.DROPBOX_CLIENT_ID,
            client_secret: env.DROPBOX_CLIENT_SECRET,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as { access_token?: string; expires_in?: number };
          if (data.access_token) {
            this.cachedAccessToken = data.access_token;
            const ttlSeconds = Math.max((data.expires_in ?? 14400) - 300, 60);
            this.tokenExpiresAt = Date.now() + ttlSeconds * 1000;
            return this.cachedAccessToken;
          }
        } else {
          const errText = await response.text();
          console.warn('Error renovando token de Dropbox, intentando fallback:', errText);
        }
      } catch (error) {
        console.warn('Fallo de red renovando token de Dropbox, intentando fallback:', error);
      }
    }

    return env.DROPBOX_ACCESS_TOKEN ?? null;
  }

  private async listEntries(targetPath: string, recursive: boolean): Promise<DropboxRawEntry[]> {
    const token = await this.getValidAccessToken();
    if (!token) {
      return [];
    }

    const entries: DropboxRawEntry[] = [];
    let response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: ensureLeadingSlash(targetPath), recursive }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(`Error listando directorio en Dropbox: ${errorText}`, 502);
    }

    let page = (await response.json()) as {
      entries: DropboxRawEntry[];
      cursor: string;
      has_more: boolean;
    };
    entries.push(...page.entries);

    while (page.has_more) {
      response = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor: page.cursor }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AppError(`Error continuando listado en Dropbox: ${errorText}`, 502);
      }

      page = (await response.json()) as {
        entries: DropboxRawEntry[];
        cursor: string;
        has_more: boolean;
      };
      entries.push(...page.entries);
    }

    return entries;
  }

  /**
   * Crea una nueva carpeta en Dropbox (`POST /2/files/create_folder_v2`).
   * Si ya existe en Dropbox, recupera sus metadatos para sincronizarla sin error.
   */
  public async createFolder(targetPath: string): Promise<DropboxFolderMetadata> {
    if (!targetPath || !targetPath.trim()) {
      throw new AppError('La ruta de la carpeta a crear en Dropbox es obligatoria', 400);
    }

    const token = await this.getValidAccessToken();
    if (!token) {
      throw new AppError('Credenciales de Dropbox no configuradas para crear carpetas', 500);
    }

    const normalizedPath = ensureLeadingSlash(targetPath).replace(/\/+$/, '');
    const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: normalizedPath,
        autorename: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 409 && errorText.includes('conflict/folder')) {
        const metaRes = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: normalizedPath, include_deleted: false }),
        });

        if (metaRes.ok) {
          const existingMeta = (await metaRes.json()) as DropboxRawEntry;
          return {
            id: existingMeta.id,
            name: existingMeta.name,
            pathDisplay: (existingMeta.path_display ?? normalizedPath).replace(/\/+$/, ''),
          };
        }
      }
      throw new AppError(`Error al crear carpeta en Dropbox: ${errorText}`, 502);
    }

    const payload = (await response.json()) as { metadata?: DropboxRawEntry } & DropboxRawEntry;
    const raw = payload.metadata ?? payload;
    return {
      id: raw.id,
      name: raw.name,
      pathDisplay: (raw.path_display ?? raw.path_lower ?? normalizedPath).replace(/\/+$/, ''),
    };
  }

  /**
   * Renombra o mueve una carpeta en Dropbox (`POST /2/files/move_v2`).
   */
  public async moveFolder(fromPath: string, toPath: string): Promise<DropboxFolderMetadata> {
    if (!fromPath || !fromPath.trim() || !toPath || !toPath.trim()) {
      throw new AppError('Se requieren la ruta origen y la ruta destino para editar la carpeta', 400);
    }

    const token = await this.getValidAccessToken();
    if (!token) {
      throw new AppError('Credenciales de Dropbox no configuradas para editar carpetas', 500);
    }

    const normalizedFrom = ensureLeadingSlash(fromPath).replace(/\/+$/, '');
    const normalizedTo = ensureLeadingSlash(toPath).replace(/\/+$/, '');

    const response = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_path: normalizedFrom,
        to_path: normalizedTo,
        autorename: false,
        allow_ownership_transfer: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 409 && errorText.includes('not_found')) {
        throw new AppError('No se encontró la carpeta original en Dropbox', 404);
      }
      if (response.status === 409 && errorText.includes('conflict')) {
        throw new AppError(
          'Ya existe una carpeta o archivo en Dropbox en la ruta destino indicada',
          409
        );
      }
      throw new AppError(`Error al renombrar o mover carpeta en Dropbox: ${errorText}`, 502);
    }

    const payload = (await response.json()) as { metadata?: DropboxRawEntry } & DropboxRawEntry;
    const raw = payload.metadata ?? payload;
    return {
      id: raw.id,
      name: raw.name,
      pathDisplay: (raw.path_display ?? raw.path_lower ?? normalizedTo).replace(/\/+$/, ''),
    };
  }

  /**
   *Elimina físicamente una carpeta y su contenido en Dropbox (`POST /2/files/delete_v2`).
   */
  public async deleteFolder(folderPathOrId: string): Promise<void> {
    return this.deleteFile(folderPathOrId);
  }

  /**
   * Lista las carpetas y subcarpetas dentro de la carpeta raíz institucional en Dropbox.
   * Por defecto explora recursivamente toda la jerarquía y las ordena por nivel de profundidad.
   */
  public async listFolders(
    folderPath?: string,
    recursive = true
  ): Promise<DropboxFolderMetadata[]> {
    const basePath = ensureLeadingSlash(folderPath ?? this.folderPath).replace(/\/+$/, '');
    const token = await this.getValidAccessToken();
    if (!token) {
      return [];
    }

    const entries = await this.listEntries(basePath, recursive);
    return entries
      .filter((entry) => entry['.tag'] === 'folder')
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        pathDisplay: (entry.path_display ?? entry.path_lower ?? `${basePath}/${entry.name}`).replace(
          /\/+$/,
          ''
        ),
      }))
      .filter((folder) => folder.pathDisplay.toLowerCase() !== basePath.toLowerCase())
      .sort((a, b) => {
        const depthA = a.pathDisplay.split('/').length;
        const depthB = b.pathDisplay.split('/').length;
        return depthA !== depthB ? depthA - depthB : a.pathDisplay.localeCompare(b.pathDisplay);
      });
  }

  /**
   * Lista los archivos dentro de una carpeta específica en Dropbox.
   * Por defecto lista solo los archivos directos (`recursive = false`).
   */
  public async listFilesInFolder(
    folderPath: string,
    recursive = false
  ): Promise<DropboxFileMetadata[]> {
    const basePath = ensureLeadingSlash(folderPath).replace(/\/+$/, '');
    const token = await this.getValidAccessToken();
    if (!token) {
      return [];
    }

    const entries = await this.listEntries(basePath, recursive);
    return entries
      .filter((entry) => entry['.tag'] === 'file')
      .map((entry) => mapDropboxFileMetadata(entry, `${basePath}/${entry.name}`));
  }

  /**
   * Obtiene los metadatos reales (`id`, `path_display`, `content_hash`, `server_modified`)
   * de un archivo existente en Dropbox a partir de su ruta (`POST /2/files/get_metadata`).
   */
  public async getFileMetadataByPath(targetPath: string): Promise<DropboxFileMetadata> {
    if (!targetPath || !targetPath.trim()) {
      throw new AppError('La ruta del archivo en Dropbox es obligatoria', 400);
    }

    const token = await this.getValidAccessToken();
    if (!token) {
      throw new AppError('Credenciales de Dropbox no configuradas para consultar metadatos', 500);
    }

    const normalizedPath = ensureLeadingSlash(targetPath);
    const response = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: normalizedPath,
        include_deleted: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 409 && errorText.includes('not_found')) {
        throw new AppError(
          `No se encontró ningún archivo en Dropbox en la ruta especificada: ${normalizedPath}`,
          404
        );
      }
      throw new AppError(`Error consultando metadatos en Dropbox: ${errorText}`, 502);
    }

    const data = (await response.json()) as DropboxRawEntry;
    if (data['.tag'] !== 'file') {
      throw new AppError('La ruta indicada en Dropbox no corresponde a un archivo válido', 400);
    }

    return mapDropboxFileMetadata(data, normalizedPath);
  }

  /**
   * Lista archivos de una carpeta institucional en modo lectura (CU10).
   */
  public async listFiles(_cursor?: string): Promise<DropboxFileMetadata[]> {
    const token = await this.getValidAccessToken();
    if (!token) {
      return [
        {
          id: SAMPLE_FILE_ID,
          name: 'Manual_de_Contratacion_UTS_2024.pdf',
          pathDisplay: `${this.folderPath}/Manual_de_Contratacion_UTS_2024.pdf`,
          size: 1048576,
          serverModified: new Date('2024-03-15T10:00:00Z'),
          contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      ];
    }

    const entries = await this.listEntries(this.folderPath, true);
    return entries
      .filter((entry) => entry['.tag'] === 'file')
      .map((entry) => mapDropboxFileMetadata(entry));
  }

  /**
   * Sube o sobrescribe un archivo en Dropbox con `mode: 'overwrite'` (sin versiones duplicadas).
   */
  public async uploadFile(targetPath: string, fileBuffer: Buffer): Promise<DropboxFileMetadata> {
    if (!targetPath || !targetPath.trim()) {
      throw new AppError('Ruta de destino en Dropbox requerida para subir archivo', 400);
    }
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new AppError('El archivo a subir en Dropbox está vacío', 400);
    }

    const token = await this.getValidAccessToken();
    if (!token) {
      throw new AppError('Credenciales de Dropbox no configuradas para subir archivos', 500);
    }

    const normalizedPath = ensureLeadingSlash(targetPath);
    const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': encodeDropboxApiArg({
          path: normalizedPath,
          mode: 'overwrite',
          autorename: false,
          mute: false,
          strict_conflict: false,
        }),
      },
      body: new Uint8Array(fileBuffer),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(`Error al subir archivo a Dropbox: ${errorText}`, 502);
    }

    const data = (await response.json()) as DropboxRawEntry;
    return mapDropboxFileMetadata(data, normalizedPath);
  }

  /**
   * Elimina físicamente un archivo de Dropbox mediante `files/delete_v2`.
   * Ignora de forma segura `not_found` (409) si el archivo ya había sido borrado.
   */
  public async deleteFile(dropboxFileIdOrPath: string): Promise<void> {
    if (!dropboxFileIdOrPath || !dropboxFileIdOrPath.trim()) {
      throw new AppError('Identificador o ruta de archivo en Dropbox requerido para eliminar', 400);
    }

    const token = await this.getValidAccessToken();
    if (!token) {
      throw new AppError('Credenciales de Dropbox no configuradas para eliminar archivos', 500);
    }

    const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: dropboxFileIdOrPath.trim() }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 409 && errorText.includes('not_found')) {
        console.warn(
          `El archivo en Dropbox (${dropboxFileIdOrPath}) ya no existía al intentar eliminarlo.`
        );
        return;
      }
      throw new AppError(`Error al eliminar archivo en Dropbox: ${errorText}`, 502);
    }
  }

  /**
   * Obtiene el buffer en memoria de un archivo específico (`files/download`).
   */
  public async downloadFileBuffer(dropboxFileId: string): Promise<Buffer> {
    if (!dropboxFileId) {
      throw new AppError('Identificador de archivo en Dropbox inválido', 400);
    }

    const token = await this.getValidAccessToken();
    if (!token || dropboxFileId === SAMPLE_FILE_ID) {
      return Buffer.from('Contenido institucional oficial de prueba para vectorización y lectura.');
    }

    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': encodeDropboxApiArg({ path: dropboxFileId }),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(`Error descargando archivo desde Dropbox: ${errorText}`, 502);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Genera un enlace temporal de descarga segura directa desde Dropbox (CU04).
   */
  public async getTemporaryDownloadLink(dropboxFileId: string): Promise<string> {
    if (!dropboxFileId) {
      throw new AppError('Identificador de archivo en Dropbox requerido', 400);
    }

    const token = await this.getValidAccessToken();
    if (!token || dropboxFileId === SAMPLE_FILE_ID) {
      return `https://dl.dropboxusercontent.com/s/sample_uts_download_token/${encodeURIComponent(
        dropboxFileId
      )}`;
    }

    const response = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: dropboxFileId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(`Error generando enlace temporal en Dropbox: ${errorText}`, 502);
    }

    const data = (await response.json()) as { link: string };
    return data.link;
  }
}
