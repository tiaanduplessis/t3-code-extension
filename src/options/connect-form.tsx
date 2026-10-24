import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { normalizeOrigin, parsePairingInput, connectWithPairingCode } from "@/lib/oauth";
import { fetchEnvironment, RUNTIME_MODES, type EnvironmentDescriptor, type RuntimeMode } from "@/lib/t3";
import { updateLocal } from "@/shared/storage";
import { Button } from "@/ui/button";
import { Field, Input, Spinner } from "@/ui/field";
import { Alert } from "@/ui/misc";
import { RUNTIME_MODE_DETAILS } from "@/ui/runtime-modes";
import { Picker } from "@/ui/select";

// Standard scopes: a code limited to orchestration scopes cannot approve Full access.
const PAIRING_COMMAND = "t3 auth pairing create";

function isLoopback(origin: string): boolean {
  const { hostname } = new URL(origin);
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

type Detection =
  | { state: "idle" | "checking" }
  | { state: "found"; environment: EnvironmentDescriptor }
  | { state: "missing"; message: string };

export function ConnectForm({
  initialOrigin = "http://127.0.0.1:3773",
  initialAccess = "approval-required",
  onDone,
  onCancel,
}: {
  initialOrigin?: string;
  initialAccess?: RuntimeMode;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [server, setServer] = useState(initialOrigin);
  const [pairing, setPairing] = useState("");
  const [access, setAccess] = useState<RuntimeMode>(initialAccess);
  const [detection, setDetection] = useState<Detection>({ state: "idle" });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();

  // A pasted pairing link carries its own server address.
  const linkOrigin = (() => {
    try {
      return pairing.trim() ? parsePairingInput(pairing).origin : undefined;
    } catch {
      return undefined;
    }
  })();
  const origin = (() => {
    try {
      return normalizeOrigin(linkOrigin ?? server);
    } catch {
      return undefined;
    }
  })();

  useEffect(() => {
    if (!origin) {
      setDetection({ state: "missing", message: "Enter a valid address, for example http://127.0.0.1:3773." });
      return;
    }
    let active = true;
    setDetection({ state: "checking" });
    const handle = setTimeout(() => {
      fetchEnvironment(origin)
        .then((environment) => {
          if (active) setDetection({ state: "found", environment });
        })
        .catch((cause: unknown) => {
          if (active) setDetection({ state: "missing", message: cause instanceof Error ? cause.message : String(cause) });
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [origin]);

  async function connect() {
    if (!origin) return;
    setError(undefined);
    setConnecting(true);
    try {
      const { code } = parsePairingInput(pairing);
      if (!isLoopback(origin)) {
        const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
        if (!granted) throw new Error(`The extension needs permission to reach ${origin}.`);
      }
      const environment = await fetchEnvironment(origin);
      const token = await connectWithPairingCode({ origin, code, access });
      await updateLocal("connections", (connections) => ({
        ...connections,
        [environment.environmentId]: {
          environmentId: environment.environmentId,
          origin,
          label: environment.label,
          serverVersion: environment.serverVersion,
          accessToken: token.accessToken,
          expiresAt: token.expiresAt,
          access,
          connectedAt: Date.now(),
        },
      }));
      await updateLocal("preferences", (preferences) => ({ ...preferences, activeEnvironmentId: environment.environmentId }));
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <Field
        label="Server address"
        htmlFor={`${id}-server`}
        description={
          detection.state === "checking" ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="size-3" /> Looking for T3 Code
            </span>
          ) : detection.state === "found" ? (
            <span className="inline-flex items-center gap-1.5 text-success-foreground">
              <CircleCheckIcon className="size-3.5" />
              Found {detection.environment.label}, T3 Code {detection.environment.serverVersion}
            </span>
          ) : detection.state === "missing" ? (
            <span className="inline-flex items-center gap-1.5 text-destructive-foreground">
              <CircleXIcon className="size-3.5" />
              {detection.message}
            </span>
          ) : undefined
        }
      >
        <Input
          id={`${id}-server`}
          value={linkOrigin ?? server}
          disabled={Boolean(linkOrigin)}
          onChange={(event) => setServer(event.target.value)}
          placeholder="http://127.0.0.1:3773"
          spellCheck={false}
        />
      </Field>

      <Field
        label="Pairing code or link"
        htmlFor={`${id}-pairing`}
        description={
          <>
            In T3 Code, open Settings, then Connections, and create a pairing link. Or run{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">{PAIRING_COMMAND}</code>
          </>
        }
      >
        <Input
          id={`${id}-pairing`}
          value={pairing}
          onChange={(event) => setPairing(event.target.value)}
          placeholder="Paste the code or link"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field
        label="Highest access level"
        description="Threads started from Chrome can use this level or a lower one. T3 Code enforces it."
      >
        <Picker
          label="Highest access level"
          variant="outline"
          value={access}
          onValueChange={setAccess}
          groups={[
            {
              options: RUNTIME_MODES.map((mode) => ({
                value: mode,
                label: RUNTIME_MODE_DETAILS[mode].label,
                description: RUNTIME_MODE_DETAILS[mode].description,
                icon: RUNTIME_MODE_DETAILS[mode].icon,
              })),
            },
          ]}
        />
      </Field>

      {error ? (
        <Alert tone="error" title="Could not connect">
          {error}
        </Alert>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={connecting || !pairing.trim() || detection.state !== "found"}>
          {connecting ? <Spinner className="size-3.5" /> : null}
          Connect
        </Button>
      </div>
    </form>
  );
}
