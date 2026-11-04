# TODO

Ordered roughly by value.

## Run real agents
- [ ] First live Claude runs: `npm run bench -- --agents claude-haiku-5-5,claude-sonnet-5-5 --seeds 1-5 --budget 1 --concurrency 5`. Nothing here has been run against the live API yet; the agent loop is only tested against a scripted client.
- [ ] Play through Claude Code with the bundled `.mcp.json` and compare the `mcp:claude-code` replays to the API agent.
- [ ] Record per-call latency in replays so the viewer can show time as well as turns.

## Benchmark design
- [ ] Fixed public and held-out seed sets (`--seeds public` / `--seeds heldout`) so prompt tuning can't overfit.
- [ ] Confidence intervals in the leaderboard (bootstrap over seeds), and a paired comparison view: agent A vs B on the same seeds.
- [ ] Observation variants as an experiment knob: map only, list only, or both (`--view`).
- [ ] A "memory" tool (notes the agent can write and read) to test whether agents plan across floors.
- [ ] Difficulty presets. The explorer baseline averages depth ~6.7 and never wins on the default settings; keep that headroom when tuning.

## Game
- [ ] Ranged monsters, traps, and doors so pathing and risk matter more.
- [ ] Hunger or a soft turn clock that rewards descending instead of clearing every floor.
- [ ] Unidentified potions (some harmful) to test experimentation under uncertainty.

## Viewer
- [ ] Diff two replays of the same seed side by side.
- [ ] Filter the leaderboard by toolset, model, and date.
- [ ] Export a replay to GIF.

## Plumbing
- [ ] Streamable HTTP transport for the MCP server, with one game per MCP session.
- [ ] Publish to npm so `npx dungeon-bench mcp` works without cloning.
