/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('../components/tickets/use-client-conversation-presence',()=>({useClientConversationPresence:vi.fn()}));
vi.mock('../app/actions/tickets',()=>({sendTicketComposerAction:vi.fn(),toggleClientTicketMessageReactionAction:vi.fn()}));
vi.mock('../components/tickets/ticket-conversation',()=>({TicketConversation:({messages}:{messages:{body:string}[]})=><div>{messages.map((m,i)=><p key={i}>{m.body}</p>)}</div>}));
vi.mock('../components/tickets/ticket-composer',()=>({TicketComposer:({disabled}:{disabled:boolean})=><button disabled={disabled}>Reply to Ticket</button>}));
const {TicketClientConversation}=await import('../components/tickets/ticket-client-conversation');
const {TicketAccessBoundary}=await import('../components/tickets/ticket-access-boundary');
const {notifyTicketAccessUnavailable}=await import('../components/tickets/ticket-access-boundary');
import type {TicketDetailMessage} from '../domain/tickets/schema';
const ticketId='70000000-0000-4000-8000-000000000010';
const messages: TicketDetailMessage[]=[{id:'70000000-0000-4000-8000-000000000011',ticket_id:ticketId,body:'Protected historical message',author_profile_id:'client',author_name:'Synthetic Client',author_avatar_url:null,author_type:'client',message_kind:'reply',visibility:'client',created_at:'2026-10-10T01:00:00Z',attachments:[],reactions:[]}];
const fetchMock=vi.fn();
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});Object.defineProperty(navigator,'onLine',{configurable:true,value:true});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
describe('Ticket access revocation',()=>{
 it('clears matching internal page metadata when the shared Inbox confirms denial',()=>{
  render(<><TicketAccessBoundary ticketId={ticketId}><h1>Internal protected subject</h1><p>Internal protected reference</p></TicketAccessBoundary><p>Independent Team conversation</p></>);
  act(()=>notifyTicketAccessUnavailable('70000000-0000-4000-8000-000000000020'));
  expect(screen.getByText('Internal protected subject')).toBeInTheDocument();
  act(()=>notifyTicketAccessUnavailable(ticketId));
  expect(screen.queryByText('Internal protected subject')).not.toBeInTheDocument();
  expect(screen.queryByText('Internal protected reference')).not.toBeInTheDocument();
  expect(screen.getByText('Independent Team conversation')).toBeInTheDocument();
 });
 it('clears the Tickets route on a module denial without wiping Team siblings',()=>{
  render(<><TicketAccessBoundary listenForModuleDenial><h1>Protected Ticket list</h1></TicketAccessBoundary><p>Core Team workspace</p></>);
  act(()=>notifyTicketAccessUnavailable());
  expect(screen.queryByText('Protected Ticket list')).not.toBeInTheDocument();
  expect(screen.getByText('Core Team workspace')).toBeInTheDocument();
 });
 it('ignores a late denial after switching to another Ticket',async()=>{
  let finishOld!: (response: unknown)=>void;
  fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;}))
   .mockResolvedValue({status:200,json:async()=>({ok:true,data:{changed:false}})});
  const {rerender}=render(<TicketAccessBoundary><h1>First Ticket</h1><TicketClientConversation ticketId={ticketId} messages={messages} viewerProfileId='client' repliesDisabled={false}/></TicketAccessBoundary>);
  rerender(<TicketAccessBoundary><h1>Second authorized Ticket</h1><TicketClientConversation ticketId='70000000-0000-4000-8000-000000000020' messages={messages} viewerProfileId='client' repliesDisabled={false}/></TicketAccessBoundary>);
  await act(async()=>{finishOld({status:403,json:async()=>({ok:false,code:'PERMISSION_DENIED'})});await vi.advanceTimersByTimeAsync(3500);});
  expect(screen.getByText('Second authorized Ticket')).toBeInTheDocument();
  expect(screen.getByText('Protected historical message')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
 it('continues polling after Strict Mode aborts the first mount request',async()=>{
  fetchMock.mockImplementationOnce((_url,options)=>new Promise((_resolve,reject)=>{
   options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
  })).mockResolvedValue({status:403,json:async()=>({ok:false,code:'PERMISSION_DENIED'})});
  render(<StrictMode><TicketClientConversation ticketId={ticketId} messages={messages} viewerProfileId='client' repliesDisabled={false}/></StrictMode>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText('Protected historical message')).not.toBeInTheDocument();
 });
 it('hides the entire protected page even when router refresh does not finish',async()=>{
  fetchMock.mockResolvedValue({status:403,json:async()=>({ok:false,code:'PERMISSION_DENIED'})});
  render(<TicketAccessBoundary><h1>Protected Ticket subject</h1><p>Protected reference and timestamps</p><TicketClientConversation ticketId={ticketId} messages={messages} viewerProfileId='client' repliesDisabled={false}/></TicketAccessBoundary>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3500);});
  expect(screen.queryByText('Protected Ticket subject')).not.toBeInTheDocument();
  expect(screen.queryByText('Protected reference and timestamps')).not.toBeInTheDocument();
  expect(screen.queryByText('Protected historical message')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Reply to Ticket'})).not.toBeInTheDocument();
 });
 it('hides the loaded transcript and composer on a confirmed authorization denial',async()=>{
  fetchMock.mockResolvedValue({status:403,json:async()=>({ok:false,code:'PERMISSION_DENIED',error:'Ticket access is denied'})});
  render(<TicketClientConversation ticketId={ticketId} messages={messages} viewerProfileId='client' repliesDisabled={false}/>);
  expect(screen.getByText('Protected historical message')).toBeInTheDocument();
  await act(async()=>{await vi.advanceTimersByTimeAsync(3500);});
  expect(screen.queryByText('Protected historical message')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Reply to Ticket'})).not.toBeInTheDocument();
  expect(screen.getByText(/conversation is unavailable/i)).toBeInTheDocument();
 });
 it('preserves retryable conversation state on a transient network failure',async()=>{
  fetchMock.mockRejectedValue(new Error('Network unavailable'));
  render(<TicketClientConversation ticketId={ticketId} messages={messages} viewerProfileId='client' repliesDisabled={false}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(3500);});
  expect(screen.getByText('Protected historical message')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Reply to Ticket'})).toBeEnabled();
 });
});
