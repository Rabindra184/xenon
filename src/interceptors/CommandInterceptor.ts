import { Container, Service } from 'typedi';
import { Span } from '@opentelemetry/api';
import { TracingService } from '../services/TracingService';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { HealingOrchestrator } from '../services/healing/HealingOrchestrator';
import { HealEtalonService } from '../services/healing/HealEtalonService';
import { OmniVisionService } from '../services/omni-vision/OmniVisionService';
import log from '../logger';
import { IPluginArgs } from '../interfaces/IPluginArgs';

@Service()
export class CommandInterceptor {
    private log = log.scope('CommandInterceptor');

    async handle(
        next: () => any,
        driver: any,
        commandName: string,
        args: any[],
        pluginArgs: IPluginArgs,
        isHub: boolean
    ) {
        const IGNORED_COMMANDS = ['getScreenshot', 'stopRecordingScreen', 'startRecordingScreen'];
        if (IGNORED_COMMANDS.includes(commandName)) return await next();

        const sessionId = (driver.sessionId as string) || args[args.length - 1];
        const tracingService = Container.get(TracingService);
        let span: Span | undefined;

        if (isHub && sessionId) {
            span = tracingService.startCommandSpan(sessionId, commandName, {
                'xenon.command.args': JSON.stringify(args),
            });
        }

        if (commandName === 'createSession' || commandName === 'deleteSession') {
            try { return await next(); }
            finally { if (span) tracingService.endSpan(`${sessionId}:${commandName}`); }
        }

        try {
            const { updateCmdExecutedTime } = await import('../data-service/device-service');
            await updateCmdExecutedTime(sessionId);
            await DASHBORD_EVENT_MANAGER.beforeSessionCommand(sessionId, commandName, {} as any, {} as any);

            // --- OMNI-VISION: PROACTIVE SEARCH ---
            const strategy = args[0];
            const selector = args[1];
            if (['findElement', 'findElements'].includes(commandName) && ['-custom:ai-icon', '-custom:ai-text'].includes(strategy)) {
                return await this.handleOmniVisionSearch(sessionId, driver, commandName, strategy, selector);
            }

            // --- OMNI-VISION: VIRTUAL ELEMENT INTERACTION ---
            const elementCommands = ['click', 'getElementRect', 'getElementLocation', 'getElementSize', 'getText', 'setValue'];
            if (elementCommands.includes(commandName)) {
                const elementId = args[0];
                if (typeof elementId === 'string' && (elementId.startsWith('omni_') || elementId.startsWith('healed_ocr') || elementId.startsWith('healed_visual'))) {
                    return await this.handleVirtualElementCommand(sessionId, driver, commandName, elementId, args[1]);
                }
            }

            // Intercept execute for dashboard
            if (isHub && !!pluginArgs.enableDashboard && commandName === 'execute') {
                const script = args[0];
                if (script && typeof script === 'string' && (script.startsWith('xenon') || script.startsWith('devicefarm'))) {
                    const dashboardCmd = script.split(':')[1]?.trim();
                    if (dashboardCmd) {
                        // This would need to call plugin.executeDashboardCommand, or we move it to a service
                        // For now, let's assume we can handle it or pass it back.
                        // (Re-evaluating: better to keep it in plugin.ts if it impacts other systems or move it to a DashboardService)
                    }
                }
            }

            const response = await next();

            if (isHub && !!pluginArgs.enableDashboard && SESSION_MANAGER.isValidSession(sessionId)) {
                await DASHBORD_EVENT_MANAGER.afterSessionCommand(
                    sessionId, commandName, driver,
                    { body: args, method: 'POST', path: `/${commandName}`, originalUrl: `/${commandName}` } as any,
                    {} as any, JSON.stringify({ value: response, sessionId })
                );

                if (commandName === 'findElement' && response) {
                    this.triggerLearning(driver, args, response, sessionId);
                }
            }

            return response;
        } catch (error: any) {
            if (this.isNoSuchElementError(error) && ['findElement', 'findElements'].includes(commandName) && (pluginArgs.enableSelfHealing as boolean) !== false) {
                const healed = await Container.get(HealingOrchestrator).attemptHealing(sessionId, driver, args[0], args[1]);
                if (healed) {
                    await this.logHealingEvent(sessionId, commandName, driver, args, healed);
                    const elementResponse = { ELEMENT: healed.id, 'element-6066-11e4-a52e-4f735466cecf': healed.id };
                    return commandName === 'findElement' ? elementResponse : [elementResponse];
                }
            }

            if (isHub && !!pluginArgs.enableDashboard && sessionId) {
                await DASHBORD_EVENT_MANAGER.afterSessionCommand(
                    sessionId, commandName, driver,
                    { body: args, method: 'POST', path: `/${commandName}`, originalUrl: `/${commandName}` } as any,
                    {} as any, JSON.stringify({ value: { error: error.message || error }, sessionId })
                );
            }
            throw error;
        } finally {
            if (isHub && sessionId && span) tracingService.endSpan(`${sessionId}:${commandName}`);
        }
    }

    private isNoSuchElementError(error: any): boolean {
        return error.name === 'NoSuchElementError' || error.message?.includes('NoSuchElement') || error.status === 7;
    }

    private async handleOmniVisionSearch(sessionId: string, driver: any, commandName: string, strategy: string, selector: string) {
        const omniService = Container.get(OmniVisionService);
        let results: any[] = [];
        if (strategy === '-custom:ai-text') results = await omniService.findByText(driver, selector);
        else if (strategy === '-custom:ai-icon') {
            const match = await omniService.findByIcon(driver, selector);
            if (match) results = [match];
        }
        const appiumResults = results.map((r) => ({ ELEMENT: r.id, 'element-6066-11e4-a52e-4f735466cecf': r.id }));
        if (commandName === 'findElement') {
            if (appiumResults.length === 0) throw new Error('NoSuchElement: AI Vision failed to find matching element');
            return appiumResults[0];
        }
        return appiumResults;
    }

    private async handleVirtualElementCommand(sessionId: string, driver: any, commandName: string, elementId: string, value?: any) {
        const omniService = Container.get(OmniVisionService);
        const element = omniService.getVirtualElement(elementId);
        if (!element) throw new Error(`NoSuchElement: Virtual element ${elementId} not found`);

        const centerX = Math.round(element.rect.x + element.rect.width / 2);
        const centerY = Math.round(element.rect.y + element.rect.height / 2);

        switch (commandName) {
            case 'click':
                await driver.performActions([{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x: centerX, y: centerY }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 100 }, { type: 'pointerUp', button: 0 }] }]);
                return null;
            case 'getElementRect': return element.rect;
            case 'getElementLocation': return { x: element.rect.x, y: element.rect.y };
            case 'getElementSize': return { width: element.rect.width, height: element.rect.height };
            case 'getText': return element.text || '';
            case 'setValue':
                await driver.performActions([{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x: centerX, y: centerY }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 100 }, { type: 'pointerUp', button: 0 }] }]);
                try { return await driver.setValue(value, elementId); } catch (e) { return null; }
            default: throw new Error(`Command ${commandName} not supported for visual elements`);
        }
    }

    private async triggerLearning(driver: any, args: any[], response: any, sessionId: string) {
        const strategy = args[0];
        const selector = args[1];
        const elementId = response.ELEMENT || response['element-6066-11e4-a52e-4f735466cecf'];
        if (!elementId || typeof selector !== 'string') return;
        (async () => {
            try {
                const etalonService = Container.get(HealEtalonService);
                const anchors = ['content-desc', 'resource-id', 'text', 'name', 'id', 'hint'];
                const nodeAttrs: { name: string; value: string }[] = [];
                for (const attr of anchors) {
                    try { const val = await driver.getElementAttribute(elementId, attr); if (val) nodeAttrs.push({ name: attr, value: val }); } catch (e) { }
                }
                const nodeName = await driver.getElementTagName(elementId);

                // Path capture logic
                let resiliotreePathJson: any = null;
                try {
                    const { JSDOMParser, Path } = await import('resiliotree');
                    const pageSource = await driver.getPageSource();
                    const rootNode = new JSDOMParser().parse(pageSource);
                    const foundNode = this.findMatchingNode(rootNode, nodeName, nodeAttrs);
                    if (foundNode) {
                        const pathNodes: any[] = [];
                        let curr: any = foundNode;
                        while (curr) { pathNodes.unshift(curr); curr = curr.parent; }
                        resiliotreePathJson = new Path(pathNodes).toJSON();
                    }
                } catch (e) { }

                await etalonService.saveSignature(strategy, selector, { nodeName, attributes: nodeAttrs }, resiliotreePathJson);
            } catch (err: any) { this.log.debug(`[Learning] Failed: ${err.message}`); }
        })();
    }

    private findMatchingNode(root: any, tag: string, attributes: { name: string; value: string }[]): any {
        const attrMap = new Map(attributes.map((a) => [a.name.toLowerCase(), a.value]));
        const queue = [root];
        while (queue.length > 0) {
            const node = queue.shift();
            if (node.tag.toLowerCase() === tag.toLowerCase()) {
                let matchCount = 0;
                for (const [name, value] of attrMap) {
                    if (node.otherAttributes.get(name) === value || node.id === value || node.classes.has(value)) matchCount++;
                }
                if (matchCount > 0) return node;
            }
            if (node.children) queue.push(...node.children);
        }
        return null;
    }

    private async logHealingEvent(sessionId: string, commandName: string, driver: any, args: any[], healed: any) {
        await DASHBORD_EVENT_MANAGER.afterSessionCommand(
            sessionId, commandName, driver,
            { body: args, method: 'POST', path: `/${commandName}`, originalUrl: `/${commandName}` } as any,
            {} as any, JSON.stringify({ value: { ELEMENT: healed.id }, sessionId }),
            { originalSelector: args[1], healedSelector: healed.recommendedSelector, confidence: healed.confidence }
        );
    }
}
