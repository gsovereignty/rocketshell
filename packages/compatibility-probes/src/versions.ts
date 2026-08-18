import type * as KehtoRuntime from "@kehto/runtime";
import type * as KehtoServices from "@kehto/services";
import type * as KehtoShell from "@kehto/shell";
import type * as ApplesauceAccounts from "applesauce-accounts";
import type * as ApplesauceCore from "applesauce-core";
import type * as ApplesauceLoaders from "applesauce-loaders";
import type * as ApplesauceRelay from "applesauce-relay";
import type * as ApplesauceSigners from "applesauce-signers";

// Package imports intentionally compile as an early warning for export or type-resolution drift.
export type InstalledApiSurface = {
  kehtoRuntime: typeof KehtoRuntime;
  kehtoServices: typeof KehtoServices;
  kehtoShell: typeof KehtoShell;
  applesauceAccounts: typeof ApplesauceAccounts;
  applesauceCore: typeof ApplesauceCore;
  applesauceLoaders: typeof ApplesauceLoaders;
  applesauceRelay: typeof ApplesauceRelay;
  applesauceSigners: typeof ApplesauceSigners;
};
