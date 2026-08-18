import type { Filter } from "applesauce-core/helpers/filter";
import { validateFilters } from "@platform/nostr-engine";

export function extractFiltersFromWorkerRequest(request: unknown): Filter[] {
  if (!Array.isArray(request) || (request[0] !== "REQ" && request[0] !== "COUNT") || typeof request[1] !== "string" || request[1].length === 0) {
    throw new Error("invalid-request");
  }
  return validateFilters(request.slice(2) as Filter[]);
}
