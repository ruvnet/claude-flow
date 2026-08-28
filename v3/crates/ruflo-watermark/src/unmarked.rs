//! Authorized un-marked generation — the *legitimate* way to produce
//! un-watermarked output of your own model, without a laundering tool.
//!
//! ## Why this is not a watermark remover
//!
//! If you hold the key, you never need to *strip* a finished text — you either
//! don't apply the mark, or you regenerate from the same inputs with marking
//! off. Stripping the signal out of finished text is only necessary for content
//! you did NOT generate (someone else's mark), which is exactly the laundering
//! case. So this module **only generates**. It has no function that accepts an
//! existing token sequence and removes its watermark; it is therefore
//! structurally impossible to point at third-party marked text. Un-marked
//! generation here is plain categorical sampling — the watermark key is never
//! used, so the output carries no mark by construction.
//!
//! ## Governance, enforced by construction
//!
//! Exemption from *watermarking* is never exemption from *disclosure*. This path
//! makes that hard to violate:
//!
//! - **Authorization is unforgeable.** Un-marked generation requires an
//!   [`AuthorizationGrant`] minted by the compliance key-custodian
//!   ([`AuthorizationKey`], distinct from the watermark key) and bound to a
//!   specific request + documented [`ExemptionReason`] + timestamp via a MAC.
//!   A forged or mismatched grant is denied (and the denial is audited).
//! - **Disclosure is mandatory to finish.** An [`UnmarkedSession`] can only be
//!   completed by supplying a [`ProvenanceDisclosure`] (a C2PA credential, an
//!   explicit AI label, or an internal provenance-log id). You cannot cleanly
//!   end an un-marked generation without declaring how it stays disclosed.
//! - **Silence is loud.** A session dropped without `finish` commits an
//!   `AbandonedUndisclosed` audit record — an un-marked generation that never
//!   declared disclosure is recorded as a compliance gap, never forgotten.
//!
//! Whether a given case is genuinely exempt under the EU AI Act is a legal
//! determination, not an engineering one. This builds the switch and its audit;
//! the policy of when to flip it belongs to compliance.

use crate::hash::mix64;
use crate::rng::sample_index;

/// Secret authorization key held by the compliance / key-custodian authority.
/// Gates WHETHER un-marked generation is permitted — distinct from the watermark
/// key (which governs how text is marked).
#[derive(Clone, Copy)]
pub struct AuthorizationKey(u64);

impl AuthorizationKey {
    pub fn from_bytes(material: &[u8]) -> Self {
        let mut acc = 0xC0FF_EE00_1234_5678u64;
        for &b in material {
            acc = mix64(acc ^ b as u64);
        }
        AuthorizationKey(mix64(acc))
    }
}

/// Errors from the governance path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PolicyError {
    /// The exemption reason was empty — every exemption must be documented.
    EmptyReason,
    /// The authorization grant did not verify against the authority key.
    Unauthorized,
    /// A provenance disclosure string was empty.
    EmptyDisclosure,
}

/// A documented, non-empty reason a generation is exempt from watermarking.
#[derive(Clone, Debug)]
pub struct ExemptionReason(String);

impl ExemptionReason {
    pub fn new(reason: impl Into<String>) -> Result<Self, PolicyError> {
        let r = reason.into();
        if r.trim().is_empty() {
            Err(PolicyError::EmptyReason)
        } else {
            Ok(ExemptionReason(r))
        }
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    fn hash(&self) -> u64 {
        let mut acc = 0x1234_5678_9ABC_DEF0u64;
        for &b in self.0.as_bytes() {
            acc = mix64(acc ^ b as u64);
        }
        acc
    }
}

/// An unforgeable authorization to un-mark exactly one request. Minted by the
/// authority; bound to `(request_id, reason, timestamp)` by a MAC.
#[derive(Clone, Copy, Debug)]
pub struct AuthorizationGrant {
    request_id: u64,
    timestamp: u64,
    reason_hash: u64,
    mac: u64,
}

/// How an un-marked output stays disclosed. Un-marking is not un-disclosing.
#[derive(Clone, Debug)]
pub enum ProvenanceDisclosure {
    /// A C2PA content-credential id attached to the output file's metadata.
    C2pa(String),
    /// An explicit AI-disclosure label surfaced to the reader.
    Label(String),
    /// An internal provenance-log record id.
    InternalLog(String),
}

impl ProvenanceDisclosure {
    fn describe(&self) -> Result<String, PolicyError> {
        let (kind, v) = match self {
            ProvenanceDisclosure::C2pa(v) => ("c2pa", v),
            ProvenanceDisclosure::Label(v) => ("label", v),
            ProvenanceDisclosure::InternalLog(v) => ("internal-log", v),
        };
        if v.trim().is_empty() {
            Err(PolicyError::EmptyDisclosure)
        } else {
            Ok(format!("{kind}:{v}"))
        }
    }
}

/// The outcome recorded for an un-marked generation attempt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuditOutcome {
    /// Completed with a declared disclosure channel — compliant.
    Completed { disclosure: String },
    /// The session ended WITHOUT declaring disclosure — a compliance gap.
    AbandonedUndisclosed,
    /// Authorization failed; no generation occurred.
    Denied,
}

/// One immutable audit record. The durable evidence that an un-marked generation
/// happened, why, and whether it was disclosed.
#[derive(Clone, Debug)]
pub struct AuditRecord {
    pub request_id: u64,
    pub timestamp: u64,
    pub reason: String,
    pub outcome: AuditOutcome,
}

/// Where audit records go. A real deployment writes to an append-only store; the
/// in-memory sink is for tests / embedding.
pub trait AuditSink {
    fn record(&mut self, record: AuditRecord);
}

/// In-memory audit sink.
#[derive(Default)]
pub struct MemoryAuditSink {
    pub records: Vec<AuditRecord>,
}

impl AuditSink for MemoryAuditSink {
    fn record(&mut self, record: AuditRecord) {
        self.records.push(record);
    }
}

#[inline]
fn compute_mac(auth: AuthorizationKey, request_id: u64, reason_hash: u64, timestamp: u64) -> u64 {
    mix64(auth.0 ^ mix64(request_id) ^ mix64(reason_hash) ^ mix64(timestamp).rotate_left(17))
}

/// The governance policy. Holds the authority key and mints / verifies grants.
#[derive(Clone, Copy)]
pub struct UnmarkedGenerationPolicy {
    auth: AuthorizationKey,
}

impl UnmarkedGenerationPolicy {
    pub fn new(auth: AuthorizationKey) -> Self {
        UnmarkedGenerationPolicy { auth }
    }

    /// Authority action: mint a grant for one request. Unforgeable without the
    /// authority key. Binds the grant to this exact reason, request, and time.
    pub fn authorize(
        &self,
        request_id: u64,
        reason: &ExemptionReason,
        timestamp: u64,
    ) -> AuthorizationGrant {
        let reason_hash = reason.hash();
        AuthorizationGrant {
            request_id,
            timestamp,
            reason_hash,
            mac: compute_mac(self.auth, request_id, reason_hash, timestamp),
        }
    }

    /// Begin an un-marked session iff `grant` verifies for this `(request_id,
    /// reason, timestamp)`. On failure, a `Denied` audit record is written and
    /// no session is returned.
    pub fn begin<'s, S: AuditSink>(
        &self,
        grant: &AuthorizationGrant,
        request_id: u64,
        reason: &ExemptionReason,
        timestamp: u64,
        sink: &'s mut S,
    ) -> Result<UnmarkedSession<'s, S>, PolicyError> {
        let reason_hash = reason.hash();
        let expected = compute_mac(self.auth, request_id, reason_hash, timestamp);
        let ok = grant.mac == expected
            && grant.request_id == request_id
            && grant.reason_hash == reason_hash
            && grant.timestamp == timestamp;
        if !ok {
            sink.record(AuditRecord {
                request_id,
                timestamp,
                reason: reason.as_str().to_string(),
                outcome: AuditOutcome::Denied,
            });
            return Err(PolicyError::Unauthorized);
        }
        Ok(UnmarkedSession {
            sink,
            request_id,
            timestamp,
            reason: reason.as_str().to_string(),
            // Un-marked sampling seed. NOTE: the watermark key is deliberately
            // absent — this is plain sampling, so the output carries no mark. A
            // production deployment supplies real entropy here; determinism keeps
            // the crate testable and is irrelevant to the un-marked property.
            seed: mix64(request_id ^ timestamp.rotate_left(31)),
            draw: 0,
            done: false,
        })
    }
}

/// An authorized, in-progress un-marked generation. Produces un-marked tokens via
/// plain sampling (no watermark key). Must be completed with [`Self::finish`]
/// (declaring disclosure) or its drop commits an `AbandonedUndisclosed` record.
pub struct UnmarkedSession<'s, S: AuditSink> {
    sink: &'s mut S,
    request_id: u64,
    timestamp: u64,
    reason: String,
    seed: u64,
    draw: u32,
    done: bool,
}

impl<'s, S: AuditSink> UnmarkedSession<'s, S> {
    /// Emit one un-marked token: a plain categorical draw from `probs`, with the
    /// watermark key uninvolved. Returns an index into `probs`.
    pub fn step(&mut self, probs: &[f32]) -> usize {
        let idx = sample_index(probs, self.seed, self.draw);
        self.draw = self.draw.wrapping_add(1);
        idx
    }

    /// Complete the session by declaring how the output stays disclosed. Commits
    /// a `Completed` audit record. Consuming the session is what makes disclosure
    /// mandatory: you cannot cleanly finish without it.
    pub fn finish(mut self, disclosure: ProvenanceDisclosure) -> Result<AuditRecord, PolicyError> {
        let described = disclosure.describe()?;
        let rec = AuditRecord {
            request_id: self.request_id,
            timestamp: self.timestamp,
            reason: self.reason.clone(),
            outcome: AuditOutcome::Completed { disclosure: described },
        };
        self.sink.record(rec.clone());
        self.done = true;
        Ok(rec)
    }
}

impl<'s, S: AuditSink> Drop for UnmarkedSession<'s, S> {
    fn drop(&mut self) {
        if !self.done {
            // Ended without declaring disclosure — record the compliance gap.
            self.sink.record(AuditRecord {
                request_id: self.request_id,
                timestamp: self.timestamp,
                reason: self.reason.clone(),
                outcome: AuditOutcome::AbandonedUndisclosed,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::WatermarkConfig;
    use crate::detect::detect_gumbel;
    use crate::hash::WatermarkKey;

    fn setup() -> (UnmarkedGenerationPolicy, ExemptionReason) {
        let policy = UnmarkedGenerationPolicy::new(AuthorizationKey::from_bytes(b"compliance-key"));
        let reason = ExemptionReason::new("internal eval corpus, not customer-facing").unwrap();
        (policy, reason)
    }

    #[test]
    fn empty_reason_rejected() {
        assert_eq!(ExemptionReason::new("   ").unwrap_err(), PolicyError::EmptyReason);
    }

    #[test]
    fn output_is_genuinely_unmarked() {
        // The point: an authorized un-marked session's output carries NO
        // watermark under the watermark key (plain sampling never used it).
        let (policy, reason) = setup();
        let mut sink = MemoryAuditSink::default();
        let grant = policy.authorize(42, &reason, 1000);
        let vocab = 128usize;
        let probs = vec![1.0f32 / vocab as f32; vocab];
        let mut session = policy.begin(&grant, 42, &reason, 1000, &mut sink).unwrap();
        let out: Vec<u32> = (0..600).map(|_| session.step(&probs) as u32).collect();
        session.finish(ProvenanceDisclosure::C2pa("cred-abc123".into())).unwrap();

        // Score it under a watermark key — must NOT be flagged (it's un-marked).
        let cfg = WatermarkConfig::new(WatermarkKey::from_bytes(b"any-key")).with_layers(1);
        let r = detect_gumbel(&out, cfg);
        assert!(!r.is_watermarked(1e-3), "un-marked output was flagged as watermarked: z={}", r.z_score);
        // And the audit shows a compliant, disclosed completion.
        assert_eq!(sink.records.len(), 1);
        match &sink.records[0].outcome {
            AuditOutcome::Completed { disclosure } => assert!(disclosure.starts_with("c2pa:")),
            o => panic!("expected Completed, got {o:?}"),
        }
    }

    #[test]
    fn forged_grant_is_denied_and_audited() {
        let (policy, reason) = setup();
        let mut sink = MemoryAuditSink::default();
        // A grant minted under a DIFFERENT authority key must not verify.
        let rogue = UnmarkedGenerationPolicy::new(AuthorizationKey::from_bytes(b"not-the-authority"));
        let forged = rogue.authorize(7, &reason, 500);
        let err = policy.begin(&forged, 7, &reason, 500, &mut sink).err().unwrap();
        assert_eq!(err, PolicyError::Unauthorized);
        assert_eq!(sink.records[0].outcome, AuditOutcome::Denied);
    }

    #[test]
    fn grant_bound_to_reason_and_request() {
        // A valid grant cannot be replayed for a different reason or request.
        let (policy, reason) = setup();
        let mut sink = MemoryAuditSink::default();
        let grant = policy.authorize(1, &reason, 100);
        let other_reason = ExemptionReason::new("a totally different justification").unwrap();
        assert!(policy.begin(&grant, 1, &other_reason, 100, &mut sink).is_err(), "reason not bound");
        assert!(policy.begin(&grant, 2, &reason, 100, &mut sink).is_err(), "request not bound");
        assert!(policy.begin(&grant, 1, &reason, 999, &mut sink).is_err(), "timestamp not bound");
        // The correct tuple works.
        assert!(policy.begin(&grant, 1, &reason, 100, &mut sink).is_ok());
    }

    #[test]
    fn abandoning_without_disclosure_is_recorded_loudly() {
        // Dropping a session without finish() must leave a compliance-gap record.
        let (policy, reason) = setup();
        let mut sink = MemoryAuditSink::default();
        let grant = policy.authorize(9, &reason, 200);
        {
            let mut session = policy.begin(&grant, 9, &reason, 200, &mut sink).unwrap();
            let _ = session.step(&[0.5f32, 0.5]);
            // no finish() — session dropped here
        }
        assert_eq!(sink.records.len(), 1);
        assert_eq!(sink.records[0].outcome, AuditOutcome::AbandonedUndisclosed);
    }

    #[test]
    fn empty_disclosure_rejected() {
        let (policy, reason) = setup();
        let mut sink = MemoryAuditSink::default();
        let grant = policy.authorize(3, &reason, 300);
        let session = policy.begin(&grant, 3, &reason, 300, &mut sink).unwrap();
        assert_eq!(
            session.finish(ProvenanceDisclosure::Label("  ".into())).unwrap_err(),
            PolicyError::EmptyDisclosure
        );
        // finish() failed, session consumed; drop path records the abandonment.
        assert_eq!(sink.records[0].outcome, AuditOutcome::AbandonedUndisclosed);
    }
}
