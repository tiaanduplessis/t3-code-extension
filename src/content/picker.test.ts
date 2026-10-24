// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPickedElement,
  buildSelector,
  cap,
  detectFramework,
  isHashedClass,
  parseAppFrame,
  startPicker,
  stripInputValues,
} from "./picker";

const HOST = "t3-code-picker";

function pressEscape(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

function attach<T extends object>(element: Element, key: string, value: T): void {
  (element as unknown as Record<string, unknown>)[key] = value;
}

beforeAll(() => {
  // Importing the module starts the picker, as it does when injected.
  pressEscape();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  pressEscape();
  vi.restoreAllMocks();
});

describe("cap", () => {
  it("leaves short strings alone and is idempotent", () => {
    expect(cap("abc", 5)).toBe("abc");
    const capped = cap("x".repeat(20), 10);
    expect(capped).toBe("xxxxxxx...");
    expect(cap(capped, 10)).toBe(capped);
  });
});

describe("buildSelector", () => {
  it("prefers a unique, stable id", () => {
    document.body.innerHTML = `<div><button id="save">Save</button></div>`;
    expect(buildSelector(document.querySelector("button")!)).toBe("#save");
  });

  it("skips generated ids and uses a test id", () => {
    document.body.innerHTML = `<button id=":r1:" data-testid="save-button">Save</button><button>Other</button>`;
    expect(buildSelector(document.querySelector("button")!)).toBe('[data-testid="save-button"]');
  });

  it("skips duplicate ids", () => {
    document.body.innerHTML = `<p id="dup">a</p><p id="dup" class="second">b</p>`;
    const second = document.querySelectorAll("p")[1]!;
    const selector = buildSelector(second);
    expect(selector).not.toBe("#dup");
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(second);
  });

  it("skips hashed classes and adds nth-of-type for identical siblings", () => {
    document.body.innerHTML = `
      <ul class="menu">
        <li class="item css-1a2b3c">One</li>
        <li class="item css-4d5e6f">Two</li>
      </ul>`;
    const second = document.querySelectorAll("li")[1]!;
    const selector = buildSelector(second);
    expect(selector).not.toContain("css-");
    expect(selector).toContain("li.item:nth-of-type(2)");
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(second);
  });

  it("anchors on an ancestor id", () => {
    document.body.innerHTML = `<section id="pricing"><div><a>Buy</a></div></section><div><a>Buy</a></div>`;
    const link = document.querySelector("#pricing a")!;
    const selector = buildSelector(link);
    expect(selector.startsWith("#pricing")).toBe(true);
    expect(document.querySelector(selector)).toBe(link);
  });

  it("falls back to a unique nth-child path", () => {
    let html = "<span>x</span>";
    for (let i = 0; i < 8; i++) html = `<div>${html}</div><div>${html}</div>`;
    document.body.innerHTML = html;
    const spans = document.querySelectorAll("span");
    const target = spans[spans.length - 1]!;
    const selector = buildSelector(target);
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(document.querySelector(selector)).toBe(target);
  });
});

describe("isHashedClass", () => {
  it.each(["css-1a2b3c", "sc-bdVaJa", "jsx-123456", "svelte-xyz12", "Button_root__a1B2c", "_3xYz9k", "a1b2c3d", "md:flex"])(
    "treats %s as hashed",
    (name) => expect(isHashedClass(name)).toBe(true),
  );
  it.each(["btn", "btn-primary", "card__title", "nav-item", "h-10"])("keeps %s", (name) => expect(isHashedClass(name)).toBe(false));
});

describe("buildPickedElement", () => {
  it("collapses and caps text and caps html", () => {
    document.body.innerHTML = `<div class="box">  hello\n\n   world  ${"word ".repeat(500)}</div>`;
    const picked = buildPickedElement(document.querySelector("div")!);
    expect(picked.text!.startsWith("hello world word")).toBe(true);
    expect(picked.text!.length).toBeLessThanOrEqual(300);
    expect(picked.text!.endsWith("...")).toBe(true);
    expect(picked.html.length).toBeLessThanOrEqual(2000);
    expect(picked.html.endsWith("...")).toBe(true);
    expect(picked.tag).toBe("div");
    expect(picked.pageUrl).toBe(location.href);
    expect(picked.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight });
    expect(picked.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("keeps useful attributes and never the value of inputs", () => {
    document.body.innerHTML = `<form><input id="pw" type="password" name="pw" value="hunter2" aria-label="Password" data-foo="x"></form>`;
    const input = document.querySelector("input")!;
    input.value = "typed-secret";
    const picked = buildPickedElement(input);
    expect(picked.attributes).toEqual({ id: "pw", type: "password", name: "pw", "aria-label": "Password" });
    expect(picked.html).not.toContain("hunter2");
    expect(picked.html).not.toContain("typed-secret");
    expect(picked.text).toBeUndefined();

    const form = buildPickedElement(document.querySelector("form")!);
    expect(form.html).not.toContain("hunter2");
    expect(form.html).toContain('type="password"');
  });
});

describe("stripInputValues", () => {
  it("removes only value attributes on input tags", () => {
    const html = `<div value="keep"><input title="a value=&quot;x&quot;" value="secret" type="text"><input value="s2"/></div>`;
    expect(stripInputValues(html)).toBe(`<div value="keep"><input title="a value=&quot;x&quot;" type="text"><input/></div>`);
  });

  it("strips before capping so no value prefix survives", () => {
    document.body.innerHTML = `<div>${"<span>a</span>".repeat(140)}<input value="${"s".repeat(100)}"></div>`;
    const picked = buildPickedElement(document.querySelector("div")!);
    expect(picked.html).not.toMatch(/value="s/);
  });
});

describe("startPicker", () => {
  function listenerBalance() {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    return () => ({ added: added.mock.calls.length, removed: removed.mock.calls.length, addedCalls: added.mock.calls, removedCalls: removed.mock.calls });
  }

  it("shows the overlay with a hint in a closed shadow root and stays idempotent", () => {
    const attachShadow = vi.spyOn(Element.prototype, "attachShadow");
    startPicker();
    startPicker();
    expect(document.querySelectorAll(HOST)).toHaveLength(1);
    expect(attachShadow).toHaveBeenCalledTimes(1);
    expect(attachShadow.mock.calls[0]![0]).toEqual({ mode: "closed" });
    const root = attachShadow.mock.results[0]!.value as ShadowRoot;
    expect(root.textContent).toContain("Click an element to send it to T3 Code. Press Esc to cancel.");
    expect(Object.keys(window)).not.toContain("__t3CodePickerActive");
    expect((window as unknown as Record<string, unknown>).__t3CodePickerActive).toBe(true);
  });

  it("cancels on Escape and tears everything down", () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const balance = listenerBalance();
    startPicker();
    pressEscape();
    const { added, removed, addedCalls, removedCalls } = balance();
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
    expect(removedCalls.map(([type, listener]) => [type, listener])).toEqual(addedCalls.map(([type, listener]) => [type, listener]));
    expect(document.querySelectorAll(HOST)).toHaveLength(0);
    expect("__t3CodePickerActive" in window).toBe(false);
    expect(post).toHaveBeenCalledWith({ source: "t3-code-picker", type: "cancel" }, "*");
  });

  it("swallows the click, reports the element and tears down", () => {
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    document.body.innerHTML = `<button id="buy">Buy now</button>`;
    const button = document.querySelector("button")!;
    const pageHandler = vi.fn();
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      button.addEventListener(type, pageHandler);
      document.addEventListener(type, pageHandler, true);
    }
    const balance = listenerBalance();
    startPicker();

    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    button.dispatchEvent(click);

    expect(pageHandler).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    const [message] = post.mock.calls[0]!;
    expect(message).toMatchObject({ source: "t3-code-picker", type: "result", element: { selector: "#buy", tag: "button", text: "Buy now" } });

    const { added, removed } = balance();
    expect(removed).toBe(added);
    expect(document.querySelectorAll(HOST)).toHaveLength(0);
    expect("__t3CodePickerActive" in window).toBe(false);

    // The page works normally again.
    button.click();
    expect(pageHandler).toHaveBeenCalled();
  });
});

describe("detectFramework", () => {
  function Button() {}
  function Toolbar() {}
  function App() {}

  it("reads React 18 _debugSource from the host fiber and walks owners", () => {
    document.body.innerHTML = `<div><button>Save</button></div>`;
    const button = document.querySelector("button")!;
    const forwardRef = { $$typeof: Symbol.for("react.forward_ref"), render: Button };
    const appFiber = { type: App, return: null };
    const memoFiber = { type: { $$typeof: Symbol.for("react.memo"), type: Toolbar }, return: appFiber };
    const toolbarFiber = { type: Toolbar, return: memoFiber };
    const forwardFiber = { type: forwardRef, return: toolbarFiber };
    const buttonFiber = { type: Button, return: forwardFiber, _debugSource: { fileName: "/app/src/Button.tsx", lineNumber: 12, columnNumber: 4 } };
    const hostFiber = { type: "button", return: buttonFiber, _debugSource: { fileName: "/app/src/Button.tsx", lineNumber: 14, columnNumber: 6 } };
    attach(button, "__reactFiber$abc", hostFiber);

    expect(detectFramework(button)).toEqual({
      name: "react",
      components: ["Button", "Toolbar", "App"],
      source: { file: "/app/src/Button.tsx", line: 14, column: 6 },
    });
  });

  it("parses React 19 _debugStack and skips framework frames", () => {
    document.body.innerHTML = `<span>Hi</span>`;
    const span = document.querySelector("span")!;
    const stack = [
      "Error: react-stack-top-frame",
      "    at exports.jsxDEV (http://localhost:3000/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1a2b:250:30)",
      `    at Greeting (${location.origin}/src/components/Greeting.tsx?t=1700000000:7:11)`,
      "    at react-stack-bottom-frame (http://localhost:3000/node_modules/.vite/deps/react-dom_client.js?v=1a2b:17424:20)",
    ].join("\n");
    const greeting = Object.assign(function Greeting() {}, { displayName: "Greeting" });
    const component = { type: greeting, return: null };
    attach(span, "__reactFiber$abc", { type: "span", return: component, _debugStack: new Error("x") });
    (span as unknown as { __reactFiber$abc: { _debugStack: Error } }).__reactFiber$abc._debugStack.stack = stack;

    expect(detectFramework(span)).toEqual({
      name: "react",
      components: ["Greeting"],
      source: { file: "/src/components/Greeting.tsx", line: 7, column: 11 },
    });
  });

  it("finds the fiber on an ancestor and leaves out source when none is found", () => {
    document.body.innerHTML = `<div id="root"><i>icon</i></div>`;
    const div = document.querySelector("div")!;
    attach(div, "__reactFiber$xyz", { type: "div", return: { type: Toolbar, return: null } });
    expect(detectFramework(document.querySelector("i")!)).toEqual({ name: "react", components: ["Toolbar"] });
  });

  it("ignores minified production names", () => {
    document.body.innerHTML = `<div></div>`;
    const div = document.querySelector("div")!;
    const minified = function t() {};
    attach(div, "__reactFiber$xyz", { type: "div", return: { type: minified, return: null } });
    expect(detectFramework(div)).toBeUndefined();
  });

  it("never throws on hostile internals", () => {
    document.body.innerHTML = `<div></div>`;
    const div = document.querySelector("div")!;
    attach(div, "__reactFiber$bad", {
      get return() {
        throw new Error("boom");
      },
    });
    expect(() => detectFramework(div)).not.toThrow();
  });

  it("reads Vue 3 component instances", () => {
    document.body.innerHTML = `<div><p>Total</p></div>`;
    const p = document.querySelector("p")!;
    const app = { type: { name: "App", __file: "/src/App.vue" }, parent: null };
    const cart = { type: { __name: "CartSummary", __file: "/src/components/CartSummary.vue" }, parent: app };
    attach(document.querySelector("div")!, "__vueParentComponent", cart);
    expect(detectFramework(p)).toEqual({
      name: "vue",
      components: ["CartSummary", "App"],
      source: { file: "/src/components/CartSummary.vue" },
    });
  });

  it("reads Svelte metadata from the element or its ancestors", () => {
    document.body.innerHTML = `<main><section><h2>Title</h2></section></main>`;
    attach(document.querySelector("section")!, "__svelte_meta", { loc: { file: "src/lib/Card.svelte", line: 3, column: 2 } });
    attach(document.querySelector("main")!, "__svelte_meta", { loc: { file: "src/routes/+page.svelte", line: 10, column: 0 } });
    expect(detectFramework(document.querySelector("h2")!)).toEqual({
      name: "svelte",
      components: ["Card", "+page"],
      source: { file: "src/lib/Card.svelte", line: 3, column: 2 },
    });
  });
});

describe("parseAppFrame", () => {
  it("handles webpack-internal and Firefox frames", () => {
    expect(parseAppFrame("at Page (webpack-internal:///(app-pages-browser)/./src/app/page.tsx:5:9)")).toEqual({
      file: "./src/app/page.tsx",
      line: 5,
      column: 9,
    });
    expect(parseAppFrame("Card@http://example.test/@fs/Users/me/app/src/Card.jsx:3:1")).toEqual({
      file: "http://example.test/@fs/Users/me/app/src/Card.jsx",
      line: 3,
      column: 1,
    });
    expect(parseAppFrame("at x (http://localhost/node_modules/react-dom/cjs/react-dom.development.js:1:1)")).toBeUndefined();
  });
});
