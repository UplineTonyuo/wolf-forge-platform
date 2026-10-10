/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({list:vi.fn()}));
vi.mock('../app/actions/tickets',()=>({listTicketSummariesAction:f.list}));
import {useTicketInboxList} from '../components/team/use-ticket-inbox-list';
import {notifyTicketAccessUnavailable} from '../components/tickets/ticket-access-boundary';
const ticketId='70000000-0000-4000-8000-000000000010';
const rows=[{ticket_id:ticketId,subject:'Protected Ticket title'}];
beforeEach(()=>{vi.useFakeTimers();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});Object.defineProperty(navigator,'onLine',{configurable:true,value:true});f.list.mockReset().mockResolvedValue({ok:true,data:rows});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('evicts cached titles on a transcript denial while permission refresh is pending and rejects the earlier list response',async()=>{
 const {result}=renderHook(()=>useTicketInboxList(true));
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 let resolve!: (value: unknown)=>void;
 f.list.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 act(()=>result.current.refreshNow());
 act(()=>notifyTicketAccessUnavailable(ticketId));
 expect(result.current.tickets).toEqual([]);
 expect(result.current.unavailable).toBe(true);
 expect(result.current.error).toBe('Tickets are unavailable.');
 await act(async()=>{resolve({ok:true,data:rows});});
 expect(result.current.tickets).toEqual([]);
});
it('hides previously loaded Ticket titles when revoked capabilities deactivate the lane',async()=>{
 const {result,rerender}=renderHook(({active})=>useTicketInboxList(active),{initialProps:{active:true}});
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 expect(result.current.tickets).toEqual(rows);
 rerender({active:false});
 expect(result.current.tickets).toEqual([]);
});
it('preserves retryable rows on network failure and clears them on typed authorization denial',async()=>{
 const {result}=renderHook(()=>useTicketInboxList(true));
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 f.list.mockResolvedValueOnce({ok:false,error:'Network unavailable'});
 await act(async()=>{await result.current.refreshNow();});
 expect(result.current.tickets).toEqual(rows);
 f.list.mockResolvedValueOnce({ok:false,error:'Tickets access is denied',code:'PERMISSION_DENIED'});
 await act(async()=>{await result.current.refreshNow();});
 expect(result.current.tickets).toEqual([]);
 expect(result.current.unavailable).toBe(true);
});
