import { describe,expect,it } from "vitest";
import { readBoundedBytes } from "../lib/security/bounded-text";
import { invoiceManualSettingsInputSchema,paymentReceiptInputSchema,reviewManualPaymentClaimSchema,submitManualPaymentClaimSchema } from "../domain/invoices/manual-payments";

const id="10000000-0000-4000-8000-000000000001";
describe("manual invoice boundaries",()=>{
  it("retains binary images and refuses an oversized or truncated body",async()=>{
    const image=new Uint8Array([137,80,78,71,13,10,26,10]);
    await expect(readBoundedBytes(new Request("https://test.invalid",{method:"POST",body:image}),8)).resolves.toEqual({ok:true,value:image});
    await expect(readBoundedBytes(new Request("https://test.invalid",{method:"POST",body:image}),7)).resolves.toEqual({ok:false,status:413});
    await expect(readBoundedBytes(new Request("https://test.invalid",{method:"POST",body:image,headers:{"content-length":"9"}}),9)).resolves.toEqual({ok:false,status:400});
  });
  it("only enables configured methods and refuses lookalike or credential-bearing PayPal URLs",()=>{
    expect(invoiceManualSettingsInputSchema.safeParse({enabled:true,paypal_url:null,instructions:""}).success).toBe(false);
    for(const paypal_url of ["https://paypal.me.attacker.invalid/test","https://paypal.me@attacker.invalid/test","https://user:pass@paypal.me/test","http://paypal.me/test","javascript:alert(1)"])
      expect(invoiceManualSettingsInputSchema.safeParse({enabled:true,paypal_url,instructions:""}).success).toBe(false);
    expect(invoiceManualSettingsInputSchema.safeParse({enabled:true,paypal_url:"https://paypal.me/synthetic-test",instructions:"Pay the exact invoice balance."}).success).toBe(true);
  });
  it("requires a receipt and strips client-supplied success or amount authority",()=>{
    expect(submitManualPaymentClaimSchema.safeParse({request_id:id,method:"paypal",reference:null}).success).toBe(false);
    expect(submitManualPaymentClaimSchema.parse({request_id:id,receipt_id:id,method:"paypal",reference:null,expected_balance_cents:35000,amount_cents:1,status:"approved"})).toEqual({request_id:id,receipt_id:id,method:"paypal",reference:null,expected_balance_cents:35000});
    expect(submitManualPaymentClaimSchema.safeParse({request_id:id,receipt_id:id,method:"paypal",reference:null,expected_balance_cents:0}).success).toBe(false);
  });
  it("bounds receipt files and demands explicit review evidence",()=>{
    const receipt={request_id:id,filename:"receipt.png",mime_type:"image/png",size_bytes:8,checksum_sha256:"a".repeat(64)};
    expect(paymentReceiptInputSchema.safeParse(receipt).success).toBe(true);
    expect(paymentReceiptInputSchema.safeParse({...receipt,size_bytes:4194305}).success).toBe(false);
    expect(paymentReceiptInputSchema.safeParse({...receipt,filename:"../receipt.png"}).success).toBe(false);
    expect(paymentReceiptInputSchema.safeParse({...receipt,mime_type:"image/svg+xml"}).success).toBe(false);
    expect(reviewManualPaymentClaimSchema.safeParse({request_id:id,decision:"approve",paid_at:null,reference:null,reason:null}).success).toBe(false);
    expect(reviewManualPaymentClaimSchema.safeParse({request_id:id,decision:"reject",paid_at:null,reference:null,reason:" "}).success).toBe(false);
  });
});
