import { beforeEach,describe,expect,it,vi } from "vitest";
import {createHash} from "node:crypto";
const mocks=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),trusted:vi.fn(),store:vi.fn(),download:vi.fn(),limit:vi.fn()}));
vi.mock("../lib/supabase/next-server",()=>({getVerifiedSessionContext:mocks.session}));
vi.mock("../lib/security/server-cost-limit",()=>({enforceServerCostLimit:mocks.limit}));
vi.mock("../lib/env/server-env",()=>({readServerEnvironment:()=>({})}));
vi.mock("../lib/supabase/trusted-server-client",()=>({createTrustedServerSupabaseClient:()=>({rpc:mocks.trusted})}));
vi.mock("../repositories/ticket-attachment-storage-repository",()=>({TicketAttachmentStorageRepository:vi.fn().mockImplementation(function(){return {storeOrConfirm:mocks.store,download:mocks.download};})}));
const {POST}=await import("../app/api/invoice-payment-receipts/[invoiceId]/route");
const {GET}=await import("../app/api/invoice-payment-receipts/file/[receiptId]/route");
const invoiceId="10000000-0000-4000-8000-000000000001",id="10000000-0000-4000-8000-000000000002";
const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
const receipt={id,name:"receipt.png",mime:"image/png",size:8,path:`synthetic/${invoiceId}/${id}.png`};
const params={params:Promise.resolve({invoiceId,receiptId:id})};
function upload(origin="https://wolf-forge.invalid",body:BodyInit=bytes){return new Request(`https://wolf-forge.invalid/api/invoice-payment-receipts/${invoiceId}`,{method:"POST",headers:{origin,host:"wolf-forge.invalid","x-request-id":id,"x-file-name":"receipt.png","x-file-size":"8","x-file-mime":"image/png","x-file-sha256":createHash("sha256").update(bytes).digest("hex")},body});}
beforeEach(()=>{
  vi.clearAllMocks();mocks.session.mockResolvedValue({actor:{id},client:{rpc:mocks.rpc}});
  mocks.rpc.mockResolvedValue({data:receipt,error:null});mocks.trusted.mockResolvedValue({data:receipt,error:null});
  mocks.store.mockResolvedValue(false);mocks.limit.mockResolvedValue(undefined);mocks.download.mockResolvedValue(new Blob([bytes]));
});
describe("private invoice receipt routes",()=>{
  it("rejects cross-site posts before session, bytes or storage work",async()=>{
    expect((await POST(upload("https://attacker.invalid"),params)).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();expect(mocks.store).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated and non-image upload attempts",async()=>{
    mocks.session.mockResolvedValueOnce(null);expect((await POST(upload(),params)).status).toBe(401);
    expect((await POST(upload(undefined,"<svg onload=alert(1)></svg>"),params)).status).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();expect(mocks.trusted).not.toHaveBeenCalled();
  });
  it("rechecks client authority after upload then verifies only through trusted RPC",async()=>{
    const response=await POST(upload(),params);expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.trusted).toHaveBeenCalledExactlyOnceWith("app_verify_invoice_payment_receipt",{p_receipt_id:id,p_uploader_profile_id:id,p_checksum_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
    expect(await response.json()).toEqual({ok:true,data:{id,name:"receipt.png",mime:"image/png",size:8}});
  });
  it("never releases bytes if authority is revoked during download",async()=>{
    mocks.rpc.mockResolvedValueOnce({data:receipt,error:null}).mockResolvedValueOnce({data:null,error:{code:"42501",message:"denied"}});
    const response=await GET(new Request("https://wolf-forge.invalid"),params);
    expect(response.status).toBe(403);expect(await response.text()).not.toContain("synthetic/");
  });
  it("proxies private bytes with no-store/nosniff and no raw Storage URL",async()=>{
    const response=await GET(new Request("https://wolf-forge.invalid"),params);
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");expect(response.headers.has("location")).toBe(false);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
