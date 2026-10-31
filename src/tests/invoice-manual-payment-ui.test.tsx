// @vitest-environment jsdom
import {webcrypto} from 'node:crypto';
import type {ReactNode} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {InvoiceManualPaymentPanel,InvoiceManualPaymentReview,InvoiceManualPaymentSettings} from '../components/invoices/invoice-manual-payment';
import type {InvoiceManualPayment,ManualPaymentClaim} from '../domain/invoices/manual-payments';

const mocks=vi.hoisted(()=>({submit:vi.fn(),review:vi.fn(),settings:vi.fn(),refresh:vi.fn(),fetch:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('../app/actions/invoice-manual-payments',()=>({submitInvoiceManualPaymentAction:mocks.submit,reviewInvoiceManualPaymentAction:mocks.review,saveInvoiceManualSettingsAction:mocks.settings}));
vi.mock('../components/account/ui/portal-dialog',()=>({PortalDialog:({children,title,open}:{children:ReactNode;title:string;open:boolean})=>open?<section role="dialog" aria-label={title}>{children}</section>:null}));
vi.mock('../components/ui/animated-select',()=>({AnimatedSelect:({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options:{label:string;value:string}[]})=><select aria-label={label} value={value} onChange={(event)=>onChange(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>}));
vi.mock('../components/ui/date-picker',()=>({DatePicker:({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void})=><input aria-label={label} type="date" value={value} onChange={(event)=>onChange(event.target.value)}/> }));

const invoiceId='10000000-0000-4000-8000-000000001901';
const receiptId='10000000-0000-4000-8000-000000001902';
const claim:ManualPaymentClaim={id:'10000000-0000-4000-8000-000000001903',invoice_id:invoiceId,status:'pending',amount_cents:35000,currency:'USD',method:'paypal',reference:'UNVERIFIED-CLIENT-REFERENCE',created_at:'2026-10-31T12:00:00Z',reviewed_at:null,review_reason:null,payment_id:null,receipt_id:receiptId,receipt_name:'receipt.png',can_view_receipt:true};
const settings={enabled:true,paypal_url:null,instructions:'Use the invoice reference when paying externally.'};
const context=(overrides:Partial<InvoiceManualPayment>={}):InvoiceManualPayment=>({settings,claims:[],can_report:true,can_review:false,...overrides});
function mountClient(overrides:Partial<InvoiceManualPayment>={}){return render(<InvoiceManualPaymentPanel invoiceId={invoiceId} balanceCents={35000} currency="USD" context={context(overrides)}/>);}
function screenshot(){
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO+0AAAAASUVORK5CYII=','base64');
  const file=new File([bytes],'receipt.png',{type:'image/png'});
  Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
  return file;
}
function reportForm(){return screen.getByRole('button',{name:'Submit payment receipt'}).closest('form')!;}
function attach(){fireEvent.change(screen.getByLabelText(/Receipt screenshot/),{target:{files:[screenshot()]}});}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',mocks.fetch);
  mocks.fetch.mockResolvedValue({ok:true,json:async()=>({ok:true,data:{id:receiptId,name:'receipt.png',mime:'image/png',size:68,path:'synthetic/receipt.png'}})});
  mocks.submit.mockResolvedValue({ok:true,data:{...claim,reference:null}});
  mocks.review.mockResolvedValue({ok:true,data:{claim:{...claim,status:'approved'},order_ids:[]}});
  mocks.settings.mockResolvedValue({ok:true,data:settings});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('client manual invoice report',()=>{
  it('opens a confirmation without uploading or reporting automatically',()=>{
    mountClient();fireEvent.click(screen.getByRole('button',{name:"I've paid"}));
    expect(screen.getByRole('dialog',{name:'Report your payment'})).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('requires an actual receipt before any network work',()=>{
    mountClient();fireEvent.click(screen.getByRole('button',{name:"I've paid"}));fireEvent.submit(reportForm());
    expect(screen.getByRole('alert').textContent).toMatch(/receipt screenshot/i);
    expect(mocks.fetch).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('submits the originally rendered balance as a concurrency guard, without requesting settlement',async()=>{
    mountClient();fireEvent.click(screen.getByRole('button',{name:"I've paid"}));attach();fireEvent.submit(reportForm());
    await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.submit).toHaveBeenCalledWith(invoiceId,expect.objectContaining({receipt_id:receiptId,method:'bank_transfer',reference:null,expected_balance_cents:35000}));
    const input=mocks.submit.mock.calls[0]![1];expect(input.status).toBeUndefined();expect(input.amount_cents).toBeUndefined();
    await waitFor(()=>expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });
  it('keeps the receipt and original request on a refused claim retry',async()=>{
    mocks.submit.mockResolvedValueOnce({ok:false,error:'Invoice balance changed; refresh before reporting payment.'});
    mountClient();fireEvent.click(screen.getByRole('button',{name:"I've paid"}));attach();fireEvent.submit(reportForm());
    await screen.findByRole('alert');expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.submit(reportForm());await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.submit.mock.calls[1]).toEqual(mocks.submit.mock.calls[0]);
  });
  it('shows pending review without offering a second report',()=>{
    mountClient({claims:[claim],can_report:false});expect(screen.getByRole('status').textContent).toMatch(/awaiting verification/i);
    expect(screen.queryByRole('button',{name:"I've paid"})).toBeNull();expect(mocks.submit).not.toHaveBeenCalled();
  });
});

describe('invoice payment review',()=>{
  const openReview=()=>{render(<InvoiceManualPaymentReview context={context({claims:[claim],can_report:false,can_review:true})}/>);fireEvent.click(screen.getByRole('button',{name:'Review payment'}));};
  it('requires a reviewer-entered verified reference rather than accepting the client reference as evidence',()=>{
    openReview();expect((screen.getByLabelText(/Verified transaction reference/) as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button',{name:'Confirm payment received'}));
    expect(mocks.review).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toMatch(/actual transaction reference/i);
  });
  it('sends explicit approve data only after user confirmation',async()=>{
    openReview();expect(mocks.review).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Verified transaction reference/),{target:{value:'BANK-VERIFIED-1901'}});
    fireEvent.change(screen.getByLabelText('Date paid'),{target:{value:'2026-10-31'}});
    fireEvent.click(screen.getByRole('button',{name:'Confirm payment received'}));
    await waitFor(()=>expect(mocks.review).toHaveBeenCalledTimes(1));
    expect(mocks.review).toHaveBeenCalledWith(claim.id,expect.objectContaining({decision:'approve',paid_at:new Date('2026-10-31T00:00:00').toISOString(),reference:'BANK-VERIFIED-1901',reason:null}));
  });
  it('requires a rejection reason and submits no payment date or transaction reference on rejection',async()=>{
    openReview();fireEvent.click(screen.getByRole('button',{name:'Reject report'}));expect(mocks.review).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Review note / rejection reason'),{target:{value:'The bank has not received this transfer.'}});
    fireEvent.click(screen.getByRole('button',{name:'Reject report'}));await waitFor(()=>expect(mocks.review).toHaveBeenCalledTimes(1));
    expect(mocks.review).toHaveBeenCalledWith(claim.id,expect.objectContaining({decision:'reject',paid_at:null,reference:null,reason:'The bank has not received this transfer.'}));
  });
  it('does not offer review controls when current review authority is absent',()=>{
    render(<InvoiceManualPaymentReview context={context({claims:[claim],can_review:false})}/>);expect(screen.queryByRole('button',{name:'Review payment'})).toBeNull();expect(mocks.review).not.toHaveBeenCalled();
  });
});

describe('manual invoice payment settings',()=>{
  it('does not save automatically and refuses enabled empty instructions',()=>{
    render(<InvoiceManualPaymentSettings initial={{enabled:false,paypal_url:null,instructions:''}}/>);
    expect(mocks.settings).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save payment instructions'}));
    expect(mocks.settings).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toMatch(/instructions|PayPal/i);
  });
  it('saves reviewed settings explicitly and acknowledges the server result',async()=>{
    render(<InvoiceManualPaymentSettings initial={{enabled:false,paypal_url:null,instructions:''}}/>);
    fireEvent.click(screen.getByRole('checkbox'));fireEvent.change(screen.getByLabelText('Payment instructions'),{target:{value:'Pay externally using your invoice reference.'}});
    fireEvent.click(screen.getByRole('button',{name:'Save payment instructions'}));
    await waitFor(()=>expect(mocks.settings).toHaveBeenCalledWith({enabled:true,paypal_url:null,instructions:'Pay externally using your invoice reference.'}));
    expect((await screen.findByRole('status')).textContent).toMatch(/saved/i);
  });
});
