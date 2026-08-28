import { initBotId } from "botid/client/core";

/** Invisible, free BotID Basic protection for the login Server Action only. */
initBotId({
  protect: [{ path: "/login", method: "POST" }],
});
