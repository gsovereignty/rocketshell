export const PLATFORM_COMPATIBILITY = {
  profile: "platform-nap-v1",
  kehto: { runtime: "0.22.0", shell: "0.20.0", services: "0.20.0" },
  napplet: { core: "0.31.1", nap: "0.31.1" },
  applesauce: {
    core: "6.2.0",
    relay: "6.2.1",
    loaders: "6.2.0",
    accounts: "6.2.0",
    signers: "6.2.2"
  },
  nostrTools: "2.24.0",
  rxjs: "7.8.2"
} as const;

export type PlatformCompatibility = typeof PLATFORM_COMPATIBILITY;
