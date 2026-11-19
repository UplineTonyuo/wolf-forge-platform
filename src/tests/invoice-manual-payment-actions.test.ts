import {createHash} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {PermissionDeniedError,ValidationError} from '../lib/errors/application-error';

const mocks=vi.hoisted(()=>({clientContext:vi.fn(),internalContext:vi.fn(),refresh:vi.fn(),available:vi.fn(),submit:vi.fn(),review:vi.fn(),settings:vi.fn(),create:vi.fn(),list:vi.fn(),revoke:vi.fn(),get:vi.fn(),contacts:vi.fn()}));
vi.mock('next/cache',()=>({revalidatePath:mocks.refresh}));
vi.mock('../lib/supabase/next-server',()=>({getClientContext:mocks.clientContext,getInternalContext:mocks.internalContext}));
vi.mock('../lib/email/client-welcome-email-server',()=>({canSendClientEmail:mocks.available}));
import {createInvoiceShareLinkAction,listInvoiceShareLinksAction,loadInvoiceEmailTargetAction,reviewInvoiceManualPaymentAction,revokeInvoiceShareLinkAction,saveInvoiceManualSettingsAction,submitInvoiceManualPaymentAction} from '../app/actions/invoice-manual-payments';

const invoiceId='10000000-0000-4000-8000-000000001921',claimId='10000000-0000-4000-8000-000000001922',requestId='10000000-0000-4000-8000-000000001923';
const actor={id:'10000000-0000-4000-8000-000000001924'};
const services={invoices:{submitManualPaymentClaim:mocks.submit,reviewManualPaymentClaim:mocks.review,saveManualPaymentSettings:mocks.settings,createShareLink:mocks.create,listShareLinks:mocks.list,revokeShareLink:mocks.revoke,get:mocks.get},contacts:{listForCompany:mocks.contacts}};
beforeEach(()=>{
  vi.clearAllMocks();mocks.clientContext.mockResolvedValue({actor,services});mocks.internalContext.mockResolvedValue({actor,services});
  mocks.available.mockResolvedValue(true);mocks.get.mockResolvedValue({invoice:{id:invoiceId,company_id:claimId}});
});
describe('invoice manual payment actions',()=>{
  it('passes the SSR balance guard to the client service and revalidates only after acceptance',async()=>{
    const input={request_id:requestId,receipt_id:claimId,method:'paypal',reference:null,expected_balance_cents:35000};
    mocks.submit.mockResolvedValue({id:claimId,status:'pending'});
    expect(await submitInvoiceManualPaymentAction(invoiceId,input)).toEqual({ok:true,data:{id:claimId,status:'pending'}});
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(invoiceId,input,actor);expect(mocks.internalContext).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledWith(`/account/invoices/${invoiceId}`);
  });
  it('returns a stale balance refusal without claiming success or refreshing accepted state',async()=>{
    mocks.submit.mockRejectedValue(new ValidationError('Invoice balance changed; refresh before reporting payment.'));
    expect(await submitInvoiceManualPaymentAction(invoiceId,{expected_balance_cents:35000})).toEqual({ok:false,error:'Invoice balance changed; refresh before reporting payment.'});
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('does not call the client repository when the session is no longer authorized',async()=>{
    mocks.clientContext.mockRejectedValue(new PermissionDeniedError());
    expect(await submitInvoiceManualPaymentAction(invoiceId,{})).toMatchObject({ok:false});expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('reviews through the internal service and uses the returned invoice identity for invalidation',async()=>{
    const input={request_id:requestId,decision:'reject',paid_at:null,reference:null,reason:'Transfer not found'};
    mocks.review.mockResolvedValue({claim:{id:claimId,invoice_id:invoiceId,status:'rejected'},order_ids:[]});
    expect(await reviewInvoiceManualPaymentAction(claimId,input)).toMatchObject({ok:true});
    expect(mocks.review).toHaveBeenCalledWith(claimId,input,actor);expect(mocks.clientContext).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledWith(`/invoices/${invoiceId}`);expect(mocks.refresh).toHaveBeenCalledWith('/orders');
  });
  it('does not turn a current-capability review refusal into success',async()=>{
    mocks.review.mockRejectedValue(new PermissionDeniedError());
    expect(await reviewInvoiceManualPaymentAction(claimId,{})).toMatchObject({ok:false});expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('saves operator instructions only through the internal service',async()=>{
    const input={enabled:true,paypal_url:null,instructions:'Reviewed bank instructions'};mocks.settings.mockResolvedValue(input);
    expect(await saveInvoiceManualSettingsAction(input)).toEqual({ok:true,data:input});expect(mocks.settings).toHaveBeenCalledWith(input,actor);
    expect(mocks.refresh).toHaveBeenCalledWith('/settings/billing');
  });
});
describe('invoice capability actions',()=>{
  it('hashes the raw one-time token before passing it to persistence',async()=>{
    const raw='a'.repeat(64),hash=createHash('sha256').update(raw).digest('hex');mocks.create.mockResolvedValue({id:claimId});
    expect(await createInvoiceShareLinkAction(invoiceId,requestId,raw)).toEqual({ok:true,data:{id:claimId}});
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(invoiceId,requestId,hash,actor);expect(hash).not.toBe(raw);
  });
  it('does not create a capability for malformed token input',async()=>{
    expect(await createInvoiceShareLinkAction(invoiceId,requestId,'short')).toMatchObject({ok:false});expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects a valid-looking share token followed by a newline instead of hashing a different capability',async()=>{
    expect(await createInvoiceShareLinkAction(invoiceId,requestId,'a'.repeat(64)+'\n')).toMatchObject({ok:false});
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('retains the request identity when the same link creation is retried',async()=>{
    mocks.create.mockRejectedValueOnce(new Error('transport')).mockResolvedValueOnce({id:claimId});
    await createInvoiceShareLinkAction(invoiceId,requestId,'b'.repeat(64));await createInvoiceShareLinkAction(invoiceId,requestId,'b'.repeat(64));
    expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
  });
  it('does not bypass current authorization while listing or revoking links',async()=>{
    mocks.internalContext.mockRejectedValue(new PermissionDeniedError());
    expect(await listInvoiceShareLinksAction(invoiceId)).toMatchObject({ok:false});expect(await revokeInvoiceShareLinkAction(claimId)).toMatchObject({ok:false});
    expect(mocks.list).not.toHaveBeenCalled();expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
describe('invoice email target preparation',()=>{
  it('selects an authorized primary contact from the invoice company',async()=>{
    mocks.contacts.mockResolvedValue([{id:requestId,name:'Secondary',email:'second@example.invalid',is_primary:false},{id:claimId,name:'Primary',email:'primary@example.invalid',is_primary:true}]);
    expect(await loadInvoiceEmailTargetAction(invoiceId)).toEqual({ok:true,data:{contactId:claimId,name:'Primary',email:'primary@example.invalid',available:true}});
    expect(mocks.contacts).toHaveBeenCalledExactlyOnceWith(claimId);expect(mocks.available).toHaveBeenCalledTimes(1);
  });
  it('does not read contacts when access to the invoice itself was denied',async()=>{
    mocks.get.mockRejectedValue(new PermissionDeniedError());expect(await loadInvoiceEmailTargetAction(invoiceId)).toMatchObject({ok:false});
    expect(mocks.contacts).not.toHaveBeenCalled();expect(mocks.available).not.toHaveBeenCalled();
  });
});
