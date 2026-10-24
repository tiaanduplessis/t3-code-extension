// Maps stack frames from minified bundles back to original sources when the
// page publishes source maps. Maps load through the attached debugger session
// (Network.loadNetworkResource), so the request runs in the page's own network
// context with its cookies and needs no host permissions. Network.enable is
// not required for that; Page.getFrameTree only supplies the frame id.

import { FlattenMap, traceSegment, type TraceMap } from "@jridgewell/trace-mapping";

/** CDP call frame: 0-based line and column. */
export interface StackFrame {
  functionName?: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

/** 1-based line and column. */
export interface OriginalPosition {
  source: string;
  line: number;
  column: number;
  name?: string;
}

/** From Debugger.scriptParsed. */
export interface ScriptInfo {
  url: string;
  sourceMapURL?: string;
}

export interface SourceMapHandle {
  map: TraceMap;
  scriptUrl: string;
  /** Base for relative source paths: the map URL, or the script URL for inline maps. */
  baseUrl: string;
}

export type SendCommand = (method: string, params?: object) => Promise<any>;

export interface LoadOptions {
  /** Epoch ms. */
  deadline: number;
  maxMaps?: number;
  /** Per map. */
  maxBytes?: number;
}

const DEFAULT_MAX_MAPS = 5;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const READ_CHUNK = 1024 * 1024;

class LoadAborted extends Error {}

/** Loads source maps for scripts in `wantedUrls`; failures are skipped. Never throws. */
export async function loadSourceMaps(
  send: SendCommand,
  scripts: ScriptInfo[],
  wantedUrls: Set<string>,
  options: LoadOptions,
): Promise<Map<string, SourceMapHandle>> {
  const maxMaps = options.maxMaps ?? DEFAULT_MAX_MAPS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const { deadline } = options;

  const candidates = new Map<string, string>();
  for (const script of scripts) {
    if (candidates.size >= maxMaps) break;
    if (!script.sourceMapURL || !wantedUrls.has(script.url) || candidates.has(script.url)) continue;
    candidates.set(script.url, script.sourceMapURL);
  }

  let frameId: Promise<string> | undefined;
  const mainFrameId = () => {
    frameId ??= withDeadline(send("Page.getFrameTree"), deadline).then((result) => {
      const id = result?.frameTree?.frame?.id;
      if (typeof id !== "string") throw new LoadAborted("no frame id");
      return id;
    });
    return frameId;
  };

  const maps = new Map<string, SourceMapHandle>();
  await Promise.all(
    [...candidates].map(async ([scriptUrl, sourceMapURL]) => {
      try {
        if (Date.now() >= deadline) return;
        let text: string;
        let baseUrl: string;
        if (sourceMapURL.startsWith("data:")) {
          text = decodeDataUrl(sourceMapURL, maxBytes);
          baseUrl = scriptUrl;
        } else {
          const url = new URL(sourceMapURL, scriptUrl);
          if (url.protocol !== "http:" && url.protocol !== "https:") return;
          baseUrl = url.href;
          text = await loadRemote(send, await mainFrameId(), baseUrl, deadline, maxBytes);
        }
        if (Date.now() >= deadline) return;
        const map = parseMap(text, baseUrl);
        if (map) maps.set(scriptUrl, { map, scriptUrl, baseUrl });
      } catch {
        // Missing, oversized, slow or malformed maps leave the frame unmapped.
      }
    }),
  );
  return maps;
}

/** Returns null when no map covers the frame. Never throws. */
export function symbolicate(maps: Map<string, SourceMapHandle>, frame: StackFrame): OriginalPosition | null {
  try {
    const handle = maps.get(frame.url);
    if (!handle) return null;
    const segment = traceSegment(handle.map, frame.lineNumber, frame.columnNumber);
    if (!segment || segment.length < 4) return null;
    const [, sourceIndex, line, column, nameIndex] = segment;
    const raw = sourceIndex === undefined ? undefined : handle.map.sources[sourceIndex];
    if (raw == null || line === undefined || column === undefined) return null;
    const position: OriginalPosition = {
      source: displaySource(raw, handle.map.sourceRoot, handle.baseUrl),
      line: line + 1,
      column: column + 1,
    };
    const name = nameIndex === undefined ? undefined : handle.map.names[nameIndex];
    if (name) position.name = name;
    return position;
  } catch {
    return null;
  }
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const BUNDLER_PREFIX = /^(?:webpack|turbopack):\/\/[^/]*\/(?:\[project\]\/)?/;

/** Turns a map's source entry into a short, relative-looking path such as src/checkout/total.ts. */
export function displaySource(raw: string, sourceRoot: string | undefined, baseUrl: string): string {
  // Rollup and Vite mark virtual modules (\0vite/preload-helper) with a NUL byte.
  if (raw.startsWith("\0")) return raw.slice(1);
  let source = raw;
  if (sourceRoot && !SCHEME.test(source)) {
    source = sourceRoot.endsWith("/") || source.startsWith("/") ? sourceRoot + source : `${sourceRoot}/${source}`;
  }

  if (BUNDLER_PREFIX.test(source)) return normalizePath(source.replace(BUNDLER_PREFIX, ""));
  if (source.startsWith("file://")) return safeDecode(source.slice("file://".length));
  if (source.startsWith("/@fs/")) return source.slice("/@fs".length);
  if (source.startsWith("/")) return source;

  try {
    const base = new URL(baseUrl);
    const resolved = new URL(source, baseUrl);
    if (resolved.origin !== base.origin || !resolved.protocol.startsWith("http")) return source;
    const path = safeDecode(resolved.pathname);
    return path.startsWith("/@fs/") ? path.slice("/@fs".length) : path.slice(1);
  } catch {
    return source;
  }
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "." || part === "") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parseMap(text: string, baseUrl: string): TraceMap | null {
  // The spec allows an XSSI guard line such as )]}' before the JSON.
  const json = text.startsWith(")]}") ? text.slice(text.indexOf("\n") + 1) : text;
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as { mappings?: unknown; sections?: unknown; sources?: unknown };
  const valid = Array.isArray(candidate.sections) || (typeof candidate.mappings === "string" && Array.isArray(candidate.sources));
  if (!valid) return null;
  return new FlattenMap(parsed as ConstructorParameters<typeof FlattenMap>[0], baseUrl);
}

function decodeDataUrl(url: string, maxBytes: number): string {
  const comma = url.indexOf(",");
  if (comma < 0) throw new LoadAborted("malformed data URL");
  const meta = url.slice("data:".length, comma);
  const payload = url.slice(comma + 1);
  // Base64 and percent-encoding both take at least as many characters as decoded bytes.
  if (payload.length > maxBytes * 4) throw new LoadAborted("too large");
  const bytes = meta.split(";").includes("base64") ? base64ToBytes(payload) : new TextEncoder().encode(decodeURIComponent(payload));
  if (bytes.byteLength > maxBytes) throw new LoadAborted("too large");
  return new TextDecoder().decode(bytes);
}

async function loadRemote(send: SendCommand, frameId: string, url: string, deadline: number, maxBytes: number): Promise<string> {
  const request = send("Network.loadNetworkResource", { frameId, url, options: { disableCache: false, includeCredentials: true } });
  const closeStream = (handle: unknown) => {
    if (typeof handle === "string") send("IO.close", { handle }).catch(() => undefined);
  };
  let result;
  try {
    result = await withDeadline(request, deadline);
  } catch (error) {
    // A response that arrives after the deadline still holds an open stream.
    request.then((late) => closeStream(late?.resource?.stream)).catch(() => undefined);
    throw error;
  }
  const resource = result?.resource;
  const handle: unknown = resource?.stream;
  if (typeof handle !== "string") throw new LoadAborted("no stream");
  const close = () => closeStream(handle);

  const status: unknown = resource.httpStatusCode;
  const length = Number(headerValue(resource.headers, "content-length"));
  if (!resource.success || (typeof status === "number" && (status < 200 || status >= 300)) || length > maxBytes) {
    close();
    throw new LoadAborted("unusable response");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await withDeadline(send("IO.read", { handle, size: READ_CHUNK }), deadline);
      const data = typeof chunk?.data === "string" ? chunk.data : "";
      const bytes = chunk?.base64Encoded ? base64ToBytes(data) : new TextEncoder().encode(data);
      total += bytes.byteLength;
      if (total > maxBytes) throw new LoadAborted("too large");
      chunks.push(bytes);
      if (chunk?.eof) break;
      if (data.length === 0) throw new LoadAborted("empty chunk before eof");
    }
  } finally {
    close();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const bytes of chunks) {
    body.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return new TextDecoder().decode(body);
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === "string") return value;
  }
  return undefined;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new LoadAborted("deadline"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LoadAborted("deadline")), remaining);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
