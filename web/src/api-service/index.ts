import apiClient from './api-client';

export default class XenonApiService {
  public static getDevices() {
    return apiClient.makeGETRequest(`/device?t=${Date.now()}`);
  }

  public static getPendingSessionsCount() {
    return apiClient.makeGETRequest('/queue/length');
  }

  public static getPendingSessions() {
    return apiClient.makeGETRequest('/queue');
  }

  public static getQueueSummary() {
    return apiClient.makeGETRequest('/queue/summary');
  }

  public static getQueueStatus(capabilityId: string) {
    return apiClient.makeGETRequest(`/queue/status/${capabilityId}`);
  }

  public static getBuilds() {
    return apiClient.makeGETRequest('/build');
  }

  public static getSessions(
    options: {
      buildId?: string;
      query?: string;
      status?: string;
      platform?: string;
    } = {},
  ) {
    const ts = Date.now();
    let url = `/session?t=${ts}`;
    if (options.buildId) url += `&buildId=${encodeURIComponent(options.buildId)}`;
    if (options.query) url += `&query=${encodeURIComponent(options.query)}`;
    if (options.status) url += `&status=${encodeURIComponent(options.status)}`;
    if (options.platform) url += `&platform=${encodeURIComponent(options.platform)}`;
    return apiClient.makeGETRequest(url);
  }

  public static getSessionLogs(sessionId: string) {
    return apiClient.makeGETRequest(`/session/${sessionId}/session_log`);
  }

  public static getDeviceLogs(sessionId: string) {
    return apiClient.makeGETRequest(`/session/${sessionId}/logs/device`);
  }

  public static getDebugLogs(sessionId: string) {
    return apiClient.makeGETRequest(`/session/${sessionId}/logs/debug`);
  }

  public static getProfilingData(sessionId: string) {
    return apiClient.makeGETRequest(`/session/${sessionId}/profiling`);
  }

  public static omniScan(sessionId: string) {
    return apiClient.makeGETRequest(`/session/${sessionId}/xenon/omni-scan`);
  }

  public static omniScanControl(udid: string) {
    return apiClient.makeGETRequest(`/control/${udid}/omni-scan`);
  }

  public static testAiLocator(sessionId: string, strategy: string, selector: string) {
    return apiClient.makePOSTRequest(
      `/session/${sessionId}/xenon/test-locator`,
      {},
      { strategy, selector },
    );
  }

  public static testAiLocatorControl(udid: string, strategy: string, selector: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/test-locator`, {}, { strategy, selector });
  }

  public static blockDevice(udid: string, host: string) {
    return apiClient.makePOSTRequest('/block', {}, { udid, host });
  }

  public static unblockDevice(udid: string, host: string) {
    return apiClient.makePOSTRequest('/unblock', {}, { udid, host });
  }

  public static updateDeviceTags(udid: string, host: string, tags: string[]) {
    return apiClient.makePOSTRequest('/device/tags', {}, { udid, host, tags });
  }

  public static getSessionLiveVideoUrl(sessionId: string) {
    return apiClient.formatUrl(`/session/${sessionId}/live_video`);
  }

  /* Reservation Endpoints */
  public static getReservations() {
    return apiClient.makeGETRequest('/reservation');
  }

  public static reserveDevice(
    udid: string,
    host: string,
    reservedBy: string,
    duration: string | number,
    reason?: string,
  ) {
    return apiClient.makePOSTRequest(
      '/reservation',
      {},
      { udid, host, reservedBy, duration, reason },
    );
  }

  public static releaseReservation(udid: string, host: string) {
    return apiClient.makeDELETERequest(`/reservation/${udid}/${encodeURIComponent(host)}`);
  }

  public static extendReservation(udid: string, host: string, duration: string | number) {
    return apiClient.makePOSTRequest(
      `/reservation/${udid}/${encodeURIComponent(host)}/extend`,
      {},
      { duration },
    );
  }

  public static getAssetUrl(assetPath?: string | null) {
    if (!assetPath) {
      return '';
    }
    return `/xenon/assets/${assetPath.replace(/^\//, '')}`;
  }

  /* Control Endpoints */
  public static tap(udid: string, x: number, y: number) {
    return apiClient.makePOSTRequest(`/control/${udid}/tap`, {}, { x, y });
  }

  public static swipe(udid: string, x: number, y: number, endX: number, endY: number) {
    return apiClient.makePOSTRequest(`/control/${udid}/swipe`, {}, { x, y, endX, endY });
  }

  public static typeText(udid: string, text: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/text`, {}, { text });
  }

  public static pressKey(udid: string, keyCode: string | number) {
    return apiClient.makePOSTRequest(`/control/${udid}/keyevent`, {}, { keyCode });
  }

  public static getClipboard(udid: string) {
    return apiClient.makeGETRequest(`/control/${udid}/clipboard`);
  }

  public static setClipboard(udid: string, content: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/clipboard`, {}, { content });
  }

  public static getScreenshot(udid: string) {
    return apiClient.makeGETRequest(`/control/${udid}/screenshot`);
  }

  public static touchAndHold(udid: string, x: number, y: number, duration: number) {
    return apiClient.makePOSTRequest(`/control/${udid}/touchAndHold`, {}, { x, y, duration });
  }

  public static lock(udid: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/lock`, {}, {});
  }

  public static unlock(udid: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/unlock`, {}, {});
  }

  public static installApp(udid: string, appPath: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/install`, {}, { appPath });
  }

  public static startStream(udid: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/stream/start`, {}, {});
  }

  public static stopStream(udid: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/stream/stop`, {}, {});
  }

  public static uninstallApp(udid: string, bundleId: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/uninstall`, {}, { bundleId });
  }
  public static uploadAndInstallApp(udid: string, file: File) {
    const formData = new FormData();
    formData.append('app', file);
    // Use raw fetch for multipart upload as our apiClient might be configured for JSON
    return fetch(`/xenon/api/control/${udid}/upload-install`, {
      method: 'POST',
      body: formData,
    }).then((res) => res.json());
  }

  public static listApps(udid: string) {
    return apiClient.makeGETRequest(`/control/${udid}/apps`);
  }

  public static getLogs(udid: string) {
    return apiClient.makeGETRequest(`/control/${udid}/logs`);
  }

  /* App Repository Endpoints */
  public static getApps() {
    return apiClient.makeGETRequest('/apps');
  }

  public static uploadApp(file: File) {
    const formData = new FormData();
    formData.append('app', file);
    return fetch('/xenon/api/apps/upload', {
      method: 'POST',
      body: formData,
    }).then((res) => res.json());
  }

  public static deleteApp(id: string) {
    return apiClient.makeDELETERequest(`/apps/${id}`);
  }

  public static installRepositoryApp(udid: string, appId: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/install-repository-app`, {}, { appId });
  }

  public static executeShell(udid: string, command: string) {
    return apiClient.makePOSTRequest(`/control/${udid}/shell`, {}, { command });
  }

  /* Webhook Endpoints */
  public static getWebhookConfigs() {
    return apiClient.makeGETRequest('/webhook');
  }

  public static addWebhookConfig(
    url: string,
    events: string[],
    type: string,
    payloadTemplate?: string,
  ) {
    return apiClient.makePOSTRequest('/webhook', {}, { url, events, type, payloadTemplate });
  }

  public static deleteWebhookConfig(id: string) {
    return apiClient.makeDELETERequest(`/webhook/${id}`);
  }

  public static testWebhook(url: string, type: string) {
    return apiClient.makePOSTRequest('/webhook/test', {}, { url, type });
  }

  /* Global Config Endpoints */
  public static getGlobalConfig() {
    return apiClient.makeGETRequest('/config');
  }

  public static updateGlobalConfig(config: any) {
    return apiClient.makePOSTRequest('/config', {}, config);
  }

  public static testAIConfig(config: any) {
    return apiClient.makePOSTRequest('/config/test-ai', {}, config);
  }

  public static resetMetrics() {
    return apiClient.makePOSTRequest('/config/reset-metrics', {}, {});
  }
}
