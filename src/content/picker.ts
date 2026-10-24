import type { PickedElement } from "../shared/capture-types";

// Element picker injected into the page's MAIN world, so it can read the
// framework internals (React fibers, Vue instances, Svelte metadata) that
// development builds attach to DOM nodes. It reports to picker-bridge.ts
// through window.postMessage.
//
// The page shares this world, so the overlay avoids HTML and style sinks that
// Trusted Types or a strict style-src would block, and nothing here clones
// nodes (cloning runs custom element constructors).

const ACTIVE_FLAG = "__t3CodePickerActive";
const MESSAGE_SOURCE = "t3-code-picker";
const HOST_TAG = "t3-code-picker";
const MAX_TEXT = 300;
const MAX_HTML = 2_000;
const MAX_ATTRIBUTE = 500;
const MAX_COMPONENTS = 5;
const ACCENT = "#4f46e5";

type Framework = NonNullable<PickedElement["framework"]>;
type Source = NonNullable<Framework["source"]>;

/** Truncates to at most `max` characters, ending with "...". Applying it twice changes nothing. */
export function cap(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function escapeCss(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/[^\w-]/g, (char) => `\\${char}`);
}

function escapeAttributeValue(value: string): string {
  return value.replace(/["\\]/g, (char) => `\\${char}`);
}

function isUnique(selector: string, element: Element): boolean {
  try {
    const matches = element.ownerDocument.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

// IDs from useId, Radix, Headless UI, MUI, Ember and UUIDs change between renders or builds.
const GENERATED_ID = /:|^(?:radix-|headlessui-|mui-|react-aria|ember\d)|\d{4,}|^[a-f0-9]{8,}$|[a-f0-9]{8}-[a-f0-9]{4}/i;

export function isGeneratedId(id: string): boolean {
  return GENERATED_ID.test(id);
}

// css-1a2b3c (Emotion), sc-xyz (styled-components), jsx-123 (styled-jsx),
// svelte-abc12 (Svelte scoping), Button_root__a1B2c (CSS modules) and random tokens.
const HASHED_CLASS = [
  /^(?:css|sc|jsx|emotion|styled|svelte|astro)-[\w-]+$/i,
  /__(?=[\w-]*\d)[\w-]{5,}$/,
  /^_[\w-]{5,}$/,
  /^(?=[\w-]*\d)(?=[\w-]*[a-zA-Z])[a-zA-Z0-9]{6,}$/,
];

export function isHashedClass(name: string): boolean {
  // Classes with characters like ":" or "[" (Tailwind variants) make noisy selectors.
  if (!/^[a-zA-Z_][\w-]*$/.test(name)) return true;
  return HASHED_CLASS.some((pattern) => pattern.test(name));
}

function stableClasses(element: Element): string[] {
  return Array.from(element.classList).filter((name) => !isHashedClass(name));
}

const TEST_ATTRIBUTES = ["data-testid", "data-test-id", "data-test", "data-cy", "data-qa"];

function anchorSelector(element: Element): string | null {
  const id = element.getAttribute("id");
  if (id && !isGeneratedId(id)) {
    const selector = `#${escapeCss(id)}`;
    if (isUnique(selector, element)) return selector;
  }
  for (const name of TEST_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value) continue;
    const selector = `[${name}="${escapeAttributeValue(value)}"]`;
    if (isUnique(selector, element)) return selector;
  }
  return null;
}

function tagName(element: Element): string {
  return escapeCss(element.localName);
}

function segment(element: Element): string {
  let result = tagName(element);
  for (const name of stableClasses(element).slice(0, 2)) result += `.${escapeCss(name)}`;
  const parent = element.parentElement;
  if (parent) {
    const sameTag = Array.from(parent.children).filter((child) => child.localName === element.localName);
    if (sameTag.length > 1) {
      const sameSegment = sameTag.filter((child) => child.matches(result));
      if (sameSegment.length > 1) result += `:nth-of-type(${sameTag.indexOf(element) + 1})`;
    }
  }
  return result;
}

function nthChildPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tagName(current));
      break;
    }
    parts.unshift(`${tagName(current)}:nth-child(${Array.from(parent.children).indexOf(current) + 1})`);
    current = parent;
  }
  return parts.join(" > ");
}

const MAX_PATH_DEPTH = 6;

/** A short selector that matches only `element`, or a full nth-child path. */
export function buildSelector(element: Element): string {
  const anchor = anchorSelector(element);
  if (anchor) return anchor;

  const parts: string[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < MAX_PATH_DEPTH; depth++) {
    const ancestorAnchor = depth > 0 ? anchorSelector(current) : null;
    parts.unshift(ancestorAnchor ?? segment(current));
    const selector = parts.join(" > ");
    if (isUnique(selector, element)) return selector;
    if (ancestorAnchor) break;
    current = current.parentElement;
  }
  return nthChildPath(element);
}

const USEFUL_ATTRIBUTES = new Set([
  "id",
  "class",
  "role",
  "name",
  "type",
  "href",
  "src",
  "alt",
  "title",
  "placeholder",
  "for",
  "action",
  "method",
  "lang",
  ...TEST_ATTRIBUTES,
]);

export function usefulAttributes(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (name === "value") continue;
    if (USEFUL_ATTRIBUTES.has(name) || name.startsWith("aria-")) result[name] = cap(attribute.value, MAX_ATTRIBUTE);
  }
  return result;
}

export function visibleText(element: Element): string | undefined {
  // innerText is undefined on SVG elements.
  const raw = (element as HTMLElement).innerText ?? element.textContent ?? "";
  const text = raw.replace(/\s+/g, " ").trim();
  return text ? cap(text, MAX_TEXT) : undefined;
}

// Chrome serializes every attribute as name="value" with `"` escaped, so this
// tokenizer finds attribute boundaries exactly.
const INPUT_TAG = /<input\b(?:\s+[^\s"'>/=]+(?:="[^"]*")?)*\s*\/?>/gi;
const ATTRIBUTE = /\s+([^\s"'>/=]+)(?:="[^"]*")?/g;

/** Removes value attributes from every <input> tag in serialized HTML. */
export function stripInputValues(html: string): string {
  return html.replace(INPUT_TAG, (tag) =>
    tag.replace(ATTRIBUTE, (attribute, name: string) => (name.toLowerCase() === "value" ? "" : attribute)),
  );
}

export function serializeElement(element: Element): string {
  // Strip before capping so a cut-off value cannot leak a prefix.
  return cap(stripInputValues(element.outerHTML), MAX_HTML);
}

// Framework detection. Development builds attach internals to DOM nodes;
// everything here is best effort and must never throw.

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value !== null && (typeof value === "object" || typeof value === "function") ? (value as AnyRecord) : null;
}

function stringProp(value: unknown, key: string): string | undefined {
  const prop = asRecord(value)?.[key];
  return typeof prop === "string" && prop ? prop : undefined;
}

function numberProp(value: unknown, key: string): number | undefined {
  const prop = asRecord(value)?.[key];
  return typeof prop === "number" && Number.isFinite(prop) ? prop : undefined;
}

const WRAPPER_NAME = /^(?:ForwardRef|Memo|forwardRef|memo)\((.+)\)$/;
const INTERNAL_NAMES = new Set(["ForwardRef", "Memo", "Anonymous", "Component", "PureComponent", "Fragment"]);

function cleanComponentName(name: string | undefined): string | undefined {
  let current = name?.trim();
  for (let match = current?.match(WRAPPER_NAME); match; match = current?.match(WRAPPER_NAME)) current = match[1];
  if (!current || INTERNAL_NAMES.has(current)) return undefined;
  // One- and two-letter names come from minified production builds.
  if (/^[\w$]{1,2}$/.test(current)) return undefined;
  return current;
}

function pushName(names: string[], name: string | undefined): void {
  if (name && names.at(-1) !== name && names.length < MAX_COMPONENTS) names.push(name);
}

function findOwnKey(node: Element, prefixes: string[]): unknown {
  for (const key of Object.keys(node)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) return (node as unknown as AnyRecord)[key];
  }
  return undefined;
}

function reactTypeName(type: unknown): string | undefined {
  if (typeof type === "function") {
    return cleanComponentName(stringProp(type, "displayName")) ?? cleanComponentName(stringProp(type, "name"));
  }
  const record = asRecord(type);
  // Only forwardRef({ render }) and memo({ type }) wrappers; contexts and other objects are not components.
  if (!record || !("render" in record || "type" in record)) return undefined;
  return (
    cleanComponentName(stringProp(record, "displayName")) ??
    reactTypeName(record.render) ??
    (record.type !== type ? reactTypeName(record.type) : undefined)
  );
}

const NON_APP_FRAME = /node_modules|react-dom|react-jsx|react\.development|\/\.vite\/deps\/|chrome-extension:|<anonymous>/;

/** Normalizes a stack frame URL to something an agent can map to a repo file. */
export function normalizeSourceFile(raw: string): string {
  let file = raw.replace(/[?#].*$/, "");
  if (file.startsWith("webpack-internal:///")) {
    file = file.slice("webpack-internal:///".length).replace(/^\([^)]*\)\//, "");
  } else if (/^https?:\/\//.test(file)) {
    try {
      const url = new URL(file);
      if (url.origin === location.origin) file = url.pathname;
    } catch {
      // Keep the raw value.
    }
  }
  return file.replace(/^\/@fs\//, "/");
}

const FRAME_LOCATION = /((?:[a-z][\w+.-]*:\/{1,3}|\/)[^\s]*?):(\d+):(\d+)\)?\s*$/i;

/** First frame of a stack that points at application code, not React or dependencies. */
export function parseAppFrame(stack: string): Source | undefined {
  for (const line of stack.split("\n")) {
    const match = line.match(FRAME_LOCATION);
    if (!match?.[1] || NON_APP_FRAME.test(match[1])) continue;
    return { file: normalizeSourceFile(match[1]), line: Number(match[2]), column: Number(match[3]) };
  }
  return undefined;
}

function reactSource(fiber: unknown): Source | undefined {
  const debugSource = asRecord(asRecord(fiber)?._debugSource);
  const fileName = stringProp(debugSource, "fileName");
  if (fileName) {
    const source: Source = { file: fileName };
    const line = numberProp(debugSource, "lineNumber");
    const column = numberProp(debugSource, "columnNumber");
    if (line !== undefined) source.line = line;
    if (column !== undefined) source.column = column;
    return source;
  }
  const debugStack = asRecord(fiber)?._debugStack;
  const stack = typeof debugStack === "string" ? debugStack : stringProp(debugStack, "stack");
  return stack ? parseAppFrame(stack) : undefined;
}

const MAX_FIBER_STEPS = 500;

function detectReact(element: Element): Framework | undefined {
  let node: Element | null = element;
  let fiber: unknown;
  while (node && !fiber) {
    fiber = findOwnKey(node, ["__reactFiber$", "__reactInternalInstance$"]);
    node = node.parentElement;
  }
  if (!fiber) return undefined;

  const components: string[] = [];
  // The host fiber's own source points at the exact JSX that rendered the element.
  let source = reactSource(fiber);
  let current = asRecord(fiber);
  for (let steps = 0; current && components.length < MAX_COMPONENTS && steps < MAX_FIBER_STEPS; steps++) {
    const type = current.type;
    if (typeof type === "function" || (asRecord(type) && typeof type !== "string")) {
      const name = reactTypeName(type);
      if (name) {
        pushName(components, name);
        source ??= reactSource(current);
      }
    }
    current = asRecord(current.return);
  }
  if (!components.length && !source) return undefined;
  return source ? { name: "react", components, source } : { name: "react", components };
}

function detectVue(element: Element): Framework | undefined {
  let node: Element | null = element;
  let instance: AnyRecord | null = null;
  while (node && !instance) {
    instance = asRecord((node as unknown as AnyRecord).__vueParentComponent);
    node = node.parentElement;
  }
  if (!instance) return undefined;

  const components: string[] = [];
  let source: Source | undefined;
  for (let steps = 0; instance && components.length < MAX_COMPONENTS && steps < MAX_FIBER_STEPS; steps++) {
    const type = instance.type;
    const file = stringProp(type, "__file");
    const name =
      stringProp(type, "__name") ?? stringProp(type, "name") ?? stringProp(type, "displayName") ?? (file ? baseName(file) : undefined);
    pushName(components, cleanComponentName(name));
    if (!source && file) source = { file };
    instance = asRecord(instance.parent);
  }
  if (!components.length && !source) return undefined;
  return source ? { name: "vue", components, source } : { name: "vue", components };
}

function baseName(file: string): string {
  return (file.split(/[\\/]/).pop() ?? file).replace(/\.\w+$/, "");
}

function svelteLocation(loc: unknown): Source | undefined {
  const file = stringProp(loc, "file");
  if (!file) return undefined;
  const source: Source = { file };
  const line = numberProp(loc, "line");
  const column = numberProp(loc, "column");
  if (line !== undefined) source.line = line;
  if (column !== undefined) source.column = column;
  return source;
}

function detectSvelte(element: Element): Framework | undefined {
  const components: string[] = [];
  const add = (name: string | undefined) => {
    if (name && !components.includes(name) && components.length < MAX_COMPONENTS) components.push(name);
  };
  let source: Source | undefined;
  for (let node: Element | null = element; node && components.length < MAX_COMPONENTS; node = node.parentElement) {
    const meta = asRecord((node as unknown as AnyRecord).__svelte_meta);
    if (!meta) continue;
    const location = svelteLocation(meta.loc);
    if (location) {
      source ??= location;
      add(baseName(location.file));
    }
    // Svelte 5 dev chains the component stack on meta.parent.
    let parent = asRecord(meta.parent);
    for (let steps = 0; parent && steps < 50; steps++) {
      const file = stringProp(parent, "file");
      add(stringProp(parent, "componentTag") ?? (file ? baseName(file) : undefined));
      parent = asRecord(parent.parent);
    }
  }
  if (!components.length && !source) return undefined;
  return source ? { name: "svelte", components, source } : { name: "svelte", components };
}

export function detectFramework(element: Element): Framework | undefined {
  for (const detect of [detectReact, detectVue, detectSvelte]) {
    try {
      const result = detect(element);
      if (result) return result;
    } catch {
      // Framework internals are untyped page data; try the next one.
    }
  }
  return undefined;
}

export function buildPickedElement(element: Element): PickedElement {
  const rect = element.getBoundingClientRect();
  const picked: PickedElement = {
    selector: buildSelector(element),
    tag: element.localName,
    attributes: usefulAttributes(element),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    html: serializeElement(element),
    pageUrl: location.href,
  };
  const text = visibleText(element);
  if (text) picked.text = text;
  const framework = detectFramework(element);
  if (framework) picked.framework = framework;
  return picked;
}

// Overlay

function style(element: HTMLElement, rules: Record<string, string>): void {
  for (const [name, value] of Object.entries(rules)) element.style.setProperty(name, value, "important");
}

interface Overlay {
  host: HTMLElement;
  show(element: Element, label: string): void;
}

function createOverlay(): Overlay {
  const host = document.createElement(HOST_TAG);
  style(host, {
    all: "initial",
    position: "fixed",
    inset: "0",
    "z-index": "2147483647",
    "pointer-events": "none",
    display: "block",
  });
  const root = host.attachShadow({ mode: "closed" });
  const font = "12px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  const box = document.createElement("div");
  style(box, {
    position: "fixed",
    display: "none",
    "box-sizing": "border-box",
    border: `2px solid ${ACCENT}`,
    background: "rgba(79, 70, 229, 0.12)",
    "border-radius": "2px",
    "pointer-events": "none",
  });

  const label = document.createElement("div");
  style(label, {
    position: "fixed",
    display: "none",
    font,
    color: "#fff",
    background: ACCENT,
    padding: "2px 6px",
    "border-radius": "4px",
    "white-space": "nowrap",
    "max-width": "60vw",
    overflow: "hidden",
    "text-overflow": "ellipsis",
    "pointer-events": "none",
  });

  const hint = document.createElement("div");
  hint.textContent = "Click an element to send it to T3 Code. Press Esc to cancel.";
  style(hint, {
    position: "fixed",
    top: "8px",
    left: "50%",
    transform: "translateX(-50%)",
    font,
    color: "#fff",
    background: "rgba(17, 24, 39, 0.92)",
    padding: "6px 12px",
    "border-radius": "6px",
    "box-shadow": "0 2px 8px rgba(0, 0, 0, 0.25)",
    "pointer-events": "none",
  });

  root.append(box, label, hint);
  document.documentElement.append(host);

  return {
    host,
    show(element, text) {
      const rect = element.getBoundingClientRect();
      style(box, {
        display: "block",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      label.textContent = text;
      // Above the element when there is room, otherwise inside its top edge.
      const top = rect.top >= 22 ? rect.top - 22 : Math.max(rect.top, 0) + 2;
      const left = Math.min(Math.max(rect.left, 0), Math.max(window.innerWidth - 200, 0));
      style(label, { display: "block", left: `${left}px`, top: `${top}px` });
    },
  };
}

function shortLabel(element: Element): string {
  let label = element.localName;
  const id = element.getAttribute("id");
  if (id) label += `#${id}`;
  for (const name of stableClasses(element).slice(0, 2)) label += `.${name}`;
  return label;
}

function post(message: { type: "result"; element: PickedElement } | { type: "cancel" }): void {
  window.postMessage({ source: MESSAGE_SOURCE, ...message }, "*");
}

const SWALLOWED_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"];

/** Starts the picker unless it is already active. */
export function startPicker(): void {
  if ((window as unknown as AnyRecord)[ACTIVE_FLAG]) return;
  Object.defineProperty(window, ACTIVE_FLAG, { value: true, configurable: true, enumerable: false, writable: false });

  const overlay = createOverlay();
  const labels = new WeakMap<Element, string>();
  let hovered: Element | null = null;
  let frame = 0;

  function labelFor(element: Element): string {
    let label = labels.get(element);
    if (label === undefined) {
      const component = detectFramework(element)?.components[0];
      label = component ? `${shortLabel(element)} \u00b7 <${component}>` : shortLabel(element);
      labels.set(element, label);
    }
    return label;
  }

  function render(): void {
    frame = 0;
    if (hovered?.isConnected) overlay.show(hovered, labelFor(hovered));
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.target instanceof Element && event.target !== overlay.host) {
      hovered = event.target;
      schedule();
    }
  }

  function swallow(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== "click" || (event as MouseEvent).button !== 0) return;
    const target = event.target instanceof Element ? event.target : hovered;
    if (!target) return;
    // Remove the overlay first so picking <html> does not serialize it.
    overlay.host.remove();
    let element: PickedElement | null = null;
    try {
      element = buildPickedElement(target);
    } catch {
      // Report a cancel rather than leave the extension waiting.
    }
    teardown();
    post(element ? { type: "result", element } : { type: "cancel" });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    teardown();
    post({ type: "cancel" });
  }

  const listeners: Array<[string, EventListener]> = [
    ["pointermove", onPointerMove as EventListener],
    ["scroll", schedule],
    ["resize", schedule],
    ["keydown", onKeyDown as EventListener],
    ...SWALLOWED_EVENTS.map((type): [string, EventListener] => [type, swallow]),
  ];
  for (const [type, listener] of listeners) window.addEventListener(type, listener, true);

  function teardown(): void {
    for (const [type, listener] of listeners) window.removeEventListener(type, listener, true);
    if (frame) cancelAnimationFrame(frame);
    overlay.host.remove();
    delete (window as unknown as AnyRecord)[ACTIVE_FLAG];
  }
}

startPicker();
