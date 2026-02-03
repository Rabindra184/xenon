import { Service } from 'typedi';
import { EventEmitter } from 'events';
import log from '../logger';

/**
 * Global Event Bus for decoupled communication between services.
 * 
 * Supports:
 * - Session events (started, stopped, failed, recovered)
 * - Device events (attached, detached, health_changed)
 * - HTTP events (request, response, error)
 * - System events (startup, shutdown, config_changed)
 */
@Service()
export class EventBus {
    private emitter: EventEmitter;
    private log = log.scope('EventBus');

    constructor() {
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(50); // Increase limit for many subscribers
        this.log.info('Global Event Bus Initialized');
    }

    /**
     * Emit an event to all subscribers
     */
    emit(event: string, data?: any) {
        this.log.debug(`[Emit] ${event}`);
        this.emitter.emit(event, data);
    }

    /**
     * Subscribe to an event
     */
    on(event: string, listener: (data?: any) => void) {
        this.emitter.on(event, listener);
    }

    /**
     * Subscribe to an event once
     */
    once(event: string, listener: (data?: any) => void) {
        this.emitter.once(event, listener);
    }

    /**
     * Unsubscribe from an event
     */
    off(event: string, listener: (data?: any) => void) {
        this.emitter.removeListener(event, listener);
    }

    /**
     * Clear all listeners for an event
     */
    removeAllListeners(event?: string) {
        this.emitter.removeAllListeners(event);
    }
}

// Export singleton
import { Container } from 'typedi';
export const EVENT_BUS = Container.get(EventBus);
