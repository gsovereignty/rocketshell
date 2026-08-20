import { RelayPool } from "applesauce-relay";

/** The one relay pool. Connections are opened lazily on the first request, so importing is free. */
export const relayPool = new RelayPool();
