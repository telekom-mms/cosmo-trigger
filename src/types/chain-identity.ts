/**
 * Represents the identity metadata of a Cosmos blockchain network.
 *
 * This type defines identifying attributes for a chain node,
 * including network, moniker, and connection details.
 */
export type ChainIdentity = {
  nodeId: string;
  listenAddr: string;
  network: string;
  moniker: string;
  version: string;
  rpcAddress: string;
};
