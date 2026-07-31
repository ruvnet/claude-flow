//! Transport surface for AGNTCY/SLIM-coordinated agent messaging — ADR-380
//! §2.
//!
//! [`LocalTransport`] is the default, always-available in-process/loopback
//! implementation — the same "keep the current local transport as the
//! default for single-host swarms" posture ADR-380 §2 requires. It is a
//! real, working implementation usable today with no external
//! dependencies.
//!
//! [`SlimTransport`] (behind the `slim` Cargo feature) is a deliberate
//! stub: no `agntcy`/`slim` Rust crate is published on crates.io yet
//! (verified during ADR-380 scaffolding), so its methods return an
//! explicit, clearly-labeled error rather than silently succeeding or
//! faking network behavior.

use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

/// Errors a [`Transport`] implementation can return.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    /// A transport-specific failure, always carrying an explicit message
    /// (never a silent partial success).
    Failed(String),
    /// This transport is not available in the current build/configuration
    /// — e.g. [`SlimTransport`] before the upstream `agntcy`/`slim` Rust
    /// crate exists.
    Unavailable(String),
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TransportError::Failed(msg) => write!(f, "transport failed: {msg}"),
            TransportError::Unavailable(msg) => write!(f, "transport unavailable: {msg}"),
        }
    }
}

impl std::error::Error for TransportError {}

/// A message transport for agent-to-agent coordination.
///
/// Implementations are expected to be usable from multiple threads
/// (`send`/`recv` take `&self`).
pub trait Transport {
    /// Sends `payload` on `channel`. Returns `Ok(())` once the payload has
    /// been accepted by the transport (delivery semantics are
    /// implementation-defined).
    fn send(&self, channel: &str, payload: &[u8]) -> Result<(), TransportError>;

    /// Drains and returns every payload currently queued on `channel`.
    /// Returns an empty `Vec` (not an error) if the channel has no
    /// pending messages.
    fn recv(&self, channel: &str) -> Result<Vec<Vec<u8>>, TransportError>;
}

/// A real, working in-process/loopback [`Transport`].
///
/// Messages sent to a channel are queued in memory and returned in FIFO
/// order to the next `recv` call on that same channel. This is today's
/// default transport for single-host swarms per ADR-380 §2 — "Keep the
/// current local transport as the default for single-host swarms" — and
/// requires no external dependencies or network access.
#[derive(Debug, Default)]
pub struct LocalTransport {
    channels: Mutex<HashMap<String, Vec<Vec<u8>>>>,
}

impl LocalTransport {
    /// Creates a new, empty `LocalTransport`.
    pub fn new() -> Self {
        Self {
            channels: Mutex::new(HashMap::new()),
        }
    }
}

impl Transport for LocalTransport {
    fn send(&self, channel: &str, payload: &[u8]) -> Result<(), TransportError> {
        let mut channels = self
            .channels
            .lock()
            .map_err(|_| TransportError::Failed("LocalTransport mutex poisoned".to_string()))?;
        channels
            .entry(channel.to_string())
            .or_default()
            .push(payload.to_vec());
        Ok(())
    }

    fn recv(&self, channel: &str) -> Result<Vec<Vec<u8>>, TransportError> {
        let mut channels = self
            .channels
            .lock()
            .map_err(|_| TransportError::Failed("LocalTransport mutex poisoned".to_string()))?;
        Ok(channels.remove(channel).unwrap_or_default())
    }
}

/// SLIM (secure messaging for MCP/A2A, ADR-380 §2) transport — **stub
/// only**.
///
/// No `agntcy`/`slim` Rust crate is published on crates.io as of this
/// writing. Every method here returns
/// `Err(TransportError::Unavailable(...))` with an explicit, actionable
/// message rather than doing anything fake. This type only exists behind
/// the `slim` Cargo feature (off by default) so downstream code can start
/// writing against the [`Transport`] trait today and swap in a real
/// implementation once the upstream crate ships.
#[cfg(feature = "slim")]
#[derive(Debug, Default)]
pub struct SlimTransport;

#[cfg(feature = "slim")]
impl SlimTransport {
    /// Constructs a `SlimTransport` stub. Does not attempt any network
    /// connection — connection attempts happen (and fail explicitly) in
    /// [`Transport::send`]/[`Transport::recv`].
    pub fn new() -> Self {
        Self
    }
}

#[cfg(feature = "slim")]
impl Transport for SlimTransport {
    fn send(&self, _channel: &str, _payload: &[u8]) -> Result<(), TransportError> {
        Err(TransportError::Unavailable(
            "SLIM transport not yet available — pending upstream agntcy/slim Rust crate publication, see ADR-380".to_string(),
        ))
    }

    fn recv(&self, _channel: &str) -> Result<Vec<Vec<u8>>, TransportError> {
        Err(TransportError::Unavailable(
            "SLIM transport not yet available — pending upstream agntcy/slim Rust crate publication, see ADR-380".to_string(),
        ))
    }
}

#[cfg(test)]
mod local_transport_tests {
    use super::*;

    #[test]
    fn recv_on_empty_channel_returns_empty_vec() {
        let t = LocalTransport::new();
        assert_eq!(t.recv("nobody-sent-here").unwrap(), Vec::<Vec<u8>>::new());
    }

    #[test]
    fn send_then_recv_round_trips_fifo() {
        let t = LocalTransport::new();
        t.send("ch1", b"first").unwrap();
        t.send("ch1", b"second").unwrap();
        let msgs = t.recv("ch1").unwrap();
        assert_eq!(msgs, vec![b"first".to_vec(), b"second".to_vec()]);
    }

    #[test]
    fn recv_drains_the_channel() {
        let t = LocalTransport::new();
        t.send("ch1", b"only").unwrap();
        assert_eq!(t.recv("ch1").unwrap().len(), 1);
        assert_eq!(t.recv("ch1").unwrap().len(), 0);
    }

    #[test]
    fn channels_are_independent() {
        let t = LocalTransport::new();
        t.send("a", b"for-a").unwrap();
        t.send("b", b"for-b").unwrap();
        assert_eq!(t.recv("a").unwrap(), vec![b"for-a".to_vec()]);
        assert_eq!(t.recv("b").unwrap(), vec![b"for-b".to_vec()]);
    }

    #[cfg(feature = "slim")]
    #[test]
    fn slim_transport_send_returns_explicit_unavailable_error() {
        let t = SlimTransport::new();
        let err = t.send("ch1", b"payload").unwrap_err();
        match err {
            TransportError::Unavailable(msg) => {
                assert!(msg.contains("ADR-380"));
                assert!(msg.contains("SLIM"));
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    #[cfg(feature = "slim")]
    #[test]
    fn slim_transport_recv_returns_explicit_unavailable_error() {
        let t = SlimTransport::new();
        let err = t.recv("ch1").unwrap_err();
        assert!(matches!(err, TransportError::Unavailable(_)));
    }
}
