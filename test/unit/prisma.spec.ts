import { expect } from 'chai';
import { prisma, getPrismaClient } from '../../src/prisma';
import { PrismaClient } from '@prisma/client';

describe('Prisma Client Unit Tests', () => {
    it('getPrismaClient should return an instance of PrismaClient', () => {
        const client = getPrismaClient();
        expect(client).to.be.an.instanceOf(PrismaClient);
    });

    it('getPrismaClient should be idempotent', () => {
        const client1 = getPrismaClient();
        const client2 = getPrismaClient();
        expect(client1).to.equal(client2);
    });

    it('prisma proxy should forward properties to getPrismaClient', () => {
        // We don't need to call actual DB methods, just check if property access works
        // and returns the same thing as the client itself.
        const client = getPrismaClient();
        expect(prisma.device).to.equal(client.device);
        expect(prisma.$connect).to.be.a('function');
    });
});
