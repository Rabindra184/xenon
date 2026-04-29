// Module-level toast emitter. The api-client is a plain (non-React) module,
// but it needs to surface a 'forbidden' toast on 403 so a Member who hits
// an admin-only route gets immediate feedback instead of a silent failure.
//
// The ToastProvider (web/src/components/ui/toast.tsx) registers its
// `toast(...)` callback here on mount via `setApiToastEmitter`, and the
// api-client invokes it from `jsonResult` when a 403 comes back.
type ToastFn = (message: string, type?: 'success' | 'error' | 'info' | 'loading') => void;
let toastEmitter: ToastFn | null = null;

export function setApiToastEmitter(fn: ToastFn | null): void {
  toastEmitter = fn;
}

class ApiClient {
  public makeGETRequest(url: string) {
    return fetch(this.formatUrl(url)).then(this.jsonResult);
  }

  public makePOSTRequest(url: string, queryParams: any, body: any, options: RequestInit = {}) {
    return fetch(this.formatUrl(url), {
      method: 'POST',
      body: JSON.stringify(body || {}),
      headers: { 'Content-Type': 'application/json' },
      ...options,
    }).then(this.jsonResult);
  }

  public makeDELETERequest(url: string) {
    return fetch(this.formatUrl(url), {
      method: 'DELETE',
    }).then(this.jsonResult);
  }

  public formatUrl(url: string) {
    return `/xenon/api${url}`;
  }

  private async jsonResult(res: Response) {
    if (res.status === 403) {
      const body = await res.clone().json().catch(() => ({}) as any);
      const msg =
        (body && (body.error || body.message)) ||
        'You do not have permission for this action.';
      if (toastEmitter) {
        toastEmitter(msg, 'error');
      }
    }
    return res.json();
  }
}

export default new ApiClient();
