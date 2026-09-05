//! `ruflo-agntcy` — AGNTCY/Outshift runtime integration for RuFlo (ADR-380).
//!
//! This crate is scoped to the two genuinely new legs RuFlo needs per
//! ADR-380 (`v3/docs/adr/ADR-380-agntcy-outshift-runtime-integration.md`):
//!
//!   - **CASA intent-scoped authorization enforcement** (§3) — the
//!     [`envelope`] module. Always compiled, always pure: it is the
//!     deterministic, deny-by-default gate that checks a
//!     MetaHarness-compiled [`envelope::CasaEnvelope`] against a
//!     requested action *before* dispatch. It never calls a model.
//!
//!   - **SLIM transport for distributed coordination** (§2) — the
//!     [`transport`] module. Ships a real, working [`transport::LocalTransport`]
//!     (today's default, in-process/loopback) plus a
//!     [`transport::SlimTransport`] stub behind the `slim` Cargo feature,
//!     since no `agntcy`/`slim` Rust crate is published on crates.io yet.
//!
//! Per ADR-380 §1, this crate is optional and removable: nothing in this
//! repo's default build path requires it, and disabling the `slim`
//! feature (the default) keeps the crate free of any dependency on
//! unpublished upstream packages.

pub mod envelope;
pub mod transport;

pub use envelope::{check_authorization, AuthDecision, CasaEnvelope};
pub use transport::{LocalTransport, Transport, TransportError};

#[cfg(feature = "slim")]
pub use transport::SlimTransport;
