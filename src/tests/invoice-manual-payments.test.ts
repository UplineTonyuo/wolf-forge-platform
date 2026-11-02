import { describe, expect, it, vi } from "vitest";
import { InvoiceRepository } from "../repositories/invoice-repository";

const invoiceId="10000000-0000-4000-8000-000000000001";
const receiptId="10000000-0000-4000-8000-000000000002";
const requestId="10000000-0000-4000-8000-000000000003";
const claim={id:requestId,invoice_id:invoiceId,status:"pending",amount_cents:35000,currency:"USD",method:"paypal",reference:null,created_at:"2026-10-31T12:00:00Z",reviewed_at:null,review_reason:null,payment_id:null,receipt_id:receiptId,receipt_name:"receipt.png",can_view_receipt:true};

describe("manual invoice payment declaration boundary",()=>{
  it("reports a receipt with a stale-render guard, without a settlement amount or success write",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:claim,error:null});
    const repository=new InvoiceRepository({rpc} as never);
    const result=await repository.submitManualPaymentClaim(invoiceId,{request_id:requestId,receipt_id:receiptId,method:"paypal",reference:null,expected_balance_cents:35000});
    expect(result.status).toBe("pending");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("app_submit_invoice_manual_payment_claim",{p_request_id:requestId,p_invoice_id:invoiceId,p_receipt_id:receiptId,p_method:"paypal",p_reference:null,p_expected_balance_cents:35000});
  });
  it("does not turn denied or malformed manual-payment data into success",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:null,error:{code:"42501",message:"denied"}});
    const repository=new InvoiceRepository({rpc} as never);
    await expect(repository.getManualPayment(invoiceId)).rejects.toThrow();
    rpc.mockResolvedValue({data:{settings:{enabled:true,paypal_url:null,instructions:"Pay externally"},claims:[],can_report:"true",can_review:false},error:null} as never);
    await expect(repository.getManualPayment(invoiceId)).rejects.toThrow();
  });
  it("keeps review separate from client reporting and preserves order linkage",async()=>{
    const approved={...claim,status:"approved",payment_id:receiptId,reviewed_at:"2026-10-31T12:01:00Z"};
    const rpc=vi.fn().mockResolvedValue({data:{claim:approved,order_ids:[invoiceId]},error:null});
    const repository=new InvoiceRepository({rpc} as never);
    expect(await repository.reviewManualPaymentClaim(requestId,{request_id:receiptId,decision:"approve",paid_at:"2026-10-31T12:00:00Z",reference:"SYNTHETIC-TRANSFER-1",reason:null})).toEqual({claim:approved,order_ids:[invoiceId]});
    expect(rpc).toHaveBeenCalledExactlyOnceWith("app_review_invoice_manual_payment_claim",{p_request_id:receiptId,p_claim_id:requestId,p_decision:"approve",p_paid_at:"2026-10-31T12:00:00Z",p_reference:"SYNTHETIC-TRANSFER-1",p_reason:null});
  });
});
