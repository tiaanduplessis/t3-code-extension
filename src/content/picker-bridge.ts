import type { PickedElement } from "../shared/capture-types";

// Runs in the ISOLATED world next to picker.ts and forwards its result to the
// background worker. The page can post the same messages, so every field is
// validated and copied into a fresh object before it leaves the page.

const INSTALLED_FLAG = "__t3CodePickerBridge";
const MESSAGE_SOURCE = "t3-code-picker";

const LIMITS = {
  selector: 2_000,
  tag: 100,
  text: 300,
  html: 2_000,
  pageUrl: 4_000,
  attributeCount: 50,
  attributeName: 100,
  attributeValue: 500,
  components: 5,
  componentName: 200,
  sourceFile: 1_000,
} as const;

type Framework = NonNullable<PickedElement["framework"]>;
type Source = NonNullable<Framework["source"]>;

function cap(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readRect(value: unknown): PickedElement["rect"] | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  return isNumber(x) && isNumber(y) && isNumber(width) && isNumber(height) ? { x, y, width, height } : null;
}

function readViewport(value: unknown): PickedElement["viewport"] | null {
  if (!isRecord(value)) return null;
  const { width, height } = value;
  return isNumber(width) && isNumber(height) ? { width, height } : null;
}

function readAttributes(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const [name, attribute] of Object.entries(value).slice(0, LIMITS.attributeCount)) {
    if (typeof attribute !== "string" || !name || name.length > LIMITS.attributeName) continue;
    if (name.toLowerCase() === "value") continue;
    result[name] = cap(attribute, LIMITS.attributeValue);
  }
  return result;
}

function readSource(value: unknown): Source | undefined {
  if (!isRecord(value) || typeof value.file !== "string" || !value.file) return undefined;
  const source: Source = { file: cap(value.file, LIMITS.sourceFile) };
  if (isNumber(value.line)) source.line = value.line;
  if (isNumber(value.column)) source.column = value.column;
  return source;
}

function readFramework(value: unknown): Framework | undefined {
  if (!isRecord(value)) return undefined;
  const { name, components } = value;
  if (name !== "react" && name !== "vue" && name !== "svelte") return undefined;
  if (!Array.isArray(components)) return undefined;
  const framework: Framework = {
    name,
    components: components
      .filter((component): component is string => typeof component === "string" && component.length > 0)
      .slice(0, LIMITS.components)
      .map((component) => cap(component, LIMITS.componentName)),
  };
  const source = readSource(value.source);
  if (source) framework.source = source;
  return framework;
}

/** Returns a fresh, capped copy of a picked element, or null when the shape is wrong. */
export function validatePickedElement(value: unknown): PickedElement | null {
  if (!isRecord(value)) return null;
  const { selector, tag, text, html, pageUrl } = value;
  if (typeof selector !== "string" || !selector) return null;
  if (typeof tag !== "string" || !tag) return null;
  if (typeof html !== "string" || typeof pageUrl !== "string") return null;
  if (text !== undefined && typeof text !== "string") return null;
  const rect = readRect(value.rect);
  const viewport = readViewport(value.viewport);
  const attributes = readAttributes(value.attributes);
  if (!rect || !viewport || !attributes) return null;

  const element: PickedElement = {
    selector: cap(selector, LIMITS.selector),
    tag: cap(tag, LIMITS.tag),
    attributes,
    rect,
    viewport,
    html: cap(html, LIMITS.html),
    pageUrl: cap(pageUrl, LIMITS.pageUrl),
  };
  if (text) element.text = cap(text, LIMITS.text);
  const framework = readFramework(value.framework);
  if (framework) element.framework = framework;
  return element;
}

function send(message: { type: "picker:result"; element: PickedElement } | { type: "picker:cancel" }): void {
  try {
    // Rejects when no listener exists; throws when the extension was reloaded.
    chrome.runtime.sendMessage(message)?.catch(() => {});
  } catch {
    // Nothing left to report to.
  }
}

/** Listens for one picker result or cancel and forwards it. Does nothing if already listening. */
export function installPickerBridge(): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope[INSTALLED_FLAG]) return;
  scope[INSTALLED_FLAG] = true;

  function onMessage(event: MessageEvent): void {
    if (event.source !== window) return;
    const data: unknown = event.data;
    if (!isRecord(data) || data.source !== MESSAGE_SOURCE) return;

    if (data.type === "cancel") {
      finish();
      send({ type: "picker:cancel" });
    } else if (data.type === "result") {
      const element = validatePickedElement(data.element);
      // Ignore malformed messages and keep waiting for the real result.
      if (!element) return;
      finish();
      send({ type: "picker:result", element });
    }
  }

  function finish(): void {
    window.removeEventListener("message", onMessage);
    delete scope[INSTALLED_FLAG];
  }

  window.addEventListener("message", onMessage);
}

installPickerBridge();
