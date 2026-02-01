import { PrismaClient } from '@prisma/client';
import { config } from '../config';

export class PrismaService {
  private static _instance: PrismaClient;

  static get instance() {
    if (!this._instance) {
      this._instance = new PrismaClient({
        datasources: {
          db: {
            url: `file:${config.databasePath}`,
          },
        },
      });
    }
    return this._instance;
  }
}
