import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { Service } from 'typedi';

@Service()
export class PrismaService extends PrismaClient {
  constructor() {
    super({
      datasources: {
        db: {
          url: config.databaseUrl,
        },
      },
    });
  }
}
