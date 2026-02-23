import { prisma } from '../prisma';
import { Service } from 'typedi';
import { PrismaClient } from '@prisma/client';

@Service()
export class PrismaService {
  constructor() { }

  get client(): PrismaClient {
    return prisma;
  }
}

// For compatibility with parts of the code that might expect PrismaService to be the client
export const getPrismaService = () => prisma;
