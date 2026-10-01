# Provenance and Clean-Room Statement: cost-savers

**Component:** cost-savers 0.1.0  
**Licensor:** Juan Carlos De Santiago  
**Licence:** PolyForm Small Business 1.0.0 **or** PolyForm Noncommercial 1.0.0 (`LICENSING.md`).  
**Disclosure:** Published as defensive prior art; no patents filed (`TECHNICAL-DISCLOSURE.md`).

---

## 1. Clean-Room Provenance

The components of `cost-savers` were authored between August and September 2026 by Juan Carlos De Santiago with assistance from the Sovereign Raptor AI fleet agents. The software was engineered directly from the operational requirements of managing autonomous multi-agent systems over thousands of task dispatches.

No third-party code from proprietary context management or prompt compression systems was referenced or copied. The implementation interfaces with the public `@opencode-ai/plugin` interface specifications.

---

## 2. Dependencies

| Component | Role | Licence | Shipped? |
|---|---|---|---|
| Node.js 22+ | Runtime for TypeScript plugins | MIT | No (external runtime) |
| `@opencode-ai/plugin` | TypeScript type declarations | MIT | No (type peer dependency) |
| Python 3 (3.10+) | Runtime for CLI analytics tools | PSF-2.0 | No (external runtime) |
| SQLite3 | Database engine (Python stdlib) | Public Domain | No (runtime) |

---

## 3. Excluded Fleet Artifacts

The following internal items are intentionally excluded from this release:

| Artifact | Reason for Exclusion |
|---|---|
| `exoskeleton.ts` | Fleet-specific governance injection plugin (injects local fleet laws/creed; adds tokens rather than saving) |
| `mcp-gate.ts` | Fleet-specific role-to-MCP tool access enforcement |
| `seat-ledger.ts` | Fleet-specific per-seat financial billing ledger tied to `dispatch.db` |
| `opencode.db` / `dispatch.db` | Operational telemetry and task queue databases containing private user task histories |
| `metrics.jsonl` / `cloud-audit.jsonl` | Production runtime logs generated during execution |
| `*.bak` / `*.backup` | Intermediate development scratch and backup files |
