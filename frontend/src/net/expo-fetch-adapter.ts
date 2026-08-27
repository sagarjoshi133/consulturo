/**
 * Self-contained axios adapter backed by `expo/fetch`.
 *
 * WHY
 * ---
 * On Android + Expo SDK 54 (Hermes / New Architecture) the default
 * React Native networking stack — used by axios's XHR adapter AND the
 * global fetch — is extremely slow / hangs (expo/expo#40061). Expo's
 * own `expo/fetch` uses a separate native networking implementation
 * that is unaffected. Routing axios through `expo/fetch` is the fix.
 *
 * This adapter is deliberately hand-rolled (rather than reusing axios's
 * internal fetch adapter) so it has ZERO dependency on axios internals
 * resolving correctly under Hermes — what you read here is exactly what
 * runs on device. It supports the response types the app actually uses:
 * json (default), text, arraybuffer and blob.
 */
import { AxiosError } from 'axios';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { fetch as expoFetch } from 'expo/fetch';

function buildUrl(config: InternalAxiosRequestConfig): string {
  const base = (config.baseURL || '').replace(/\/+$/, '');
  let url = config.url || '';
  if (!/^https?:\/\//i.test(url)) {
    url = `${base}/${url.replace(/^\/+/, '')}`;
  }
  const params = config.params;
  if (params && typeof params === 'object') {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        value.forEach((v) => v != null && qs.append(key, String(v)));
      } else {
        qs.append(key, String(value));
      }
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return url;
}

function normalizeHeaders(config: InternalAxiosRequestConfig): Record<string, string> {
  const raw: any = config.headers || {};
  const out: Record<string, string> = {};
  // AxiosHeaders exposes .toJSON(); plain objects are spread directly.
  const src = typeof raw.toJSON === 'function' ? raw.toJSON() : raw;
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

function statusCode(status: number): string {
  return [AxiosError.ERR_BAD_REQUEST, AxiosError.ERR_BAD_RESPONSE][Math.floor(status / 100) - 4] || AxiosError.ERR_BAD_RESPONSE;
}

export const expoFetchAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  const url = buildUrl(config);
  const method = (config.method || 'get').toUpperCase();
  const headers = normalizeHeaders(config);

  // Compose the caller's signal (if any) with a timeout-driven abort.
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = typeof config.timeout === 'number' ? config.timeout : 0;
  const timer = timeoutMs > 0
    ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs)
    : null;
  const callerSignal = config.signal as AbortSignal | undefined;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const body: any = method === 'GET' || method === 'HEAD' ? undefined : config.data;

  try {
    const resp = await expoFetch(url, { method, headers, body, signal: controller.signal });

    const responseType = (config.responseType || 'json').toLowerCase();
    let data: any;
    if (responseType === 'arraybuffer') {
      data = await resp.arrayBuffer();
    } else if (responseType === 'blob') {
      data = await resp.blob();
    } else if (responseType === 'text') {
      data = await resp.text();
    } else {
      // json (default): parse ourselves so error interceptors that read
      // response.data.detail work, and transformResponse leaves objects.
      const text = await resp.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    }

    const responseHeaders: Record<string, string> = {};
    resp.headers.forEach((value: string, key: string) => { responseHeaders[key] = value; });

    const response: AxiosResponse = {
      data,
      status: resp.status,
      statusText: resp.statusText,
      headers: responseHeaders,
      config: config as AxiosRequestConfig,
      request: { responseURL: url },
    };

    const validate = config.validateStatus;
    if (!validate || validate(resp.status)) {
      return response;
    }
    throw new AxiosError(
      `Request failed with status code ${resp.status}`,
      statusCode(resp.status),
      config,
      response.request,
      response,
    );
  } catch (err: any) {
    if (err instanceof AxiosError) throw err;
    if (timedOut || err?.name === 'AbortError') {
      const reason = timedOut ? AxiosError.ECONNABORTED : AxiosError.ERR_CANCELED;
      throw new AxiosError(
        timedOut ? `timeout of ${timeoutMs}ms exceeded` : 'Request aborted',
        reason,
        config,
        { responseURL: url },
      );
    }
    throw new AxiosError(
      err?.message || 'Network Error',
      AxiosError.ERR_NETWORK,
      config,
      { responseURL: url },
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }
};
