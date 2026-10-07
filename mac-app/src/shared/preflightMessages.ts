// The sentences the pre-start check uses for its own blockers. Main writes them
// (ToolchainInspector) and the renderer reads them, so both take them from here.

export const portInUseMessage = (port: number) =>
  `Port ${port} is already in use by another app. Choose another port or close that app.`;

/** The port a portInUseMessage names, read from the sentence itself; null for any other sentence. */
export function portOfInUseMessage(message: string): number | null {
  const found = /^Port (\d+) /.exec(message);
  if (found === null) return null;
  const port = Number(found[1]);
  return portInUseMessage(port) === message ? port : null;
}

export const NOT_INSTALLED_MESSAGE = "Run Set up first. Xenon isn't installed in the Appium folder this profile uses.";
