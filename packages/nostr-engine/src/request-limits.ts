import type { Filter } from "applesauce-core/helpers/filter";

export interface FilterLimits {
  readonly maximumFilters?: number;
  readonly maximumIds?: number;
  readonly maximumAuthors?: number;
  readonly maximumTagValues?: number;
}

export function validateFilters(input: Filter | Filter[], limits: FilterLimits = {}): Filter[] {
  const filters = Array.isArray(input) ? input : [input];
  const maximumFilters = limits.maximumFilters ?? 8;
  const maximumIds = limits.maximumIds ?? 1_000;
  const maximumAuthors = limits.maximumAuthors ?? 1_000;
  const maximumTagValues = limits.maximumTagValues ?? 1_000;
  if (filters.length === 0 || filters.length > maximumFilters) throw new Error("invalid-filter");
  for (const filter of filters) {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw new Error("invalid-filter");
    if (filter.ids && filter.ids.length > maximumIds) throw new Error("invalid-filter");
    if (filter.authors && filter.authors.length > maximumAuthors) throw new Error("invalid-filter");
    for (const [name, values] of Object.entries(filter)) {
      if (name.startsWith("#") && (!Array.isArray(values) || values.length > maximumTagValues)) throw new Error("invalid-filter");
    }
  }
  return filters;
}
