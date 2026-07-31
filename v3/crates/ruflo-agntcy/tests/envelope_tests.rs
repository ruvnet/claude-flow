//! Integration tests for `check_authorization` — the CASA deny-by-default
//! enforcement gate (ADR-380 §3).
//!
//! These mirror the bypass-attempt cases the ADR requires be tested
//! explicitly, not just translation-quality tests: denial on expiry,
//! denial when an action is in both `allow` and `deny`, denial when an
//! action is absent from `allow`, and the genuine allowed case.

use ruflo_agntcy::{check_authorization, CasaEnvelope};

fn sample_envelope() -> CasaEnvelope {
    CasaEnvelope {
        objective: "review repository security".to_string(),
        allow: vec!["repository.read".to_string(), "tests.execute".to_string()],
        deny: vec![
            "git.push".to_string(),
            "secret.export".to_string(),
            "deployment.create".to_string(),
        ],
        budget_usd: 8.0,
        expires_at: "2026-07-30T22:00:00Z".to_string(),
    }
}

#[test]
fn denied_when_envelope_has_expired() {
    let envelope = sample_envelope();
    // `now` is after `expires_at`.
    let decision = check_authorization(&envelope, "repository.read", "2026-07-30T23:00:00Z");
    assert!(!decision.allowed);
    assert!(decision.reason.to_lowercase().contains("expired"));
}

#[test]
fn denied_exactly_at_expiry_instant() {
    // `now == expires_at` must deny (strictly-before semantics), not
    // allow — an off-by-one here is a real bypass.
    let envelope = sample_envelope();
    let decision = check_authorization(&envelope, "repository.read", "2026-07-30T22:00:00Z");
    assert!(!decision.allowed);
}

#[test]
fn denied_when_action_is_in_both_allow_and_deny() {
    // Bypass attempt: an attacker-controlled compiler might try to smuggle
    // an action into `allow` while it is also present in `deny`. Deny
    // must win.
    let mut envelope = sample_envelope();
    envelope.allow.push("git.push".to_string());
    assert!(envelope.deny.contains(&"git.push".to_string()));
    assert!(envelope.allow.contains(&"git.push".to_string()));

    let decision = check_authorization(&envelope, "git.push", "2026-07-30T12:00:00Z");
    assert!(!decision.allowed);
    assert!(decision.reason.to_lowercase().contains("denied"));
}

#[test]
fn denied_when_action_not_in_allow_list() {
    // Deny-by-default: an action that is in neither list must still be
    // refused.
    let envelope = sample_envelope();
    let decision = check_authorization(&envelope, "billing.charge", "2026-07-30T12:00:00Z");
    assert!(!decision.allowed);
    assert!(decision.reason.to_lowercase().contains("not in the allow list"));
}

#[test]
fn allowed_in_the_genuine_case() {
    let envelope = sample_envelope();
    let decision = check_authorization(&envelope, "tests.execute", "2026-07-30T12:00:00Z");
    assert!(decision.allowed);
    assert!(decision.reason.contains("tests.execute"));
}

#[test]
fn denied_when_expiry_timestamp_is_malformed() {
    // Malformed input must deny-by-default, not panic or silently allow.
    let mut envelope = sample_envelope();
    envelope.expires_at = "not-a-timestamp".to_string();
    let decision = check_authorization(&envelope, "repository.read", "2026-07-30T12:00:00Z");
    assert!(!decision.allowed);
}

#[test]
fn denied_when_now_timestamp_is_malformed() {
    let envelope = sample_envelope();
    let decision = check_authorization(&envelope, "repository.read", "definitely-not-rfc3339");
    assert!(!decision.allowed);
}

#[test]
fn serde_round_trip_matches_typescript_schema_field_names() {
    // Locks the wire schema to the exact field names/shape the
    // TypeScript `CasaEnvelope` uses, so a Rust/TS drift is caught here
    // rather than at integration time.
    let json = r#"{
        "objective": "review repository security",
        "allow": ["repository.read", "tests.execute"],
        "deny": ["git.push", "secret.export", "deployment.create"],
        "budget_usd": 8,
        "expires_at": "2026-07-30T22:00:00Z"
    }"#;

    let envelope: CasaEnvelope = serde_json::from_str(json).expect("valid CasaEnvelope JSON");
    assert_eq!(envelope.objective, "review repository security");
    assert_eq!(envelope.allow, vec!["repository.read", "tests.execute"]);
    assert_eq!(
        envelope.deny,
        vec!["git.push", "secret.export", "deployment.create"]
    );
    assert_eq!(envelope.budget_usd, 8.0);
    assert_eq!(envelope.expires_at, "2026-07-30T22:00:00Z");

    let round_tripped: CasaEnvelope =
        serde_json::from_str(&serde_json::to_string(&envelope).unwrap()).unwrap();
    assert_eq!(round_tripped, envelope);
}
