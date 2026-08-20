import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { createAccountController, type AccountController } from "../accounts.js";

/** The one account manager. Account types are registered here so deserialization works
 *  even when persistence is never started, as in tests. */
export const accountManager = new AccountManager();
registerCommonAccountTypes(accountManager);

/** Signing and encryption, guarded against the active account changing mid-operation. */
export const accounts: AccountController = createAccountController(accountManager);
