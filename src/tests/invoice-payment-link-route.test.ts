import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),redirect:vi.fn((path:string)=>{throw new Error(`REDIRECT:${path}`);}),notFound:vi.fn(()=>{throw new Error('NOT_FOUND');})}));
vi.mock('next/navigation',()=>({redirect:mocks.redirect,notFound:mocks.notFound}));
vi.mock('../lib/supabase/next-server',()=>({getVerifiedSessionContext:mocks.session}));
import InvoicePaymentLinkPage from '../app/pay/invoices/[invoiceId]/page';
const id='10000000-0000-4000-8000-000000001931';
const destination=`/account/invoices/${id}#invoice-payment-options`;
beforeEach(()=>{vi.clearAllMocks();});
it('preserves the private invoice and payment anchor through sign-in',async()=>{
  mocks.session.mockResolvedValue(null);
  await expect(InvoicePaymentLinkPage({params:Promise.resolve({invoiceId:id})})).rejects.toThrow(`REDIRECT:/login?next=${encodeURIComponent(destination)}`);
  expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(`/login?next=${encodeURIComponent(destination)}`);
});
it('routes an existing verified session to the account authorization boundary',async()=>{
  mocks.session.mockResolvedValue({actor:{id}});
  await expect(InvoicePaymentLinkPage({params:Promise.resolve({invoiceId:id})})).rejects.toThrow(`REDIRECT:${destination}`);
  expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(destination);
});
it('does not use an unvalidated invoice value in a redirect',async()=>{
  await expect(InvoicePaymentLinkPage({params:Promise.resolve({invoiceId:'https://attacker.invalid'})})).rejects.toThrow('NOT_FOUND');
  expect(mocks.session).not.toHaveBeenCalled();expect(mocks.redirect).not.toHaveBeenCalled();
});
it('does not turn an unavailable verified-session lookup into successful account access',async()=>{
  mocks.session.mockRejectedValue(new Error('Session lookup unavailable'));
  await expect(InvoicePaymentLinkPage({params:Promise.resolve({invoiceId:id})})).rejects.toThrow('Session lookup unavailable');
  expect(mocks.redirect).not.toHaveBeenCalled();
});
