// @vitest-environment jsdom
import {webcrypto} from 'node:crypto';
import type {ReactNode} from 'react';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {InvoiceEmailAction,InvoiceShareButton} from '../components/invoices/invoice-sharing';

const mocks=vi.hoisted(()=>({create:vi.fn(),list:vi.fn(),revoke:vi.fn(),target:vi.fn(),send:vi.fn()}));
vi.mock('../app/actions/invoice-manual-payments',()=>({createInvoiceShareLinkAction:mocks.create,listInvoiceShareLinksAction:mocks.list,revokeInvoiceShareLinkAction:mocks.revoke,loadInvoiceEmailTargetAction:mocks.target}));
vi.mock('../app/actions/client-contact-email',()=>({sendClientContactEmailAction:mocks.send}));
vi.mock('../components/account/ui/portal-dialog',()=>({PortalDialog:({children,title,open}:{children:ReactNode;title:string;open:boolean})=>open?<section role="dialog" aria-label={title}>{children}</section>:null}));
vi.mock('../components/ui/copy-value-button',()=>({CopyValueButton:({label}:{label:string})=><button type="button">Copy {label}</button>}));

const invoiceId='10000000-0000-4000-8000-000000001911';
const first={id:'10000000-0000-4000-8000-000000001912',created_at:'2026-10-31T12:00:00Z',expires_at:'2099-11-30T12:00:00Z',revoked_at:null};
const second={...first,id:'10000000-0000-4000-8000-000000001913'};
function open(){render(<InvoiceShareButton invoiceId={invoiceId} canCreate/>);fireEvent.click(screen.getByRole('button',{name:'Share'}));}
const create=()=>fireEvent.click(screen.getByRole('button',{name:'Create public link'}));
beforeEach(()=>{
  vi.clearAllMocks();vi.stubGlobal('crypto',webcrypto);
  mocks.create.mockResolvedValue({ok:true,data:first});mocks.list.mockResolvedValue({ok:true,data:[]});
  mocks.revoke.mockImplementation(async(id:string)=>({ok:true,data:{...(id===second.id?second:first),revoked_at:'2026-10-31T12:01:00Z'}}));
  mocks.target.mockResolvedValue({ok:true,data:{contactId:'10000000-0000-4000-8000-000000001914',name:'Synthetic contact',email:'invoice-test@example.invalid',available:true}});
  mocks.send.mockResolvedValue({ok:true,message:'Email accepted.'});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('explicit invoice sharing',()=>{
  it('copies authenticated invoice/payment paths without automatically creating a public capability',()=>{
    open();expect((screen.getByLabelText('Private invoice link') as HTMLInputElement).value).toBe(`${window.location.origin}/view/invoices/${invoiceId}`);
    expect((screen.getByLabelText('Payment link') as HTMLInputElement).value).toBe(`${window.location.origin}/pay/invoices/${invoiceId}`);
    expect(mocks.create).not.toHaveBeenCalled();expect(mocks.list).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
  });
  it('retains the exact token and request when creation outcome is uncertain',async()=>{
    mocks.create.mockRejectedValueOnce(new Error('transport lost')).mockResolvedValueOnce({ok:true,data:first});
    open();create();await screen.findByRole('alert');create();
    await screen.findByLabelText('New public link');expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
    const token=mocks.create.mock.calls[0]![2];expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect((screen.getByLabelText('New public link') as HTMLInputElement).value).toBe(`${window.location.origin}/share/invoices/${token}`);
  });
  it('creates a new token/request after deliberately revoking the new capability',async()=>{
    mocks.create.mockResolvedValueOnce({ok:true,data:first}).mockResolvedValueOnce({ok:true,data:second});
    open();create();await screen.findByLabelText('New public link');
    fireEvent.click(screen.getByRole('button',{name:'Revoke'}));await waitFor(()=>expect(screen.queryByLabelText('New public link')).toBeNull());
    create();await waitFor(()=>expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[1]![1]).not.toBe(mocks.create.mock.calls[0]![1]);
    expect(mocks.create.mock.calls[1]![2]).not.toBe(mocks.create.mock.calls[0]![2]);
  });
  it('does not lose the freshly copied link when revoking a different existing link',async()=>{
    mocks.list.mockResolvedValue({ok:true,data:[first,second]});
    open();create();await screen.findByLabelText('New public link');
    const original=(screen.getByLabelText('New public link') as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button',{name:'Manage existing links'}));
    await waitFor(()=>expect(screen.getAllByRole('button',{name:'Revoke'})).toHaveLength(2));
    const rows=within(screen.getByRole('list',{name:'Public invoice links'})).getAllByRole('listitem');
    fireEvent.click(within(rows[1]!).getByRole('button',{name:'Revoke'}));
    await waitFor(()=>expect(mocks.revoke).toHaveBeenCalledWith(second.id));
    await waitFor(()=>expect(screen.getByLabelText('New public link')).toBeTruthy());
    expect((screen.getByLabelText('New public link') as HTMLInputElement).value).toBe(original);
  });
  it('does not offer capability creation without manage authority',()=>{
    render(<InvoiceShareButton invoiceId={invoiceId} canCreate={false}/>);fireEvent.click(screen.getByRole('button',{name:'Share'}));
    expect(screen.queryByRole('button',{name:'Create public link'})).toBeNull();expect(screen.getByLabelText('Private invoice link')).toBeTruthy();
  });
});

describe('invoice email is a reviewed composition',()=>{
  it('prefills private/payment links and never sends when the composer opens',async()=>{
    render(<InvoiceEmailAction invoiceId={invoiceId} invoiceLabel="Invoice #WF-0191"/>);
    fireEvent.click(screen.getByRole('button',{name:'Email invoice'}));
    expect((await screen.findByLabelText('Subject') as HTMLInputElement).value).toBe('Invoice #WF-0191 · Wolf Forge');
    const body=(screen.getByLabelText('Message') as HTMLTextAreaElement).value;
    expect(body).toContain(`${window.location.origin}/view/invoices/${invoiceId}`);
    expect(body).toContain(`${window.location.origin}/pay/invoices/${invoiceId}`);
    expect(body).not.toContain('/share/invoices/');expect(mocks.send).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(mocks.send).not.toHaveBeenCalled();
  });
  it('keeps sending unavailable while Gmail is disconnected',async()=>{
    mocks.target.mockResolvedValue({ok:true,data:{contactId:first.id,name:'Synthetic contact',email:'invoice-test@example.invalid',available:false}});
    render(<InvoiceEmailAction invoiceId={invoiceId} invoiceLabel="Invoice #WF-0191"/>);fireEvent.click(screen.getByRole('button',{name:'Email invoice'}));
    const send=await screen.findByRole('button',{name:'Send email'});expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);expect(mocks.send).not.toHaveBeenCalled();expect(screen.getByRole('status').textContent).toMatch(/Connect Gmail/i);
  });
  it('shows an authorization failure without opening a sendable composer',async()=>{
    mocks.target.mockResolvedValue({ok:false,error:'Current client contact access is unavailable.'});
    render(<InvoiceEmailAction invoiceId={invoiceId} invoiceLabel="Invoice #WF-0191"/>);fireEvent.click(screen.getByRole('button',{name:'Email invoice'}));
    expect((await screen.findByRole('alert')).textContent).toMatch(/access is unavailable/i);
    expect(screen.queryByRole('button',{name:'Send email'})).toBeNull();expect(mocks.send).not.toHaveBeenCalled();
  });
});
