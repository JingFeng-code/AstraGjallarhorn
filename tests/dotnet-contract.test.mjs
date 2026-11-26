import test from "node:test";
import assert from "node:assert/strict";
import {cachedPackageNames} from "./lib/dotnet-contract.mjs";
test("offline package selection uses locked names and versions only, no traversal",()=>{
  assert.deepEqual(cachedPackageNames({dependencies:{"net10.0":{Xunit:{resolved:"2.9.3"}}}}),[{id:"xunit",version:"2.9.3",file:"xunit.2.9.3.nupkg"}]);
  for(const entries of [{"../escape":{resolved:"1.0.0"}},{Xunit:{resolved:"../escape"}},{Xunit:{}},{}])assert.throws(()=>cachedPackageNames({dependencies:{"net10.0":entries}}));
});
