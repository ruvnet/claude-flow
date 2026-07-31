//! CASA (Continuous Agentic Semantic Authorization) intent-scoped
//! authorization envelope + enforcement gate — ADR-380 §3.
//!
//! MetaHarness (companion ADR-240 §4) compiles a user's objective into a
//! bounded authority envelope. This module is where RuFlo *enforces* that
//! envelope, matching the TypeScript `CasaEnvelope` schema field-for-field
//! and the same deny-by-default enforcement algorithm as the TypeScript
//! `enforce.ts` reference: an expiry check, then a deny-list check, then
//! an allow-list check.
//!
//! The single non-negotiable design constraint from ADR-380 §3, restated
//! here because it is load-bearing: *enforcement* must never ask a model
//! whether an action is permitted at invocation time. [`check_authorization`]
//! is a pure function — no async, no I/O, no network call, no model call —
//! that checks a bounded schema (explicit resource strings, explicit deny
//! list, numeric budget, expiry timestamp) with deterministic code.

use serde::{Deserialize, Serialize};

/// A CASA authority envelope, as compiled by MetaHarness from a user's
/// objective (ADR-240 §4) and enforced by RuFlo at every tool invocation
/// (ADR-380 §3).
///
/// Mirrors the TypeScript `CasaEnvelope` schema exactly:
///
/// ```json
/// {
///   "objective": "review repository security",
///   "allow": ["repository.read", "tests.execute"],
///   "deny": ["git.push", "secret.export", "deployment.create"],
///   "budget_usd": 8,
///   "expires_at": "2026-07-30T22:00:00Z"
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CasaEnvelope {
    /// Human-readable description of what this envelope was compiled to
    /// authorize (informational only — not part of the enforcement logic).
    pub objective: String,
    /// Explicit list of resource strings this envelope authorizes.
    pub allow: Vec<String>,
    /// Explicit list of resource strings this envelope forbids. Wins over
    /// `allow` when a resource string appears in both (see
    /// [`check_authorization`]).
    pub deny: Vec<String>,
    /// The USD budget attached to this envelope. Enforced by Meta LLM's
    /// existing cost-governance path (ADR-380 §3) — not by this crate;
    /// carried here only because it is part of the envelope schema.
    pub budget_usd: f64,
    /// RFC3339 timestamp (e.g. `"2026-07-30T22:00:00Z"`) after which this
    /// envelope is no longer valid.
    pub expires_at: String,
}

/// The result of a [`check_authorization`] call.
///
/// Deny-by-default: `allowed` is `true` only if the requested action
/// survives every gate in [`check_authorization`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuthDecision {
    pub allowed: bool,
    pub reason: String,
}

impl AuthDecision {
    fn denied(reason: impl Into<String>) -> Self {
        Self {
            allowed: false,
            reason: reason.into(),
        }
    }

    fn allowed(reason: impl Into<String>) -> Self {
        Self {
            allowed: true,
            reason: reason.into(),
        }
    }
}

/// Deterministic, pure CASA enforcement gate (ADR-380 §3).
///
/// Gate order — every gate must pass for the action to be authorized:
///
/// 1. **Expiry** — `now` must be strictly before `envelope.expires_at`.
///    An unparseable timestamp on either side is treated as expired
///    (deny-by-default extends to malformed input, not just late input).
/// 2. **Deny-list** — if `requested_action` appears in `envelope.deny`,
///    the action is refused, *even if it also appears in `envelope.allow`*.
///    Deny wins ties — this is the bypass case ADR-380 §3 calls out
///    explicitly as a required test.
/// 3. **Allow-list** — `requested_action` must appear in `envelope.allow`
///    to be authorized. Anything not explicitly allowed is denied.
///
/// This function performs no I/O and calls no model.
pub fn check_authorization(
    envelope: &CasaEnvelope,
    requested_action: &str,
    now: &str,
) -> AuthDecision {
    // Gate 1: expiry.
    let expires_at_secs = parse_rfc3339_to_epoch_seconds(&envelope.expires_at);
    let now_secs = parse_rfc3339_to_epoch_seconds(now);

    match (now_secs, expires_at_secs) {
        (Some(now_secs), Some(expires_at_secs)) => {
            if now_secs >= expires_at_secs {
                return AuthDecision::denied(format!(
                    "envelope expired at {} (now: {})",
                    envelope.expires_at, now
                ));
            }
        }
        _ => {
            return AuthDecision::denied(
                "could not parse expires_at/now as RFC3339 timestamps — denying by default",
            );
        }
    }

    // Gate 2: deny-list. Deny wins even if the action is also in `allow`.
    if envelope.deny.iter().any(|d| d == requested_action) {
        return AuthDecision::denied(format!(
            "action '{requested_action}' is explicitly denied"
        ));
    }

    // Gate 3: allow-list. Deny by default — must be explicitly present.
    if !envelope.allow.iter().any(|a| a == requested_action) {
        return AuthDecision::denied(format!(
            "action '{requested_action}' is not in the allow list"
        ));
    }

    AuthDecision::allowed(format!("action '{requested_action}' authorized"))
}

/// Parses a subset of RFC3339 (`YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)`)
/// into whole seconds since the Unix epoch (UTC).
///
/// Implemented from scratch (no `chrono`/`time` dependency — this crate's
/// only dependencies are `serde`/`serde_json`, per ADR-380 §6) using the
/// well-known `days_from_civil` algorithm. Returns `None` on any malformed
/// input, including a timestamp with no explicit timezone — `check_authorization`
/// treats an unparseable timestamp as expired (deny-by-default).
fn parse_rfc3339_to_epoch_seconds(s: &str) -> Option<i64> {
    let s = s.trim();
    let t_pos = s.find(['T', 't'])?;
    let (date_part, rest) = s.split_at(t_pos);
    let time_and_offset = &rest[1..];

    let date_fields: Vec<&str> = date_part.split('-').collect();
    if date_fields.len() != 3 {
        return None;
    }
    let year: i64 = date_fields[0].parse().ok()?;
    let month: i64 = date_fields[1].parse().ok()?;
    let day: i64 = date_fields[2].parse().ok()?;

    let (time_part, offset_seconds) = if let Some(z_pos) = time_and_offset.find(['Z', 'z']) {
        (&time_and_offset[..z_pos], 0i64)
    } else if let Some(sign_pos) = time_and_offset.rfind(['+', '-']) {
        let sign = if time_and_offset.as_bytes()[sign_pos] == b'-' {
            -1
        } else {
            1
        };
        let offset_str = &time_and_offset[sign_pos + 1..];
        let offset_fields: Vec<&str> = offset_str.split(':').collect();
        if offset_fields.len() != 2 {
            return None;
        }
        let offset_hours: i64 = offset_fields[0].parse().ok()?;
        let offset_minutes: i64 = offset_fields[1].parse().ok()?;
        (
            &time_and_offset[..sign_pos],
            sign * (offset_hours * 3600 + offset_minutes * 60),
        )
    } else {
        // No explicit timezone — reject rather than guess.
        return None;
    };

    let time_fields: Vec<&str> = time_part.split(':').collect();
    if time_fields.len() != 3 {
        return None;
    }
    let hour: i64 = time_fields[0].parse().ok()?;
    let minute: i64 = time_fields[1].parse().ok()?;
    // Seconds may carry a fractional part (e.g. "05.250"); we only need
    // whole-second precision for expiry comparisons.
    let second_whole_str = time_fields[2].split('.').next()?;
    let second: i64 = second_whole_str.parse().ok()?;

    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..24).contains(&hour)
        || !(0..60).contains(&minute)
        || !(0..=60).contains(&second)
    {
        return None;
    }

    let days = days_from_civil(year, month, day)?;
    Some(days * 86_400 + hour * 3600 + minute * 60 + second - offset_seconds)
}

/// Howard Hinnant's `days_from_civil` algorithm: converts a
/// proleptic-Gregorian (year, month, day) into a day count relative to
/// 1970-01-01. See <http://howardhinnant.github.io/date_algorithms.html>.
fn days_from_civil(y: i64, m: i64, d: i64) -> Option<i64> {
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (m + 9) % 12; // [0, 11]
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    Some(era * 146_097 + doe - 719_468)
}

#[cfg(test)]
mod parser_tests {
    use super::parse_rfc3339_to_epoch_seconds;

    #[test]
    fn parses_unix_epoch() {
        assert_eq!(
            parse_rfc3339_to_epoch_seconds("1970-01-01T00:00:00Z"),
            Some(0)
        );
    }

    #[test]
    fn parses_known_timestamp() {
        // 2026-07-30T22:00:00Z — sanity-checked against `date -u -d`.
        let secs = parse_rfc3339_to_epoch_seconds("2026-07-30T22:00:00Z").unwrap();
        assert_eq!(secs, 1785448800);
    }

    #[test]
    fn respects_positive_offset() {
        // Same instant as 2026-07-30T22:00:00Z, expressed at +02:00.
        let utc = parse_rfc3339_to_epoch_seconds("2026-07-30T22:00:00Z").unwrap();
        let offset = parse_rfc3339_to_epoch_seconds("2026-07-31T00:00:00+02:00").unwrap();
        assert_eq!(utc, offset);
    }

    #[test]
    fn respects_negative_offset() {
        let utc = parse_rfc3339_to_epoch_seconds("2026-07-30T22:00:00Z").unwrap();
        let offset = parse_rfc3339_to_epoch_seconds("2026-07-30T17:00:00-05:00").unwrap();
        assert_eq!(utc, offset);
    }

    #[test]
    fn parses_fractional_seconds() {
        assert_eq!(
            parse_rfc3339_to_epoch_seconds("2026-07-30T22:00:00.250Z"),
            parse_rfc3339_to_epoch_seconds("2026-07-30T22:00:00Z")
        );
    }

    #[test]
    fn rejects_missing_timezone() {
        assert_eq!(parse_rfc3339_to_epoch_seconds("2026-07-30T22:00:00"), None);
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_rfc3339_to_epoch_seconds("not-a-timestamp"), None);
        assert_eq!(parse_rfc3339_to_epoch_seconds(""), None);
    }
}
