/**
 * Typed HTTP client generated from `apiContract`.
 *
 * Owns: URL building, bearer auth, timeouts, JSON (de)serialisation, response validation
 * against the contract's output schema and mapping failures to `AppError`. Does not own
 * caching or retries (callers decide), nor any UI.
 */

import {
  API_TIMEOUT_MS,
  apiContract,
  isPublicRoute,
  AppError,
  appErrorFromResponse,
  type Asset,
  AssetSchema,
  buildPath,
  buildQueryString,
  isAppError,
  type RouteInput,
  type RouteName,
  type RouteOutput,
  type RouteQuery,
  UPLOAD_TIMEOUT_MS,
} from '@live-class/shared';

/** Options for `LiveClassApi`. */
export interface LiveClassApiOptions {
  /** Base URL of the server, for example `https://api.example.com` (no trailing slash). */
  readonly baseUrl: string;
  /** Returns the bearer token, or null for unauthenticated calls (login). */
  readonly getToken: () => string | Promise<string> | null;
  /** Fetch implementation (injectable for tests). */
  readonly fetchImpl?: typeof fetch;
  /** Per-call timeout in ms for JSON routes. */
  readonly timeoutMs?: number;
}

/** Arguments for one call. */
export interface CallArgs<K extends RouteName> {
  /** Values for `:param` placeholders in the route path. */
  readonly params?: Readonly<Record<string, string>>;
  /** JSON body for routes that declare `input`. */
  readonly body?: RouteInput<K>;
  /** Query string values for routes that declare `query`. */
  readonly query?: RouteQuery<K>;
  /** Caller-provided cancellation. */
  readonly signal?: AbortSignal;
}

/** Upload progress callback payload. */
export interface UploadProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
}

/**
 * Client for the Live Class REST API.
 *
 * @example
 *   const api = new LiveClassApi({ baseUrl, getToken: () => token });
 *   const me = await api.call('me', {});
 *   const page = await api.call('listQuestions', { query: { q: 'algebra' } });
 */
export class LiveClassApi {
  private readonly baseUrl: string;
  private readonly getToken: () => string | Promise<string> | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  /**
   * Creates a client.
   *
   * @param {LiveClassApiOptions} options - Base URL, token source and tunables.
   * @throws {Error} If no fetch implementation is available.
   */
  constructor(options: LiveClassApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.getToken = options.getToken;
    const fetchImpl =
      options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw new Error('LiveClassApi needs a fetch implementation');
    this.fetchImpl = fetchImpl;
    this.timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;
  }

  /**
   * Builds the absolute URL of a route.
   *
   * @param {RouteName} name - Route name from the contract.
   * @param {Readonly<Record<string, string>>} [params] - Path parameter values.
   * @returns {string} Absolute URL without a query string.
   * @throws {Error} If a path parameter is missing.
   */
  urlFor(name: RouteName, params: Readonly<Record<string, string>> = {}): string {
    return `${this.baseUrl}${buildPath(apiContract[name].path, params)}`;
  }

  /**
   * Calls a JSON route and validates the response against the contract.
   *
   * @param {K} name - Route name.
   * @param {CallArgs<K>} args - Path params, body, query and signal.
   * @returns {Promise<RouteOutput<K>>} The parsed, validated response body.
   * @throws {AppError} With the server's code for non-2xx responses, `NETWORK` when the
   *   request could not be sent, `TIMEOUT` when it took too long, or `INTERNAL` when the
   *   response did not match the contract.
   */
  async call<K extends RouteName>(name: K, args: CallArgs<K>): Promise<RouteOutput<K>> {
    const route = apiContract[name];
    const query: Readonly<Record<string, unknown>> | undefined = args.query;
    const url = `${this.urlFor(name, args.params)}${buildQueryString(query)}`;
    const headers = new Headers({ Accept: 'application/json' });
    if (!isPublicRoute(route)) {
      const token = await this.getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    const init: RequestInit = { method: route.method, headers };
    const body: unknown = args.body;
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }
    const response = await this.send(url, init, args.signal);
    const payload = await readJson(response);
    if (!response.ok) throw appErrorFromResponse(payload, `Request failed (${response.status})`);
    const parsed = route.output.safeParse(payload);
    if (!parsed.success) {
      throw new AppError('INTERNAL', `Unexpected response from ${route.path}`, {
        details: parsed.error.issues,
      });
    }
    return parsed.data as RouteOutput<K>;
  }

  /**
   * Uploads a file as `multipart/form-data` with progress reporting.
   *
   * @param {Blob} file - The bytes to upload (a `File` from an input, or any `Blob`).
   * @param {{ fileName?: string; onProgress?: (p: UploadProgress) => void; signal?: AbortSignal }} options - Optional file name, progress callback and cancellation.
   * @returns {Promise<Asset>} The validated asset record.
   * @throws {AppError} With the server's code (for example `UPLOAD_TOO_LARGE`), `NETWORK`,
   *   `TIMEOUT` or `INTERNAL`.
   */
  async uploadAsset(
    file: Blob,
    options: {
      readonly fileName?: string;
      readonly onProgress?: (progress: UploadProgress) => void;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<Asset> {
    const token = await this.getToken();
    const url = this.urlFor('uploadAsset');
    const form = new FormData();
    form.append('file', file, options.fileName ?? (file instanceof File ? file.name : 'upload'));
    const payload =
      typeof XMLHttpRequest === 'function'
        ? await this.uploadWithXhr(url, form, token, options)
        : await this.uploadWithFetch(url, form, token, options.signal);
    if (!payload.ok) throw appErrorFromResponse(payload.body, `Upload failed (${payload.status})`);
    const parsed = AssetSchema.safeParse(payload.body);
    if (!parsed.success) {
      throw new AppError('INTERNAL', 'Unexpected response from /assets', {
        details: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  /**
   * Absolute URL that streams an asset's file.
   *
   * @param {string} assetId - Identifier of the uploaded asset whose bytes are wanted.
   * @returns {string} URL for `getAssetFile`.
   */
  assetFileUrl(assetId: string): string {
    return this.urlFor('getAssetFile', { id: assetId });
  }

  /**
   * Absolute URL that streams an asset's thumbnail.
   *
   * @param {string} assetId - Identifier of the uploaded asset whose preview is wanted.
   * @returns {string} URL for `getAssetThumbnail`.
   */
  assetThumbnailUrl(assetId: string): string {
    return this.urlFor('getAssetThumbnail', { id: assetId });
  }

  /**
   * Sends a request with a timeout and maps transport failures to `AppError`.
   *
   * @param {string} url - Absolute URL.
   * @param {RequestInit} init - Fetch options.
   * @param {AbortSignal} [signal] - Caller cancellation.
   * @returns {Promise<Response>} The raw response.
   * @throws {AppError} `TIMEOUT` or `NETWORK`.
   */
  private async send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new AppError('TIMEOUT', `Request to ${url} timed out`));
    }, this.timeoutMs);
    const onAbort = (): void => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (isAppError(error)) throw error;
      if (isAppError(controller.signal.reason)) throw controller.signal.reason;
      throw new AppError('NETWORK', `Could not reach ${url}`, { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Browser upload with progress events.
   *
   * @param {string} url - Absolute URL of the upload route.
   * @param {FormData} form - Multipart body holding the file under the `file` field.
   * @param {string | null} token - Bearer token, or null when unauthenticated.
   * @param {{ onProgress?: (p: UploadProgress) => void; signal?: AbortSignal }} options - Progress callback and cancellation signal.
   * @returns {Promise<{ ok: boolean; status: number; body: unknown }>} Status and parsed body.
   * @throws {AppError} `NETWORK` or `TIMEOUT`.
   */
  private uploadWithXhr(
    url: string,
    form: FormData,
    token: string | null,
    options: {
      readonly onProgress?: (progress: UploadProgress) => void;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.timeout = UPLOAD_TIMEOUT_MS;
      xhr.responseType = 'text';
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          options.onProgress?.({ loadedBytes: event.loaded, totalBytes: event.total });
        }
      };
      xhr.onload = () => {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          body: parseJsonText(xhr.responseText),
        });
      };
      xhr.onerror = () => {
        reject(new AppError('NETWORK', `Could not reach ${url}`));
      };
      xhr.ontimeout = () => {
        reject(new AppError('TIMEOUT', 'Upload timed out'));
      };
      xhr.onabort = () => {
        reject(new AppError('NETWORK', 'Upload cancelled'));
      };
      options.signal?.addEventListener(
        'abort',
        () => {
          xhr.abort();
        },
        { once: true },
      );
      xhr.send(form);
    });
  }

  /**
   * Non-browser upload fallback without progress.
   *
   * @param {string} url - Absolute URL of the upload route.
   * @param {FormData} form - Multipart body holding the file under the `file` field.
   * @param {string | null} token - Bearer token, or null when unauthenticated.
   * @param {AbortSignal} [signal] - Caller-provided cancellation signal.
   * @returns {Promise<{ ok: boolean; status: number; body: unknown }>} Status and parsed body.
   * @throws {AppError} `NETWORK` or `TIMEOUT`.
   */
  private async uploadWithFetch(
    url: string,
    form: FormData,
    token: string | null,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await this.send(url, { method: 'POST', headers, body: form }, signal);
    return { ok: response.ok, status: response.status, body: await readJson(response) };
  }
}

/**
 * Reads a response body as JSON, tolerating empty and non-JSON bodies.
 *
 * @param {Response} response - Fetch response.
 * @returns {Promise<unknown>} Parsed JSON, the raw text when not JSON, or null when empty.
 */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return parseJsonText(text);
}

/**
 * Parses JSON text leniently.
 *
 * @param {string} text - Body text.
 * @returns {unknown} Parsed JSON, the raw text when not JSON, or null when empty.
 */
function parseJsonText(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
