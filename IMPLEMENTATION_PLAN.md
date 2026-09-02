# Property Accountant AI Agent — Build Plan

## Project Location
`C:\Users\RossRichardson\Projects\sage-intacct-agent`

## Architecture Decision

The v2 plan specifies Claude Agent SDK with custom MCP tools. Based on current SDK docs:

- **Custom tools** are defined with the `@tool` decorator and exposed via `create_sdk_mcp_server`
- **Hooks** use `HookMatcher` callbacks for PreToolUse (approval) and PostToolUse (audit)
- **The agent** runs via `ClaudeSDKClient` with `mcp_servers`, `hooks`, `system_prompt`, `max_turns`, `max_budget_usd`
- **Sage Intacct client** is a standalone Python XML client (not the SDK — custom for full API coverage)

## Build Order (19 Steps)

### Phase 1: Foundation (Steps 1–4)

**Step 1: Project scaffolding**
- Create directory structure per v2 plan
- `pyproject.toml` with deps: `claude-agent-sdk`, `anthropic`, `requests`, `lxml`, `openpyxl`, `python-dotenv`, `pydantic`
- `.env.example` with Sage Intacct credential placeholders
- `.gitignore`
- Empty `__init__.py` files

**Step 2: Config & entity registry** (`src/config.py`)
- Load `.env` with `python-dotenv`
- Pydantic settings model for all Intacct credentials
- Entity registry: all Method Co properties with LOCATIONID codes
- Approval thresholds config (auto-approve < $1,000, single approval, dual > $10K)
- Close calendar day mapping

**Step 3: Sage Intacct XML client** (`src/intacct/client.py`)
- Session auth via `getAPISession` (XML Web Services)
- XML request builder: control block (sender ID/password), operation block (company login), function calls
- XML response parser with error extraction
- Pagination via `readMore` with result ID tracking
- Rate limiting with exponential backoff (429 handling)
- Session auto-renewal on 30-min expiry
- All requests go through `POST https://api.intacct.com/ia/xml/xmlgw.phtml`

**Step 4: API modules** (`src/intacct/`)
- `models.py` — Pydantic models: GLDetail, GLAccount, APBill, APBillItem, GLBatch, GLEntry, BudgetHeader, BudgetItem, CheckingAccount, BankTransaction, AccountBalance
- `gl.py` — `read_gldetail()`, `read_glaccount()`, `get_accountbalances()`, `get_accountbalancesbydimensions()`
- `ap.py` — `create_apbill()`, `read_apbill()`, `query_apbills()`, `get_ap_aging()`
- `ar.py` — `read_arinvoice()`, `query_arinvoices()`
- `journal.py` — `create_glbatch()` with GLENTRY lines, balanced-entry validation
- `budget.py` — `read_glbudgetheader()`, `query_glbudgetitems()`
- `bank.py` — `read_checkingaccount()`, `get_bank_transactions()`, `reconcile_bank()`

### Phase 2: Core Tools (Steps 5–10)

Each tool is a function decorated with `@tool` and registered on the MCP server. Tools use the Intacct client from Step 3–4.

**Step 5: GL Scrub** (`src/tools/gl_scrub.py`)
- Queries GLDETAIL for period + LOCATIONID
- Flags: duplicates, missing descriptions, outlier amounts (2+ SD), out-of-period postings, stale suspense/clearing items, missing dimensions, interco imbalances
- Returns prioritized exception report (Critical/Warning/Info)
- Mode: Autonomous (no approval needed)

**Step 6: GL Detail Drill-Down** (`src/tools/gl_detail.py`)
- Full GL drill-down by account, period, property, vendor, cost center
- Links GLDETAIL entries to source documents (APBILL, GLBATCH record numbers)
- Pulls invoice-level detail for AP transactions
- Supports natural-language-style parameter passing
- Mode: Autonomous

**Step 7: Budget vs Actual Variance** (`src/tools/variance.py`)
- Calls `get_accountbalancesbydimensions` with `contentselection='Actual and Budget'`
- Accepts budget ID, period, location, account category filter
- Calculates variance $ and % per account
- Flags material variances (configurable: >10% AND >$2,500 default)
- Supports multi-property consolidated and single-property detail
- Mode: Autonomous

**Step 8: Bank Reconciliation** (`src/tools/bank_recon.py`)
- Queries CHECKINGACCOUNT and transaction history
- Accepts bank statement data via CSV path
- Matching engine: exact amount + date proximity + check number + memo fuzzy match
- Auto-posts matched clearing entries (approval-gated for the JE)
- Generates reconciliation workpaper: outstanding deposits, checks, adjustments
- Entity/location-aware across all Method Co bank accounts
- Mode: Autonomous for matching; Approval for clearing JEs

**Step 9: AP Workflow & Invoice Posting** (`src/tools/ap_workflow.py`)
- Ingests invoice data (vendor ID, dates, line items)
- Validates: vendor active, GL accounts exist, dimensions complete, amounts > 0
- Auto-codes recurring vendors from coding history templates
- Applies USALI account coding rules per property type
- Queues for approval with formatted summary
- Posts APBILL on confirmation
- Flags invoices over $10,000 for secondary approval
- Mode: Approval-gated

**Step 10: Payment Requests** (`src/tools/payment_request.py`)
- Queries AP aging by property and vendor
- Generates payment batch proposals grouped by bank account and entity
- Validates cash position before batch
- Presents payment batch for approval
- Executes payment run on confirmation
- Mode: Approval-gated

### Phase 3: Advanced Tools (Steps 11–14)

**Step 11: Journal Entries** (`src/tools/journal_entry.py`)
- Accepts journal symbol, date, description, line items (account, debit/credit, dimensions)
- Enforces balanced entries before submission
- Validates GL accounts, location codes, department dimensions
- Supports recurring JE templates (prepaid amort, depreciation, accruals)
- Generates reversing entries for accruals when requested
- Presents full JE detail for approval before posting
- Mode: Approval-gated

**Step 12: Balance Sheet Reconciliation** (`src/tools/bs_recon.py`)
- Queries all BS account balances for close period and entity
- Reconciles: prepaids, security deposits, fixed assets, accrued liabilities, deferred revenue, interco
- Validates supporting detail ties to GL balance
- Updates Velixo workpapers via openpyxl
- Generates consolidated recon status report
- Mode: Autonomous

**Step 13: Workpaper Management** (`src/tools/workpaper.py`)
- Reads/writes Excel workpapers using openpyxl (non-formula cells only)
- Velixo formula cells preserved; writes to data input cells only
- Tracks workpaper completion status across BS accounts
- Mode: Autonomous

**Step 14: Executive Summary** (`src/tools/exec_summary.py`)
- Synthesizes month-end results into structured narrative
- Sections: revenue vs prior/budget, EBITDA, property highlights
- Top 5 favorable/unfavorable variances with commentary
- Flags items requiring management attention
- Portfolio KPIs: RevPAR, ADR, Occupancy, F&B covers, revenue per cover
- Outputs formatted text (and optionally docx)
- Mode: Autonomous

### Phase 4: Orchestration & Testing (Steps 15–19)

**Step 15: Hook System** (`src/hooks/`)
- `approval.py` — PreToolUse hook:
  - Fires before write tools (ap_workflow, payment_request, journal_entry, bank_recon clearing)
  - Displays structured approval prompt with transaction detail
  - Configurable thresholds: auto-approve < $1K, single approval, dual > $10K
  - Returns `{"decision": "approve"}` or `{"decision": "deny", "reason": "..."}`
  - All decisions logged
- `audit.py` — PostToolUse hook:
  - Fires after every tool execution
  - Logs: timestamp, session ID, tool name, parameters, result summary, approval user, duration
  - Writes to structured JSON log file (append-only)
  - Separate error log for failures

**Step 16: Main entry point** (`src/main.py`)
- Creates MCP server with all 10 tools via `create_sdk_mcp_server`
- Configures `ClaudeSDKClient` with:
  - `mcp_servers` pointing to the sage-intacct MCP server
  - `hooks` with PreToolUse approval and PostToolUse audit
  - `system_prompt` loaded from CLAUDE.md
  - `max_turns=100`
  - `max_budget_usd=10.00`
  - `permission_mode="default"`
  - `cwd` set to project directory
- Interactive CLI loop for user commands
- Close calendar orchestration mode

**Step 17: CLAUDE.md system prompt**
- USALI chart of accounts conventions
- Property coding rules (LOCATIONID mappings for all Method Co entities)
- Dimensional requirements (location, department, class)
- Month-end close checklist with gating rules
- Approval thresholds and posting policies
- F&B vs Hotel vs Event accounting differences

**Step 18: Unit tests** (`tests/`)
- `test_intacct_client.py` — mock XML responses for auth, pagination, error handling
- `test_gl.py`, `test_ap.py`, `test_journal.py` — mock API module responses
- `test_tools.py` — mock Intacct client, test each tool's logic
- `test_hooks.py` — test approval routing and audit logging

**Step 19: Integration test & docs**
- Integration test with Sage Intacct sandbox (if available)
- Full close cycle dry run
- README with setup instructions

## Key Files Summary

```
sage-intacct-agent/
├── CLAUDE.md                     # System prompt
├── pyproject.toml
├── .env.example
├── .gitignore
├── src/
│   ├── __init__.py
│   ├── main.py                   # Entry point
│   ├── config.py                 # Settings & entity registry
│   ├── intacct/
│   │   ├── __init__.py
│   │   ├── client.py             # XML API client
│   │   ├── gl.py
│   │   ├── ap.py
│   │   ├── ar.py
│   │   ├── journal.py
│   │   ├── budget.py
│   │   ├── bank.py
│   │   └── models.py
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── gl_scrub.py
│   │   ├── gl_detail.py
│   │   ├── variance.py
│   │   ├── bank_recon.py
│   │   ├── ap_workflow.py
│   │   ├── payment_request.py
│   │   ├── journal_entry.py
│   │   ├── bs_recon.py
│   │   ├── workpaper.py
│   │   └── exec_summary.py
│   ├── workpapers/
│   │   ├── __init__.py
│   │   └── manager.py
│   └── hooks/
│       ├── __init__.py
│       ├── approval.py
│       └── audit.py
└── tests/
    ├── __init__.py
    ├── test_intacct_client.py
    ├── test_gl.py
    ├── test_ap.py
    ├── test_journal.py
    ├── test_tools.py
    └── test_hooks.py
```
