export interface PreferredAccountConnection {
  nip07Available: boolean;
  connectExtension(): Promise<string>;
  connectEphemeral(): Promise<string>;
}

export type PreferredAccountResult = { method: "nip07" | "ephemeral"; pubkey: string };

export async function connectPreferredAccount(connection: PreferredAccountConnection): Promise<PreferredAccountResult> {
  if (connection.nip07Available) {
    try {
      return { method: "nip07", pubkey: await connection.connectExtension() };
    } catch (error) {
      console.warn("NIP-07 account connection failed; creating ephemeral identity", { error });
    }
  }
  return { method: "ephemeral", pubkey: await connection.connectEphemeral() };
}
