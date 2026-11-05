import { z } from "zod";
export function callEntryPath(value:unknown){const id=z.uuid().safeParse(value);return id.success?`/calls/${id.data}`:null;}
export function callConversationPath(accountClass:"internal"|"client",ticketId:string|null,callId:string,orderId?:string|null){
 const call=z.uuid().parse(callId);
 if(orderId){const order=z.uuid().parse(orderId);return accountClass==="client"?`/account/projects/${order}?call=${call}`:`/orders/${order}?call=${call}`;}
 const ticket=z.uuid().parse(ticketId);
 return accountClass==="client"?`/account/messages/${ticket}?call=${call}`:`/tickets/${ticket}?inbox=tickets&ticket=${ticket}&call=${call}`;
}
