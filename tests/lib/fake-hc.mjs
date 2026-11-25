// Stand-in for hc.exe. State lives in the JSON file named by FAKE_HC_STATE.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const file = process.env.FAKE_HC_STATE;
const state = JSON.parse(readFileSync(file, "utf8"));
const [cmd, target, ...rest] = process.argv.slice(2);
const log = (entry) => appendFileSync(`${file}.log`, JSON.stringify(entry) + "\n");
log({ cmd, target, rest });
if (cmd === "get") {
  if (target !== state.address) { console.error("no such terminal"); process.exit(2); }
  console.log(JSON.stringify({
    address: state.address, state: state.live === false ? "dead" : "live", cwd: state.cwd, turn: state.turn,
    status: { app: state.agent, state: state.status }, labels: state.session ? { "astra.session": state.session } : {},
  }));
} else if (cmd === "send") {
  if (state.behavior === "fail") { console.error("blocked by a draft"); process.exit(1); }
  if (state.status !== "idle" && rest.includes("--if")) { console.error("not idle"); process.exit(3); }
  state.sent = [...(state.sent ?? []), rest[0]];
  if (state.behavior !== "ignore") { state.turn += 1; state.status = "working"; }
  writeFileSync(file, JSON.stringify(state));
  console.log(JSON.stringify({ ok: true }));
} else { console.error("unsupported"); process.exit(9); }
