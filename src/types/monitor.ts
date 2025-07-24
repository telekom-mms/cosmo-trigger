import { ChainIdentity } from "./chain-identity.ts";

/**
 * State management class for blockchain monitoring operations.
 * Tracks upgrade plans, chain identity, and node status across monitoring cycles.
 */
export class MonitorState {
  constructor(
    public upgradePlanBlockHeight: number | null = null,
    public chainIdentity: ChainIdentity | null = null,
    public isCosmosNodeDown: boolean = false,
  ) {}

  /**
   * Resets all state properties to their initial values.
   */
  reset(): void {
    this.upgradePlanBlockHeight = null;
    this.chainIdentity = null;
    this.isCosmosNodeDown = false;
  }
}
