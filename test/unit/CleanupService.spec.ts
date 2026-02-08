import { expect } from 'chai';
import { CleanupService } from '../../src/services/CleanupService';
import { Container } from 'typedi';
import 'reflect-metadata';

describe('CleanupService Unit Tests', () => {
    let cleanupService: CleanupService;

    beforeEach(() => {
        cleanupService = Container.get(CleanupService);
    });

    it('should be instantiable via TypeDI', () => {
        expect(cleanupService).to.be.an.instanceOf(CleanupService);
    });

    it('should have runCleanup method', () => {
        expect(cleanupService.runCleanup).to.be.a('function');
    });

    it('should have purgeBuild method', () => {
        expect(cleanupService.purgeBuild).to.be.a('function');
    });
});
