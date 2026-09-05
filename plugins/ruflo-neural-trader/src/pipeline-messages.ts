/**
 * Pipeline message schemas — ADR-126 Phase 5
 *
 * The four neural-trader agents (`market-analyst`, `trading-strategist`,
 * `risk-analyst`, `backtest-engineer`) coordinate as a typed SendMessage
 * pipeline, NOT as parallel role descriptions:
 *
 *   market-analyst       — (RegimeVerdict)   ─→ trading-strategist
 *   trading-strategist   — (SignalProposal[]) ─→ risk-analyst   ◄── BLOCKING
 *   risk-analyst         — (RiskDecision)    ─→ trading-strategist
 *                                              └─→ execute-or-halt
 *
 * `trading-strategist` MUST NOT call the live broker (`--broker <name>`)
 * without a `RiskDecision` with `decision: 'approved'` from `risk-analyst`
 * in the current SendMessage trace. This is the structural risk-gate per
 * ADR-126 — see `trading-strategist.md` for the in-agent enforcement.
 *
 * `backtest-engineer` is an orthogonal lane — it produces signed-artifact
 * promotion candidates (ADR-126 Phase 4) and does NOT participate in the
 * live execution pipeline. It runs in parallel during research, but the
 * hot path of live trading never depends on it.
 *
 * These types are documentation + a future programmatic dispatcher
 * contract. SendMessage payloads today are JSON literals; tomorrow a
 * typed dispatcher can import + validate against this schema.
 *
 * Refs:
 *   - ADR-126 Phase 5      — SendMessage pipeline plan
 *   - CLAUDE.md            — SendMessage protocol + named-agent rules
 *   - SKILL.md files for each agent — the actual call sites
 */

/* ---------------------------------------------------------------------- */
/* market-analyst → trading-strategist                                    */
/* ---------------------------------------------------------------------- */

/**
 * Regime verdict — produced by `market-analyst`, consumed by
 * `trading-strategist`. Identifies the current market regime so the
 * strategist can pick an appropriate strategy family before generating
 * signals.
 */
export interface RegimeVerdict {
  /** Message schema discriminator. */
  type: 'regime-verdict/v1';
  /** Originating agent name (must be `market-analyst` for valid messages). */
  from: 'market-analyst';
  /** ISO timestamp when the verdict was produced. */
  timestamp: string;
  /** The classified regime — one of the six market-analyst categories. */
  regime:
    | 'bull-trending'
    | 'bear-trending'
    | 'ranging'
    | 'high-volatility'
    | 'low-volatility'
    | 'transitioning';
  /** The ticker(s) the verdict applies to. */
  symbols: string[];
  /** Confidence score in [0,1]. */
  confidence: number;
  /** Optional supporting indicators (ADX, RSI, MACD, VIX, ...). */
  indicators?: Record<string, number>;
}

/* ---------------------------------------------------------------------- */
/* trading-strategist → risk-analyst                                      */
/* ---------------------------------------------------------------------- */

/**
 * Signal proposal — produced by `trading-strategist`, consumed by
 * `risk-analyst`. Represents a proposed live-trade action that requires
 * risk approval before execution.
 */
export interface SignalProposal {
  /** Message schema discriminator. */
  type: 'signal-proposal/v1';
  /** Originating agent name. */
  from: 'trading-strategist';
  /** Unique signal id — used to correlate the RiskDecision response. */
  signalId: string;
  /** ISO timestamp when the proposal was created. */
  timestamp: string;
  /** Symbol to trade. */
  symbol: string;
  /** Direction. */
  side: 'long' | 'short' | 'close';
  /** Strategy that produced the proposal. */
  strategyId: string;
  /** Position size as % of portfolio (e.g. 0.02 = 2%). */
  sizePct: number;
  /** Z-score / confidence score driving the entry. */
  confidence: number;
  /** Reference to the upstream regime that motivated the trade. */
  regime?: RegimeVerdict['regime'];
  /** Optional metadata — model attribution, indicator snapshot, etc. */
  metadata?: Record<string, unknown>;
}

/* ---------------------------------------------------------------------- */
/* risk-analyst → trading-strategist                                      */
/* ---------------------------------------------------------------------- */

/**
 * Risk decision — produced by `risk-analyst`, consumed by
 * `trading-strategist`. The BLOCKING GATE: `trading-strategist` MUST NOT
 * execute a live broker call without a corresponding `RiskDecision` with
 * `decision: 'approved'` for the proposal's `signalId`.
 *
 * Rejection reasons map to the risk-analyst's circuit-breaker / sizing
 * checks (VaR, CVaR, concentration, correlation, drawdown).
 */
export interface RiskDecision {
  /** Message schema discriminator. */
  type: 'risk-decision/v1';
  /** Originating agent name. */
  from: 'risk-analyst';
  /** The signal id this decision responds to (correlates with SignalProposal.signalId). */
  signalId: string;
  /** ISO timestamp when the decision was made. */
  timestamp: string;
  /** Decision — approved means the strategist may call the broker. */
  decision: 'approved' | 'rejected';
  /** Optional size adjustment — risk-analyst may shrink the proposal. */
  adjustedSizePct?: number;
  /** Human-readable reasons (empty array on approval). */
  reasons: string[];
  /** Risk metrics computed for the decision (VaR/CVaR snapshots, etc.). */
  metrics?: {
    var95?: number;
    cvar95?: number;
    portfolioCorrelation?: number;
    concentrationPct?: number;
    drawdownPct?: number;
  };
}

/* ---------------------------------------------------------------------- */
/* Union for typed dispatchers                                            */
/* ---------------------------------------------------------------------- */

/**
 * Discriminated union of every valid SendMessage payload in the
 * neural-trader pipeline. A future programmatic dispatcher can switch
 * on `type` to validate + route incoming messages.
 */
export type PipelineMessage = RegimeVerdict | SignalProposal | RiskDecision;
