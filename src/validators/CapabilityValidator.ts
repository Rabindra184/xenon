import { z } from 'zod';
import { Service } from 'typedi';
import { XENON_CAPABILITIES } from '../XenonCapabilityManager';

/**
 * Zod Schema for Appium Capabilities
 * Focuses on critical fields required for session allocation and infrastructure management.
 */
export const CapabilitySchema = z.object({
    platformName: z.string().toLowerCase().refine((val) => ['android', 'ios', 'tvos'].includes(val), {
        message: "platformName must be one of: android, ios, tvos",
    }),

    // Appium specific caps (with and without prefix)
    'appium:automationName': z.string().optional(),
    'automationName': z.string().optional(),

    'appium:udid': z.string().optional(),
    'udid': z.string().optional(),

    'appium:platformVersion': z.string().optional(),
    'platformVersion': z.string().optional(),

    'appium:deviceName': z.string().optional(),
    'deviceName': z.string().optional(),

    'appium:app': z.string().optional(),
    'app': z.string().optional(),

    // Standard Appium Timeouts & Reset strategies
    'appium:newCommandTimeout': z.number().int().min(0).max(1800).optional(),
    'newCommandTimeout': z.number().int().min(0).max(1800).optional(),

    'appium:noReset': z.boolean().optional(),
    'noReset': z.boolean().optional(),

    'appium:fullReset': z.boolean().optional(),
    'fullReset': z.boolean().optional(),

    // Xenon Specific Options (Enterprise Features)
    [XENON_CAPABILITIES.BUILD_NAME]: z.string().optional(),
    [XENON_CAPABILITIES.SESSION_NAME]: z.string().optional(),

    // Xenon Network Conditioning (Roadmap Item 2)
    'xenon:networkProfile': z.enum(['4G', '3G', 'Edge', 'Offline', 'Normal']).optional(),

    // Predictive Failure Thresholds (Roadmap Item 1)
    'xenon:minBatteryLevel': z.number().int().min(1).max(100).optional().default(10),
    'xenon:maxThermalStatus': z.enum(['Normal', 'Hot', 'Critical']).optional().default('Hot'),

    // Advanced Resource Isolation (Roadmap Item 3)
    'xenon:isolationProfile': z.enum(['Economy', 'Performance', 'Guaranteed']).optional().default('Performance'),

    // Core capabilities using the enum defined in XenonCapabilityManager
    [XENON_CAPABILITIES.VIDEO_RECORDING]: z.union([z.boolean(), z.string()]).optional(),
    [XENON_CAPABILITIES.RECORD_VIDEO]: z.union([z.boolean(), z.string()]).optional(),

    [XENON_CAPABILITIES.SCREENSHOT_ON_FAILURE]: z.union([z.boolean(), z.string()]).optional(),
    [XENON_CAPABILITIES.SCREENSHOT_ON_FAIL]: z.union([z.boolean(), z.string()]).optional(),

    [XENON_CAPABILITIES.SCREENSHOT_ON_EVERY_COMMAND]: z.union([z.boolean(), z.string()]).optional(),
    [XENON_CAPABILITIES.SCREENSHOT_EVERY_COMMAND]: z.union([z.boolean(), z.string()]).optional(),

    [XENON_CAPABILITIES.SAVE_DEVICE_LOGS]: z.union([z.boolean(), z.string()]).optional(),
    [XENON_CAPABILITIES.SAVE_LOGS]: z.union([z.boolean(), z.string()]).optional(),

    // Legacy/Additional snake_case/camelCase aliases not covered by the main enum
    'buildName': z.string().optional(),
    'sessionName': z.string().optional(),
}).passthrough();

export type ValidatedCapabilities = z.infer<typeof CapabilitySchema>;

/**
 * Principal Capability Validator
 * Performs strict validation and "Fails Fast" before resource allocation.
 */
@Service()
export class CapabilityValidator {
    /**
     * Validates the merged capabilities from alwaysMatch and firstMatch.
     * @param caps The merged capability object
     * @returns Validated object or throws error
     */
    public validate(caps: Record<string, any>): ValidatedCapabilities {
        const result = CapabilitySchema.safeParse(caps);

        if (!result.success) {
            const error = result.error.issues[0];
            const field = error.path.join('.');
            throw new Error(`[Xenon] Invalid Capability: '${field}' - ${error.message}`);
        }

        return result.data;
    }
}
