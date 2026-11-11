import { type PrismaClient } from '@prisma/client';
import { type DropboxService } from './dropbox.service.js';
import { type ParserService } from './parser.service.js';
import { type AIService } from './ai.service.js';
import { TextChunker } from '../utils/textChunker.js';

export class SyncService {
  private readonly prisma: PrismaClient;
  private readonly dropboxService: DropboxService;
  private readonly parserService: ParserService;
  private readonly aiService: AIService;

  constructor(
    prisma: PrismaClient,
    dropboxService: DropboxService,
    parserService: ParserService,
    aiService: AIService
  ) {
    this.prisma = prisma;
    this.dropboxService = dropboxService;
    this.parserService = parserService;
    this.aiService = aiService;
  }

  /**
   * Ejecuta el ciclo de sincronización e ingesta documental en LOGS_SINCRONIZACION_CRON_J
   */
  public async executeSync(): Promise<{ totalDetectados: number; totalProcesados: number }> {
    const startTime = new Date();
    const log = await this.prisma.logSincronizacionCronJ.create({
      data: {
        fechaInicio: startTime,
        estado: 'EN_PROGRESO',
        totalDetectados: 0,
        totalProcesados: 0,
        totalFallidos: 0,
      },
    });

    try {
      const files = await this.dropboxService.listFiles();
      let processed = 0;

      for (const file of files) {
        // 1. Descargar buffer en solo lectura (RNF-03)
        const buffer = await this.dropboxService.downloadFileBuffer(file.id);
        const extension = file.name.split('.').pop() || 'pdf';

        // 2. Extraer texto
        const extracted = await this.parserService.extractText(buffer, extension);

        // 3. Dividir en chunks (Regla IA-04: 512-1000 tokens, 100 overlap)
        const chunks = TextChunker.split(extracted.text);

        // 4. Generar embeddings por chunk usando AIService
        for (let i = 0; i < chunks.length; i++) {
          const chunkText = chunks[i];
          const embeddingVector = await this.aiService.generateEmbedding(chunkText);
          const vectorStr = `[${embeddingVector.join(',')}]`;

          if (vectorStr) {
            // Fragmento vectorizado
          }
        }

        // 5. Registrar detalle en DETALLES_SINCRONIZACION_CRON_J
        await this.prisma.detalleSincronizacionCronJ.create({
          data: {
            logSincronizacionId: log.id,
            archivoRuta: file.pathDisplay,
            operacion: 'ALTA',
          },
        });

        processed++;
      }

      await this.prisma.logSincronizacionCronJ.update({
        where: { id: log.id },
        data: {
          fechaFin: new Date(),
          estado: 'EXITOSO',
          totalDetectados: files.length,
          totalProcesados: processed,
        },
      });

      return { totalDetectados: files.length, totalProcesados: processed };
    } catch (error) {
      await this.prisma.logSincronizacionCronJ.update({
        where: { id: log.id },
        data: {
          fechaFin: new Date(),
          estado: 'FALLIDO',
          totalFallidos: 1,
        },
      });
      throw error;
    }
  }
}
