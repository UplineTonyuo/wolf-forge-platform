import {expect,it} from "vitest";
import {navigationCategories,navigationForModules} from "../components/shell/nav-registry";
it("omits Operations from the shared workspace navigation even with a module grant",()=>{
 expect(navigationCategories.flatMap(c=>c.items).some(item=>item.id==="todo")).toBe(false);
 const routes=navigationForModules({dashboard:true,todo:true,projects:true}).flatMap(c=>c.items).map(item=>item.route);
 expect(routes).toContain("/orders");expect(routes).not.toContain("/todo");
});
