import type { XenonTool } from './tool';

/**
 * The `instructions` `/xenon/mcp` answers `initialize` with: the order the
 * tools are used in, for an agent that has no skill or prompt saying so.
 *
 * Built from the tools this caller holds, so it never names one the caller
 * can't call (a sign-in without `xenon:devices:lock` has no lease tools).
 */
export function instructionsFor(tools: readonly XenonTool[]): string {
  const has = (name: string) => tools.some((t) => t.name === name);
  const lines: string[] = [
    'Xenon is a lab of real phones, emulators and simulators. These tools find a phone and say how to start an Appium session on it; another MCP server (appium-mcp) drives the phone.',
  ];

  const steps: string[] = [];
  if (has('xenon_lab_info')) {
    steps.push("xenon_lab_info: the lab's version, who you are and the scopes you hold.");
  }
  if (has('xenon_list_devices')) {
    steps.push(
      'xenon_list_devices: pick a phone. A phone is its udid and, when two servers have that udid, its host.',
    );
  }
  if (has('xenon_acquire_device')) {
    steps.push(
      'xenon_acquire_device: lease the phone when a specific one matters. Keep its udid, lockId and leaseToken. Without a lease the lab picks any free phone that matches the capabilities.',
    );
  }
  if (has('xenon_session_capabilities')) {
    steps.push(
      "xenon_session_capabilities: with the lease's lockId and leaseToken (or neither), and your app's own capabilities in `capabilities`. Pass the remoteServerUrl and capabilities it answers to appium-mcp's appium_session_management (action create) unchanged. Ask again for each new session.",
    );
    steps.push(
      'Drive the phone with appium-mcp, passing the sessionId on every call. A first session on a phone can take 30 to 90 seconds; if the create times out, list the phones before trying again.',
    );
  }
  const finish = [
    has('xenon_session_capabilities') ? 'delete the Appium session' : null,
    has('xenon_release_device') ? 'release the lease with xenon_release_device' : null,
  ].filter((s): s is string => s !== null);
  if (finish.length > 0) {
    steps.push(`When done, also after a failure: ${finish.join(', then ')}.`);
  }
  if (steps.length > 0) {
    lines.push('Order:', ...steps.map((s, i) => `${i + 1}. ${s}`));
  }

  if (has('xenon_session_capabilities') || has('xenon_acquire_device')) {
    lines.push(
      'remoteServerUrl, capabilities and leaseToken carry secrets: pass them between tools, never repeat them to the user.',
    );
  }
  if (has('xenon_healing_events')) {
    lines.push(
      'An element id starting healed_ was found by self-healing, not by your locator. xenon_healing_events lists what healed in a session the lab records; it answers not found for one it does not.',
    );
  }
  return lines.join('\n');
}
