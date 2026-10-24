# Property Accountant AI Agent — Implementation Plan

## Overview
Build an autonomous AI agent (Python + Claude Agent SDK) that acts as a property accountant in Sage Intacct. The agent connects to Sage Intacct via its XML Web Services API, performs accounting tasks autonomously, and updates Velixo-connected Excel workpapers via openpyxl.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Claude Agent SDK                    │
│  ┌───────────────────────────────────────────┐  │
│  │  System Prompt (CLAUDE.md)                │  │
│  │  - Accounting rules & policies            │  │
│  │  - Property chart of accounts             │  │
│  │  - Approval thresholds                    │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
│  ┌─────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Tools   │  │  Hooks   │  │  MCP Server   │  │
│  │ (6 caps)│  │ Approval │  │  (sage-intacct)│  │
│  │         │  │ Audit    │  │               │  │
│  └────┬────┘  └────┬─────┘  └───────┬───────┘  │
└───────┼────────────┼────────────────┼───────────┘
        │            │                │
        ▼            ▼                ▼
┌──────────────┐ ┌────────┐  ┌──────────────────┐
│ Excel/Velixo │ │ Audit  │  │ Sage Intacct     │
│ Workpapers   │ │ Log    │  │ XML API          │
│ (openpyxl)   │ │        │  │ (GLBATCH, APBILL │
└──────────────┘ └────────┘  │  GLDETAIL, etc.) │
                              └──────────────────┘
```

## Project Structure

```
sage-intacct-agent/
├── CLAUDE.md                     # Agent business rules & accounting policies
├── pyproject.toml                # Dependencies & project config
├── .env.example                  # Credential template
├── src/
│   ├── __init__.py
│   ├── main.py                   # Entry point — agent orchestration
│   ├── config.py                 # Env vars, settings, thresholds
│   ├── intacct/                  # Sage Intacct API client layer
│   │   ├── __init__.py
│   │   ├── client.py             # Session auth, XML request/response, pagination
│   │   ├── gl.py                 # GL queries: GLDETAIL, GLACCOUNT, balances
│   │   ├── ap.py                 # AP: APBILL create/query
│   │   ├── journal.py            # Journal entries: GLBATCH/GLENTRY create
│   │   ├── budget.py             # GLBUDGETHEADER/GLBUDGETITEM queries
│   │   ├── bank.py               # CHECKINGACCOUNT, reconcile_bank
│   │   └── models.py             # Dataclasses for API objects
│   ├── tools/                    # Agent tools (exposed via MCP server)
│   │   ├── __init__.py
│   │   ├── gl_scrub.py           # Tool: scrub GL for anomalies
│   │   ├── variance.py           # Tool: actual vs budget analysis
│   │   ├── invoice.py            # Tool: post AP bills
│   │   ├── journal_entry.py      # Tool: create journal entries
│   │   ├── bank_recon.py         # Tool: bank reconciliation
│   │   └── bs_recon.py           # Tool: balance sheet recon + workpapers
│   ├── workpapers/               # Excel workpaper management
│   │   ├── __init__.py
│   │   └── manager.py            # Read/update Velixo workpapers via openpyxl
│   └── hooks/                    # Agent hooks
│       ├── __init__.py
│       ├── approval.py           # Human-in-the-loop for financial postings
│       └── audit.py              # Audit trail logging
└── tests/
    ├── __init__.py
    ├── test_intacct_client.py
    └── test_tools.py
```

## Prerequisites (User Must Complete)

Before building, you need to set up Sage Intacct API access:

1. **Obtain a Web Services Developer License** from Sage (provides Sender ID + Sender Password)
2. **Enable Web Services subscription**: Company > Admin > Subscriptions
3. **Authorize Sender ID**: Company > Setup > Company > Security > Web Services authorizations
4. **Create a Web Services User**: Company > Web Services Users — with roles granting access to GL, AP, Cash Management, and Budgets
5. **Note your Company ID** (visible in Sage Intacct URL or company info)

## Implementation Steps

### Phase 1: Foundation (Steps 1-3)

#### Step 1 — Project scaffolding & dependencies
- Create `pyproject.toml` with dependencies:
  - `claude-agent-sdk` — agent orchestration
  - `requests` + `lxml` — Sage Intacct XML API calls
  - `openpyxl` — Excel workpaper read/write
  - `python-dotenv` — credential management
  - `pydantic` — data validation for API models
- Create `.env.example` with placeholder credentials
- Create `config.py` to load and validate settings

#### Step 2 — Sage Intacct API client (`src/intacct/client.py`)
- Implement session-based authentication (getAPISession)
- Build XML request builder (control block, operation block, function calls)
- Build XML response parser with error handling
- Implement pagination (readMore)
- Implement rate limiting with exponential backoff for 429 errors
- Session auto-renewal on 30-minute expiry

#### Step 3 — API module implementations
- `gl.py` — query GLDETAIL, GLACCOUNT, get_accountbalances, get_accountbalancesbydimensions
- `ap.py` — create/query APBILL
- `journal.py` — create GLBATCH with GLENTRY lines (enforce balanced entries)
- `budget.py` — query GLBUDGETHEADER/GLBUDGETITEM
- `bank.py` — query CHECKINGACCOUNT, call reconcile_bank
- `models.py` — Pydantic models for all API objects

### Phase 2: Agent Tools (Steps 4-9)

Each tool is a function exposed to the Claude agent via MCP. The agent decides which tools to call based on the user's request.

#### Step 4 — GL Scrubbing tool (`tools/gl_scrub.py`)
- Query GLDETAIL for a specified period/property (LOCATIONID)
- Flag anomalies:
  - Duplicate entries (same amount, date, account, description)
  - Entries with missing descriptions
  - Unusual amounts (statistical outlier detection)
  - Entries posted to suspense/clearing accounts still open
  - Entries posted outside the reporting period
- Return structured report of flagged items with severity

#### Step 5 — Budget vs Actual Variance tool (`tools/variance.py`)
- Call `get_accountbalancesbydimensions` with contentselection="Actual and Budget"
- Accept budget ID, period, and property (location) as parameters
- Calculate variance amounts and percentages per account
- Flag material variances (configurable threshold, e.g., >10% or >$5,000)
- Return structured variance report grouped by account category

#### Step 6 — Invoice/Bill Posting tool (`tools/invoice.py`)
- Accept vendor ID, invoice date, due date, line items (account, amount, description, dimensions)
- Validate: vendor exists, accounts exist, dates are reasonable, amounts are positive
- Build APBILL XML and post via API
- **Requires human approval** (via PreToolUse hook) before posting
- Return confirmation with bill record number

#### Step 7 — Journal Entry tool (`tools/journal_entry.py`)
- Accept journal symbol, date, title, and line items (account, debit/credit, description, dimensions)
- Validate: entry balances (total debits = total credits), accounts exist
- Build GLBATCH/GLENTRY XML and post
- **Requires human approval** before posting
- Return confirmation with batch record number

#### Step 8 — Bank Reconciliation tool (`tools/bank_recon.py`)
- Query bank account transactions from Sage Intacct
- Accept bank statement data (CSV upload or manual entry)
- Match transactions: exact amount match, date proximity, check number match
- Identify outstanding deposits and checks
- Flag unmatched items for review
- Return reconciliation summary with outstanding items list

#### Step 9 — Balance Sheet Reconciliation tool (`tools/bs_recon.py`)
- Query account balances for balance sheet accounts (assets, liabilities, equity)
- Read existing Velixo workpapers using openpyxl:
  - Locate the reconciliation sheet within the workbook
  - Read current reconciliation data (prior month balances, supporting detail)
- Update non-formula cells in workpapers:
  - Current period ending balance (from Sage Intacct query)
  - Reconciling items and descriptions
  - Preparer name and date
  - Status (reconciled/unreconciled)
- **Important**: Cannot trigger Velixo formula refresh — update data cells only; user must open file and refresh Velixo manually
- Return reconciliation status report

### Phase 3: Agent Orchestration (Steps 10-12)

#### Step 10 — Approval hooks (`hooks/approval.py`)
- PreToolUse hook for `invoice` and `journal_entry` tools
- Display transaction details to user in terminal
- Require explicit "yes" confirmation before proceeding
- Configurable approval thresholds (e.g., auto-approve under $500)
- Log approval decisions

#### Step 11 — Audit logging (`hooks/audit.py`)
- PostToolUse hook for ALL tools
- Log: timestamp, tool name, parameters, result summary, user who approved
- Write to structured JSON log file
- Include session ID for traceability

#### Step 12 — Agent main entry point (`main.py`)
- Create MCP server with all 6 tools registered
- Configure ClaudeAgentOptions:
  - Auto-approve read-only tools (gl_scrub, variance, bank_recon queries)
  - Require approval for write tools (invoice, journal_entry)
  - Set max_turns=50, max_budget_usd=10.00
  - Register approval and audit hooks
- Write CLAUDE.md with:
  - Property accounting domain knowledge
  - Chart of accounts conventions
  - Posting rules and policies
  - Dimensional coding requirements (locations = properties)
- Interactive CLI loop for user to issue commands

### Phase 4: Testing & Polish (Step 13)

#### Step 13 — Testing and documentation
- Unit tests for API client (mock XML responses)
- Unit tests for each tool (mock API calls)
- Integration test with Sage Intacct sandbox (if available)
- README with setup instructions

## Key Design Decisions

1. **XML API over REST API**: The XML API has more complete coverage of GL, AP, and budget objects today. The REST API is newer but missing some objects we need.

2. **sageintacctsdk vs custom client**: We'll build a custom XML client rather than using the Fylein SDK because we need access to objects the SDK doesn't cover (GLBUDGETHEADER, get_accountbalancesbydimensions, reconcile_bank). The custom client gives us full control.

3. **Velixo workpaper strategy**: Update non-formula cells (balances, notes, status) via openpyxl. User manually refreshes Velixo formulas by opening the file. We cannot programmatically trigger Velixo refresh since it's an Excel add-in that runs in Excel's process.

4. **Human-in-the-loop**: All write operations (posting bills, journal entries) require explicit user approval. Read-only operations (GL scrub, variance analysis, reconciliation queries) run autonomously.

5. **Multi-entity support**: The client supports passing `locationid` at login for multi-entity companies, and all tools accept property/location as a parameter for dimensional filtering.

## Safety Controls

- **Financial postings**: Always require human approval via terminal prompt
- **Balanced entries**: Journal entries are validated for balanced debits/credits before submission
- **Audit trail**: Every tool execution is logged with full parameters and results
- **Budget limits**: Agent has a per-session cost cap ($10 default)
- **Turn limits**: Agent limited to 50 turns per session to prevent runaway execution
- **No destructive operations**: Agent can create but never delete records in Sage Intacct
- **Credential isolation**: All secrets in .env file, never hardcoded
