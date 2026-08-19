import { identity } from "@napplet/sdk";

const status = document.querySelector<HTMLOutputElement>("#status");
try {
  const pubkey = await identity.getPublicKey();
  if (status) status.textContent = pubkey ? `ready:${pubkey.slice(0, 12)}` : "ready:signed-out";
} catch (error) {
  if (status) status.textContent = error instanceof Error ? `unsupported:${error.message}` : "unsupported";
}
