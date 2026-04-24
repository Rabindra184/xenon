import 'express';

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        scopes: string;
        rateLimit: number;
        teamId?: string | null;
      };
    }
  }
}
