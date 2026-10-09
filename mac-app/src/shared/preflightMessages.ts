// The sentences the pre-start check uses for its own blockers. Main writes them
// (ToolchainInspector) and the renderer reads them, so both take them from here.

export const portInUseMessage = (port: number) =>
  `Port ${port} is already in use by another app. Choose another port or close that app.`;

export const NOT_INSTALLED_MESSAGE = "Run Set up first. Xenon isn't installed in the Appium folder this profile uses.";
