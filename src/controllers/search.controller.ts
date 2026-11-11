import { type Request, type Response, type NextFunction } from 'express';
import { type SearchService } from '../services/search.service.js';
import { type SearchQueryDTO } from '../dtos/search.dto.js';

export class SearchController {
  private readonly searchService: SearchService;

  constructor(searchService: SearchService) {
    this.searchService = searchService;
  }

  public execute = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const queryParams = req.query as unknown as SearchQueryDTO;
      const results = await this.searchService.searchDocuments(queryParams);

      res.status(200).json({
        success: true,
        count: results.length,
        data: results,
      });
    } catch (error) {
      next(error);
    }
  };
}
