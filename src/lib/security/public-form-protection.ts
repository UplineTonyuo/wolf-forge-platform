import "server-only";

import { checkBotId } from "botid/server";
import { PermissionDeniedError } from "../errors/application-error";

export async function requirePublicFormHuman(): Promise<void> {
  try {
    if ((await checkBotId()).isBot === false) return;
  } catch {
    // A missing verification must not reach the submission RPC.
  }
  throw new PermissionDeniedError();
}
