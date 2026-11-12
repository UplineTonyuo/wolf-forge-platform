/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { callRoomProperties, verifiedCallRoom } from '../lib/daily/calls';
import { CallScreen } from '../components/calls/call-screen';
import { emptyMedia, type CallMedia } from '../components/calls/call-media';
import type { CallController, CallState } from '../components/calls/call-controller';

vi.mock('../components/account/ui/portal-dialog', () => ({PortalDialog: ({children, open}: {children: React.ReactNode;open: boolean}) => open ? <div>{children}</div> : null}));
afterEach(cleanup);
const id='71000000-0000-4000-8000-000000000001';
const active = {id,ticketId:id,callerId:id,calleeId:'71000000-0000-4000-8000-000000000002',state:'active',mode:'video',durationPolicy:'manual',answeredAt:'2026-11-06T12:00:00Z',expiresAt:'2026-11-06T12:15:00Z'} as NonNullable<CallState['call']>;
const state:CallState={call:active,peer:{name:'Synthetic peer',avatarUrl:null},busy:false,error:'',minimized:false,canJoin:true,joinAttempt:0};
const controller={profileId:id,close:vi.fn(),minimize:vi.fn(),end:vi.fn()} as unknown as CallController;

it('uses a private manual-end room without a meeting deadline, keeping fixed rooms unchanged',()=>{
 const props=callRoomProperties(1234,'manual');
 expect(props).not.toHaveProperty('exp');
 expect(props.eject_at_room_exp).toBe(false);
 expect(props.max_participants).toBe(2);
 expect(callRoomProperties(1234).eject_at_room_exp).toBe(true);
});
it('requires manual room properties on provider readback, rejecting inherited expiry or ejection',()=>{
 const config={...callRoomProperties(1234,'manual'),enable_recording:''};
 const room={name:'test',url:'https://wolfforge.daily.co/test',privacy:'private',config};
 expect(verifiedCallRoom(room,'test',1234,'manual')).toBe(true);
 expect(verifiedCallRoom({...room,config:{...config,exp:1234}},'test',1234,'manual')).toBe(false);
 expect(verifiedCallRoom({...room,config:{...config,eject_after_elapsed:3600}},'test',1234,'manual')).toBe(false);
 expect(verifiedCallRoom({...room,privacy:'public'},'test',1234,'manual')).toBe(false);
});
it('shows one server-based elapsed clock after two hours, without a time-left countdown',()=>{
 render(<CallScreen state={state} controller={controller} media={{} as CallMedia} mediaState={{...emptyMedia,state:'connected',peerPresent:true,connectedAt:Date.parse('2026-11-06T13:59:00Z')}} now={Date.parse('2026-11-06T14:00:00Z')}/>);
 expect(screen.getByText('120:00 elapsed')).toBeInTheDocument();
 expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'End call'})).toBeInTheDocument();
});
it('keeps the elapsed clock when minimized and shows no extra countdown',()=>{
 render(<CallScreen state={{...state,minimized:true}} controller={controller} media={{} as CallMedia} mediaState={emptyMedia} now={Date.parse('2026-11-06T14:00:00Z')}/>);
 expect(screen.getByRole('region',{name:'Floating video call'})).toHaveTextContent('120:00');
 expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
});
