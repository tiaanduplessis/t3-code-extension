// T3 Code's /mcp endpoint rejects any request that carries an Origin header,
// which keeps web pages from driving it. Chrome adds Origin to every POST an
// extension makes, so this removes the header for the extension's own requests
// to the MCP endpoints of connected environments. Requests from web pages keep
// their Origin header and are still rejected by T3 Code.

import { readLocal } from "@/shared/storage";

export function originRules(origins: string[], extensionId: string): chrome.declarativeNetRequest.Rule[] {
  return [...new Set(origins)].map((origin, index) => ({
    id: index + 1,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
      requestHeaders: [{ header: "origin", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE }],
    },
    condition: {
      urlFilter: `|${origin}/mcp`,
      initiatorDomains: [extensionId],
    },
  }));
}

export async function syncOriginRules(): Promise<void> {
  const connections = await readLocal("connections");
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: originRules(
      Object.values(connections).map((connection) => connection.origin),
      chrome.runtime.id,
    ),
  });
}
