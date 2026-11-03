import { z } from "zod";
export function callEntryPath(value:unknown){const id=z.uuid().safeParse(value);return id.success?`/calls/${id.data}`:null;}
export function callConversationPath(accountClass:"internal"|"client",ticketId:string,callId:string){
 const ticket=z.uuid().parse(ticketId),call=z.uuid().parse(callId);
 return accountClass==="client"?`/account/messages/${ticket}?call=${call}`:`/tickets/${ticket}?inbox=tickets&ticket=${ticket}&call=${call}`;
}
