import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { displaySource, loadSourceMaps, symbolicate, type SendCommand, type StackFrame } from "./source-maps";

const SOURCE = `export function total(items: { price: number }[]): number {
  let sum = 0;
  for (const item of items) sum += item.price;
  if (sum > 100) throw new Error("too much");
  return sum;
}
`;

// A banner line puts the bundle on line 1 (0-based) so line offsets are exercised too.
function build(sourcefile = "webpack://app/./src/checkout/total.ts") {
  const result = transformSync(SOURCE, { loader: "ts", minify: true, sourcemap: "external", sourcefile, format: "esm" });
  const map = JSON.parse(result.map) as { mappings: string };
  map.mappings = `;${map.mappings}`;
  return { code: `/* banner */\n${result.code}`, map: JSON.stringify(map) };
}

const bundle = build();
const SCRIPT = "https://shop.example/assets/main.a1b2.js";

function frameAt(code: string, token: string, url = SCRIPT): StackFrame {
  const lines = code.split("\n");
  const lineNumber = lines.findIndex((line) => line.includes(token));
  return { url, lineNumber, columnNumber: lines[lineNumber]!.indexOf(token) };
}

function originalColumn(line: number, token: string): number {
  return SOURCE.split("\n")[line - 1]!.indexOf(token) + 1;
}

const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const later = () => Date.now() + 5_000;

interface FakeOptions {
  body?: string;
  chunkSize?: number;
  headers?: Record<string, string>;
  status?: number;
  hang?: boolean;
}

function fakeSend(options: FakeOptions = {}) {
  const body = Buffer.from(options.body ?? bundle.map, "utf8");
  const chunkSize = options.chunkSize ?? 64;
  let offset = 0;
  const calls: { method: string; params?: object }[] = [];
  const send = vi.fn<SendCommand>(async (method, params) => {
    calls.push({ method, params });
    switch (method) {
      case "Page.getFrameTree":
        return { frameTree: { frame: { id: "main-frame" } } };
      case "Network.loadNetworkResource":
        if (options.hang) return new Promise(() => undefined);
        return { resource: { success: true, httpStatusCode: options.status ?? 200, stream: "stream-1", headers: options.headers ?? {} } };
      case "IO.read": {
        const chunk = body.subarray(offset, offset + chunkSize);
        offset += chunk.byteLength;
        return { base64Encoded: true, data: chunk.toString("base64"), eof: offset >= body.byteLength };
      }
      case "IO.close":
        return {};
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
  return { send, calls };
}

describe("symbolicate", () => {
  it("maps a minified frame to the original line, column and name", async () => {
    const maps = await loadSourceMaps(fakeSend().send, [{ url: SCRIPT, sourceMapURL: "main.a1b2.js.map" }], new Set([SCRIPT]), {
      deadline: later(),
    });

    expect(symbolicate(maps, frameAt(bundle.code, "new Error"))).toEqual({
      source: "src/checkout/total.ts",
      line: 4,
      column: originalColumn(4, "new Error"),
    });
    expect(symbolicate(maps, frameAt(bundle.code, "r>100"))).toEqual({
      source: "src/checkout/total.ts",
      line: 4,
      column: originalColumn(4, "sum > 100"),
      name: "sum",
    });
  });

  it("returns null for unknown scripts, unmapped lines and nonsense positions", async () => {
    const maps = await loadSourceMaps(
      fakeSend().send,
      [{ url: SCRIPT, sourceMapURL: `data:application/json;base64,${base64(bundle.map)}` }],
      new Set([SCRIPT]),
      { deadline: later() },
    );
    expect(symbolicate(maps, { url: "https://other.example/x.js", lineNumber: 1, columnNumber: 0 })).toBeNull();
    expect(symbolicate(maps, { url: SCRIPT, lineNumber: 0, columnNumber: 3 })).toBeNull();
    expect(symbolicate(maps, { url: SCRIPT, lineNumber: 99, columnNumber: 0 })).toBeNull();
    expect(symbolicate(maps, { url: SCRIPT, lineNumber: Number.NaN, columnNumber: -5 })).toBeNull();
  });
});

describe("loadSourceMaps", () => {
  it("decodes base64 and URI-encoded inline maps without network calls", async () => {
    const second = "https://shop.example/assets/vendor.js";
    const { send } = fakeSend();
    const maps = await loadSourceMaps(
      send,
      [
        { url: SCRIPT, sourceMapURL: `data:application/json;base64,${base64(bundle.map)}` },
        { url: second, sourceMapURL: `data:application/json;charset=utf-8,${encodeURIComponent(bundle.map)}` },
      ],
      new Set([SCRIPT, second]),
      { deadline: later() },
    );

    expect(send).not.toHaveBeenCalled();
    expect(symbolicate(maps, frameAt(bundle.code, "new Error"))?.line).toBe(4);
    expect(symbolicate(maps, frameAt(bundle.code, "new Error", second))?.line).toBe(4);
  });

  it("resolves relative sourceMapURLs against the script url", async () => {
    const { send, calls } = fakeSend();
    await loadSourceMaps(send, [{ url: SCRIPT, sourceMapURL: "../maps/main.a1b2.js.map?v=3" }], new Set([SCRIPT]), { deadline: later() });

    expect(calls.find((call) => call.method === "Network.loadNetworkResource")?.params).toEqual({
      frameId: "main-frame",
      url: "https://shop.example/maps/main.a1b2.js.map?v=3",
      options: { disableCache: false, includeCredentials: true },
    });
  });

  it("reads a remote map in base64 chunks and closes the stream", async () => {
    const { send, calls } = fakeSend({ body: `)]}'\n${bundle.map}`, chunkSize: 37 });
    const maps = await loadSourceMaps(send, [{ url: SCRIPT, sourceMapURL: "main.a1b2.js.map" }], new Set([SCRIPT]), { deadline: later() });

    const methods = calls.map((call) => call.method);
    expect(methods.filter((method) => method === "IO.read").length).toBeGreaterThan(10);
    expect(methods.at(-1)).toBe("IO.close");
    expect(calls.at(-1)?.params).toEqual({ handle: "stream-1" });
    expect(symbolicate(maps, frameAt(bundle.code, "new Error"))?.source).toBe("src/checkout/total.ts");
  });

  it("gives up when the deadline passes", async () => {
    const { send } = fakeSend({ hang: true });
    const started = Date.now();
    const maps = await loadSourceMaps(send, [{ url: SCRIPT, sourceMapURL: "main.a1b2.js.map" }], new Set([SCRIPT]), {
      deadline: Date.now() + 50,
    });
    expect(maps.size).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);

    const expired = fakeSend();
    const none = await loadSourceMaps(
      expired.send,
      [{ url: SCRIPT, sourceMapURL: `data:application/json;base64,${base64(bundle.map)}` }],
      new Set([SCRIPT]),
      { deadline: Date.now() - 1 },
    );
    expect(none.size).toBe(0);
  });

  it("stops reading once maxBytes is exceeded", async () => {
    const streamed = fakeSend({ chunkSize: 16 });
    const maps = await loadSourceMaps(streamed.send, [{ url: SCRIPT, sourceMapURL: "main.a1b2.js.map" }], new Set([SCRIPT]), {
      deadline: later(),
      maxBytes: 100,
    });
    expect(maps.size).toBe(0);
    const reads = streamed.calls.filter((call) => call.method === "IO.read").length;
    expect(reads).toBe(7);
    expect(streamed.calls.at(-1)?.method).toBe("IO.close");

    const declared = fakeSend({ headers: { "Content-Length": "500000" } });
    await loadSourceMaps(declared.send, [{ url: SCRIPT, sourceMapURL: "main.a1b2.js.map" }], new Set([SCRIPT]), {
      deadline: later(),
      maxBytes: 100,
    });
    expect(declared.calls.some((call) => call.method === "IO.read")).toBe(false);
    expect(declared.calls.at(-1)?.method).toBe("IO.close");

    const inline = await loadSourceMaps(
      fakeSend().send,
      [{ url: SCRIPT, sourceMapURL: `data:application/json;base64,${base64(bundle.map)}` }],
      new Set([SCRIPT]),
      { deadline: later(), maxBytes: 100 },
    );
    expect(inline.size).toBe(0);
  });

  it("only loads maps for wanted scripts, once each, up to maxMaps", async () => {
    const { send, calls } = fakeSend();
    const scripts = Array.from({ length: 4 }, (_, index) => ({ url: `https://shop.example/${index}.js`, sourceMapURL: `${index}.js.map` }));
    await loadSourceMaps(send, [...scripts, scripts[1]!], new Set([scripts[1]!.url, scripts[2]!.url, scripts[3]!.url]), {
      deadline: later(),
      maxMaps: 2,
    });

    const urls = calls.filter((call) => call.method === "Network.loadNetworkResource").map((call) => (call.params as { url: string }).url);
    expect(urls).toEqual(["https://shop.example/1.js.map", "https://shop.example/2.js.map"]);
    expect(calls.filter((call) => call.method === "Page.getFrameTree")).toHaveLength(1);
  });

  it("skips failed responses and garbage maps without throwing", async () => {
    const failed = await loadSourceMaps(fakeSend({ status: 404 }).send, [{ url: SCRIPT, sourceMapURL: "x.map" }], new Set([SCRIPT]), {
      deadline: later(),
    });
    expect(failed.size).toBe(0);

    const load = (body: string) =>
      loadSourceMaps(fakeSend({ body }).send, [{ url: SCRIPT, sourceMapURL: "x.map" }], new Set([SCRIPT]), { deadline: later() });
    for (const body of ["not json", "{}", "null", "[]", JSON.stringify({ version: 3, sources: [], names: [], mappings: "AAAA" })]) {
      expect(symbolicate(await load(body), { url: SCRIPT, lineNumber: 0, columnNumber: 0 })).toBeNull();
    }
    // The VLQ decoder is lenient, so invalid mappings may yield nonsense, but never an exception.
    const nonsense = await load(JSON.stringify({ version: 3, sources: ["a.ts"], names: [], mappings: "!!!@@@;;\uffff" }));
    expect(() => symbolicate(nonsense, { url: SCRIPT, lineNumber: 0, columnNumber: 0 })).not.toThrow();
    expect(() => symbolicate(nonsense, { url: SCRIPT, lineNumber: 2, columnNumber: 9 })).not.toThrow();

    const broken: SendCommand = async () => {
      throw new Error("detached");
    };
    const inline = "https://shop.example/inline.js";
    await expect(
      loadSourceMaps(broken, [{ url: SCRIPT, sourceMapURL: "x.map" }, { url: inline, sourceMapURL: "data:,%E0%A4%A" }], new Set([SCRIPT, inline]), {
        deadline: later(),
      }),
    ).resolves.toEqual(new Map());
  });
});

describe("displaySource", () => {
  const map = "https://shop.example/assets/main.js.map";

  it.each([
    ["webpack:///./src/a.ts", undefined, "src/a.ts"],
    ["webpack://_N_E/./src/a.ts", undefined, "src/a.ts"],
    ["webpack://app/./node_modules/react-dom/cjs/react-dom.js", undefined, "node_modules/react-dom/cjs/react-dom.js"],
    ["turbopack:///[project]/src/a.ts", undefined, "src/a.ts"],
    ["../../src/main.ts", undefined, "src/main.ts"],
    ["src/main.ts", "/", "/src/main.ts"],
    ["src/main.ts", "webpack:///", "src/main.ts"],
    ["main.ts", "../../src", "src/main.ts"],
    ["/@fs/Users/me/app/src/main.ts", undefined, "/Users/me/app/src/main.ts"],
    ["../@fs/Users/me/app/src/main.ts", undefined, "/Users/me/app/src/main.ts"],
    ["\0vite/preload-helper.js", undefined, "vite/preload-helper.js"],
    ["file:///Users/me/app/src/a%20b.ts", undefined, "/Users/me/app/src/a b.ts"],
    ["https://cdn.other/lib.js", undefined, "https://cdn.other/lib.js"],
  ])("%s with sourceRoot %s", (raw, sourceRoot, expected) => {
    expect(displaySource(raw, sourceRoot, map)).toBe(expected);
  });
});
