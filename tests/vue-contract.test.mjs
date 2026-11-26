import test from "node:test";
import assert from "node:assert/strict";
import {edgeHostEnvironment} from "./lib/vue-contract.mjs";
test("Edge environment is case-insensitive, limited to Windows OS fields and excludes credentials",()=>{
  const out=edgeHostEnvironment({SYSTEMROOT:"C:\\Windows",UserProfile:"C:\\Users\\fixture",localappdata:"C:\\Users\\fixture\\AppData\\Local",APPDATA:"C:\\Users\\fixture\\AppData\\Roaming",ProgramData:"C:\\ProgramData",Path:"C:\\Windows\\System32",OPENAI_API_KEY:"secret",GITHUB_TOKEN:"secret",NPM_TOKEN:"secret",HTTPS_PROXY:"secret",HOME:"untrusted",TEMP:"not the approved profile",PLAYWRIGHT_BROWSERS_PATH:"untrusted"});
  assert.deepEqual(out,{SystemRoot:"C:\\Windows",USERPROFILE:"C:\\Users\\fixture",LOCALAPPDATA:"C:\\Users\\fixture\\AppData\\Local",APPDATA:"C:\\Users\\fixture\\AppData\\Roaming",ProgramData:"C:\\ProgramData",PATH:"C:\\Windows\\System32"});
});
