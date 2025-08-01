import { ChainIdentity } from "src/types/chain-identity.ts";
import { isFailure } from "src/types/result.ts";
import { fetchJson, safeGet } from "src/utils/http.ts";

/**
 * Fetches the latest block height from the Cosmos blockchain.
 *
 * @param apiUrl - The base URL of the Cosmos REST API.
 * @returns The block height as a number, or null if the request fails.
 */
export async function getBlockHeight(apiUrl: string): Promise<number | null> {
  const result = await fetchJson(
    `${apiUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`,
  );

  if (isFailure(result)) {
    return null;
  }

  const heightStr = safeGet<string>(result.data.data, [
    "block",
    "header",
    "height",
  ]);

  if (!heightStr) {
    return null;
  }

  const height = parseInt(heightStr, 10);
  return isNaN(height) ? null : height;
}

/**
 * Fetches the upgrade plan height from the Cosmos blockchain.
 *
 * @param apiUrl - The base URL of the Cosmos REST API.
 * @returns The upgrade plan height as a number, or null if no plan exists or the request fails.
 */
export async function getUpgradePlanBlockHeight(
  apiUrl: string,
): Promise<number | null> {
  const result = await fetchJson(
    `${apiUrl}/cosmos/upgrade/v1beta1/current_plan`,
  );

  if (isFailure(result)) {
    return null;
  }

  const planHeight = safeGet<string>(result.data.data, ["plan", "height"]);

  if (!planHeight) {
    return null;
  }

  const height = parseInt(planHeight, 10);
  return isNaN(height) ? null : height;
}

/**
 * Fetches the chain identity information from the Cosmos blockchain.
 *
 * @param apiUrl - The base URL of the Cosmos REST API.
 * @returns An object containing chain identity details, or null if the request fails.
 */
export async function getChainIdentity(
  apiUrl: string,
): Promise<ChainIdentity | null> {
  const result = await fetchJson(
    `${apiUrl}/cosmos/base/tendermint/v1beta1/node_info`,
  );

  if (isFailure(result)) {
    return null;
  }

  const nodeInfo = safeGet<Record<string, unknown>>(result.data.data, [
    "default_node_info",
  ]);
  if (!nodeInfo) {
    return null;
  }

  const nodeId = safeGet<string>(nodeInfo, ["default_node_id"]) || "";
  const listenAddr = safeGet<string>(nodeInfo, ["listen_addr"]) || "";
  const network = safeGet<string>(nodeInfo, ["network"]) || "";
  const version = safeGet<string>(nodeInfo, ["version"]) || "";
  const moniker = safeGet<string>(nodeInfo, ["moniker"]) || "";
  const other = safeGet<Record<string, unknown>>(nodeInfo, ["other"]);
  const rpcAddress = other ? safeGet<string>(other, ["rpc_address"]) || "" : "";

  if (!moniker || !network) {
    return null;
  }

  return {
    nodeId,
    listenAddr,
    network,
    moniker,
    version,
    rpcAddress,
  };
}
