import { PLATFORM_REQUIRED_DOMAINS } from "@project/platform-nap-contract";

interface ReferenceShell {
  ready(): Promise<void>;
  supports(domain: string): boolean;
}

interface ReferenceNapplet {
  shell: ReferenceShell;
  identity?: { getPublicKey(): Promise<string> };
}

declare global { interface Window { napplet?: ReferenceNapplet } }

const status = document.querySelector<HTMLOutputElement>("#status");
const napplet = window.napplet;
if (!napplet?.shell) {
  if (status) status.textContent = "unsupported";
} else {
  await napplet.shell.ready();
  const available = PLATFORM_REQUIRED_DOMAINS.filter((domain) => napplet.shell.supports(domain));
  if (napplet.shell.supports("identity") && napplet.identity) await napplet.identity.getPublicKey();
  if (status) status.textContent = `ready:${available.join(",")}`;
}
