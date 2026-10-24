import { useEffect, useState } from "react";
import {
  readLocal,
  readSession,
  subscribe,
  type LocalKey,
  type LocalSchema,
  type SessionKey,
  type SessionSchema,
} from "@/shared/storage";

/** Reads a storage.local key and re-renders when it changes. undefined while loading. */
export function useLocal<K extends LocalKey>(key: K): LocalSchema[K] | undefined {
  const [value, setValue] = useState<LocalSchema[K]>();
  useEffect(() => {
    let active = true;
    void readLocal(key).then((initial) => {
      if (active) setValue(initial);
    });
    const unsubscribe = subscribe("local", key, () => {
      void readLocal(key).then((next) => {
        if (active) setValue(next);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [key]);
  return value;
}

export function useSession<K extends SessionKey>(key: K): SessionSchema[K] | undefined {
  const [value, setValue] = useState<SessionSchema[K]>();
  useEffect(() => {
    let active = true;
    void readSession(key).then((initial) => {
      if (active) setValue(initial);
    });
    const unsubscribe = subscribe("session", key, () => {
      void readSession(key).then((next) => {
        if (active) setValue(next);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [key]);
  return value;
}
