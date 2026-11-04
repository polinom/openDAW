import {describe, it, expect} from "vitest"
import {BrowserGuestLink, browserGuestKey, guestResume} from "./BrowserGuestLink"
const url=`https://gettelecode.com/remote-control/mcp/guest/00000000-0000-4000-8000-000000000001/${"a".repeat(43)}`
function storage(): Storage {
 const values=new Map<string,string>()
 return {getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v)},removeItem:k=>{values.delete(k)},clear:()=>values.clear(),key:i=>[...values.keys()][i]??null,get length(){return values.size}}
}
describe("browser-owned MCP credential",()=>{
 it("restores the same URL only in the consenting tab; a new tab can explicitly reuse it",()=>{
  const local=storage(),tab=storage(),a=new BrowserGuestLink(local,tab,"page-a")
  a.save(url,"b".repeat(43))
  const refresh=new BrowserGuestLink(local,tab,"page-refresh")
  expect(refresh.canRestore()).toBe(true);expect(refresh.read()?.url).toBe(url)
  const other=new BrowserGuestLink(local,storage(),"other")
  expect(other.canRestore()).toBe(false);expect(other.read()?.url).toBe(url)
  other.save(url,"b".repeat(43))
  expect(a.canRestore()).toBe(false);expect(a.owns()).toBe(false)
  expect(other.owns()).toBe(true)
 })
 it("queued offline revocation never auto-restores and does not erase a replacement URL",()=>{
  const a=new BrowserGuestLink(storage(),storage(),"page-a")
  a.save(url,"b".repeat(43));const pending=a.markRevoking()!
  expect(a.canRestore()).toBe(false);expect(a.read()?.pendingRevoke).toBe(true)
  const replacement=url.slice(0,-43)+"c".repeat(43)
  a.save(replacement,"d".repeat(43));a.removeRevoked(pending)
  expect(a.read()?.url).toBe(replacement)
  a.removeRevoked(a.markRevoking()!)
  expect(a.read()).toBeUndefined()
 })
 it("rejects corrupted storage and separates agent URL from browser resumption proof",()=>{
  const local=storage(),a=new BrowserGuestLink(local,storage(),"a")
  local.setItem(browserGuestKey,'{"url":"https://evil.example/mcp","resumeToken":"bad","ownerPage":"a"}')
  expect(a.read()).toBeUndefined()
  expect(()=>a.save(url,"invalid")).toThrow()
  a.save(url,"b".repeat(43));expect(guestResume(a.read()!).secret).toBe("a".repeat(43))
  expect(guestResume(a.read()!).resumeToken).toBe("b".repeat(43))
 })
})
