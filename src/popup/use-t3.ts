import { useEffect, useMemo, useState } from "react";
import { McpClient, McpError } from "@/lib/mcp";
import { getCapabilities, listBranches, listProjects, listRecentThreads, type BranchRef, type ThreadItem } from "@/lib/t3";
import { markConnectionInvalid, readSession, updateSession, type Catalog, type Connection } from "@/shared/storage";

export interface EnvironmentData<T> {
  value?: T;
  error?: string;
  loading: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One MCP client per connected environment, rebuilt when a token changes. */
export function useClients(connections: Connection[]): Record<string, McpClient> {
  const key = connections.map((connection) => `${connection.environmentId}:${connection.origin}:${connection.accessToken}`).join("|");
  return useMemo(
    () => Object.fromEntries(connections.map((connection) => [connection.environmentId, new McpClient(connection.origin, connection.accessToken)])),
    // The key captures every field the clients depend on.
    [key],
  );
}

/**
 * Loads data for every environment in parallel. Shows the cached copy at once,
 * then refreshes. One environment failing does not affect the others.
 */
function useEnvironmentData<T>(
  connections: Connection[],
  clients: Record<string, McpClient>,
  enabled: boolean,
  cacheKey: "catalogs" | "threads",
  load: (client: McpClient, environmentId: string) => Promise<T>,
  dependency: unknown,
): Record<string, EnvironmentData<T>> {
  const [data, setData] = useState<Record<string, EnvironmentData<T>>>({});

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const update = (environmentId: string, next: Partial<EnvironmentData<T>>) => {
      if (!active) return;
      setData((current) => ({
        ...current,
        [environmentId]: { loading: false, ...current[environmentId], ...next },
      }));
    };
    void readSession(cacheKey).then((cached) => {
      for (const connection of connections) {
        const entry = (cached as Record<string, unknown>)[connection.environmentId];
        if (entry) update(connection.environmentId, { value: entry as T });
      }
    });
    for (const connection of connections) {
      const client = clients[connection.environmentId];
      if (!client) continue;
      update(connection.environmentId, { loading: true, error: undefined });
      load(client, connection.environmentId)
        .then(async (value) => {
          await updateSession(cacheKey, (cache) => ({ ...cache, [connection.environmentId]: value }) as typeof cache);
          update(connection.environmentId, { value, loading: false });
        })
        .catch(async (cause: unknown) => {
          if (cause instanceof McpError && cause.kind === "auth") {
            await markConnectionInvalid(connection.environmentId, connection.accessToken);
          }
          update(connection.environmentId, { error: errorMessage(cause), loading: false });
        });
    }
    return () => {
      active = false;
    };
  }, [clients, enabled, dependency]);

  return data;
}

export function useCatalogs(connections: Connection[], clients: Record<string, McpClient>) {
  return useEnvironmentData<Catalog>(
    connections,
    clients,
    true,
    "catalogs",
    async (client) => {
      const [projects, capabilities] = await Promise.all([listProjects(client), getCapabilities(client)]);
      return { projects, capabilities, fetchedAt: Date.now() };
    },
    null,
  );
}

/** Recent threads per environment, loaded once the composer switches to existing threads. */
export function useRecentThreads(
  connections: Connection[],
  clients: Record<string, McpClient>,
  catalogs: Record<string, EnvironmentData<Catalog>>,
  enabled: boolean,
) {
  // Reload once each environment's project list arrives.
  const projectKey = connections.map((connection) => catalogs[connection.environmentId]?.value?.fetchedAt ?? 0).join(",");
  return useEnvironmentData<{ threads: ThreadItem[]; fetchedAt: number }>(
    connections,
    clients,
    enabled && projectKey.split(",").some((value) => value !== "0"),
    "threads",
    async (client, environmentId) => {
      const projects = catalogs[environmentId]?.value?.projects ?? [];
      return { threads: await listRecentThreads(client, projects), fetchedAt: Date.now() };
    },
    projectKey,
  );
}

/** Local branches for a project, or null when T3 Code has no thread to resolve them through. */
export function useBranches(client: McpClient | undefined, projectId: string | undefined) {
  const [branches, setBranches] = useState<BranchRef[] | null>();

  useEffect(() => {
    if (!client || !projectId) return;
    let active = true;
    setBranches(undefined);
    listBranches(client, projectId)
      .then((refs) => {
        if (active) setBranches(refs);
      })
      .catch(() => {
        if (active) setBranches(null);
      });
    return () => {
      active = false;
    };
  }, [client, projectId]);

  return { branches, loading: Boolean(projectId) && branches === undefined };
}
