//! `ruflo-federation-peer` — single-process federation peer.
//!
//! Composes the QUIC transport (`midstreamer-quic`) and the AIMDS
//! 3-gate safety pipeline (`aimds-detection` / `aimds-analysis` /
//! `aimds-response`) into one Rust process per peer (ADR-120 Step 3).
//! Collapses the previous Node-bridge → Node-MCP → Rust-crate path
//! into a single binary that does the federation hop + the 3-gate
//! in-flight scan + the stdio handoff to the local agent.
//!
//! The crate exports two traits that callers can implement against
//! their own backends:
//!
//!   - [`TransportProvider`] — accepts inbound federation messages
//!     and surfaces outbound ones. Default impl (under `--features
//!     native`) wraps `midstreamer-quic`.
//!
//!   - [`SafetyGate`] — runs the 3-gate inspection on a message
//!     payload. Default impl wraps `aimds-detection`'s sanitizer +
//!     `aimds-analysis`'s policy verifier + `aimds-response`'s
//!     mitigation pipeline.
//!
//! The [`Peer`] type binds a transport to a safety gate. Inbound
//! messages flow `transport → gate → dispatch`, outbound flow
//! `dispatch → gate → transport`. Both gates run in-process, so a
//! verdict on a federation hop completes in <60 ms (AIMDS docs).
//!
//! Without the `native` feature this crate compiles to traits + the
//! [`Peer`] dispatch loop only — useful for downstream consumers
//! that want to substitute their own QUIC / gate backends without
//! pulling in the upstream tree.

#![deny(unsafe_code)]
#![warn(missing_docs)]

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// A federation message. Mirrors the shape of
/// `agentic-flow/transport/loader::AgentMessage` so the TS-side and
/// Rust-side peer agree on the wire format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FederationMessage {
    /// Message identifier.
    pub id: String,
    /// Message type (`task` / `result` / `status` / `coordination` /
    /// `heartbeat` / custom).
    #[serde(rename = "type")]
    pub kind: String,
    /// JSON payload; opaque at the transport layer.
    pub payload: serde_json::Value,
    /// Optional sender / recipient metadata.
    #[serde(default)]
    pub metadata: serde_json::Map<String, serde_json::Value>,
    /// Optional stream id for multiplexing per peer.
    #[serde(default, rename = "streamId")]
    pub stream_id: Option<String>,
}

/// Verdict from the 3-gate safety pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SafetyVerdict {
    /// Message passed all three gates — forward as-is.
    Pass,
    /// Gate flagged unsafe content; quarantine + emit an audit
    /// record. The carried string is the reason (which gate
    /// triggered, what pattern).
    Block(String),
    /// Gate redacted PII or sanitized cookies/tokens but the
    /// message is still safe to forward. Returns the cleaned
    /// payload.
    Redact(FederationMessage),
}

/// Error surface for the peer's operations.
#[derive(Debug, thiserror::Error)]
pub enum PeerError {
    /// Transport-level failure (e.g. socket closed, peer unreachable).
    #[error("transport: {0}")]
    Transport(String),
    /// Safety-gate failure.
    #[error("safety gate: {0}")]
    Gate(String),
    /// Dispatch failure (e.g. the local Node MCP server isn't reachable).
    #[error("dispatch: {0}")]
    Dispatch(String),
    /// Malformed message could not be (de)serialized.
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
}

/// Pluggable QUIC transport. The default impl under `--features
/// native` wraps `midstreamer-quic`.
#[async_trait]
pub trait TransportProvider: Send + Sync {
    /// Send a message to the remote peer at `addr`.
    async fn send(&self, addr: &str, msg: FederationMessage) -> Result<(), PeerError>;

    /// Pull the next inbound message from any peer. Returns the
    /// sender address along with the message. Blocking — callers
    /// use it from a `select!` loop.
    async fn recv(&self) -> Result<(String, FederationMessage), PeerError>;

    /// Gracefully close the transport.
    async fn close(&self) -> Result<(), PeerError>;
}

/// Pluggable safety gate. The default impl under `--features native`
/// composes the AIMDS detection / analysis / response layers.
#[async_trait]
pub trait SafetyGate: Send + Sync {
    /// Run the 3-gate pipeline on an inbound or outbound message.
    /// Returns a verdict describing whether to forward, block, or
    /// forward a redacted variant.
    async fn inspect(&self, msg: &FederationMessage) -> Result<SafetyVerdict, PeerError>;
}

/// Pluggable dispatcher — typically writes the post-gate message to
/// the local Node MCP server via stdio NDJSON. Implementors decide
/// whether to spawn a child process, write to a Unix socket, etc.
#[async_trait]
pub trait Dispatcher: Send + Sync {
    /// Hand off an inspected (and possibly redacted) message to the
    /// local agent runtime.
    async fn dispatch(&self, sender: &str, msg: FederationMessage) -> Result<(), PeerError>;
}

/// The peer binds a transport, a gate, and a dispatcher into one
/// process. Inbound messages flow `transport.recv() → gate.inspect()
/// → dispatcher.dispatch()`; gate verdicts of `Block` quarantine the
/// message (it never reaches dispatch); `Redact` forwards the
/// cleaned variant.
pub struct Peer<T, G, D>
where
    T: TransportProvider,
    G: SafetyGate,
    D: Dispatcher,
{
    transport: T,
    gate: G,
    dispatcher: D,
}

impl<T, G, D> Peer<T, G, D>
where
    T: TransportProvider,
    G: SafetyGate,
    D: Dispatcher,
{
    /// Construct a peer from its three collaborators.
    pub fn new(transport: T, gate: G, dispatcher: D) -> Self {
        Self {
            transport,
            gate,
            dispatcher,
        }
    }

    /// Drive the inbound loop. Returns when the transport is closed
    /// or an unrecoverable error fires. Recoverable errors (gate
    /// block / redact) are logged and the loop continues.
    pub async fn run(&self) -> Result<(), PeerError> {
        loop {
            let (sender, msg) = match self.transport.recv().await {
                Ok(pair) => pair,
                Err(PeerError::Transport(reason)) if reason == "closed" => break,
                Err(e) => return Err(e),
            };

            match self.gate.inspect(&msg).await? {
                SafetyVerdict::Pass => {
                    self.dispatcher.dispatch(&sender, msg).await?;
                }
                SafetyVerdict::Redact(clean) => {
                    tracing::warn!(
                        from = %sender,
                        id = %clean.id,
                        "AIDefence gate redacted PII before dispatch",
                    );
                    self.dispatcher.dispatch(&sender, clean).await?;
                }
                SafetyVerdict::Block(reason) => {
                    tracing::warn!(
                        from = %sender,
                        id = %msg.id,
                        reason = %reason,
                        "AIDefence gate blocked inbound message — quarantined",
                    );
                    // Block: message does NOT reach dispatch.
                }
            }
        }
        Ok(())
    }

    /// Send a message outbound through the safety gate first. Used
    /// by the local agent runtime when responding to peers.
    pub async fn send(&self, addr: &str, msg: FederationMessage) -> Result<(), PeerError> {
        match self.gate.inspect(&msg).await? {
            SafetyVerdict::Pass => self.transport.send(addr, msg).await,
            SafetyVerdict::Redact(clean) => self.transport.send(addr, clean).await,
            SafetyVerdict::Block(reason) => {
                tracing::warn!(
                    to = %addr,
                    id = %msg.id,
                    reason = %reason,
                    "AIDefence gate blocked outbound message",
                );
                Err(PeerError::Gate(reason))
            }
        }
    }

    /// Tear down the transport.
    pub async fn close(&self) -> Result<(), PeerError> {
        self.transport.close().await
    }
}

/// Production transport wrapping `midstreamer-quic@0.3.0`'s
/// `QuicTransport` trait. Only available under `--features native`
/// because the upstream crate is otherwise optional.
#[cfg(feature = "native")]
pub mod native_transport {
    //! Real-QUIC wrapper over the `midstreamer-quic@0.3.0`
    //! `QuicTransport` trait surface (ruvnet/midstream PR #82).
    //!
    //! `MidstreamerTransport` owns a single established
    //! [`midstreamer_quic::QuicConnection`] (typically a
    //! ruflo↔hub-peer link). Outbound `send` opens a fresh
    //! bidirectional stream and writes one NDJSON line per
    //! [`FederationMessage`]; `recv` accepts an incoming
    //! bidirectional stream and reads one NDJSON line. This matches
    //! the framing used by the TS-side `midstream-aware-loader`.
    //!
    //! Full mesh (accept-from-many-peers) waits for an upstream
    //! `Endpoint::accept_connection` API; today the peer establishes
    //! exactly one connection at startup.
    use super::*;
    use midstreamer_quic::{QuicConnection, QuicTransport};

    /// Concrete [`TransportProvider`] backed by `midstreamer-quic`'s
    /// `QuicTransport` trait. Generic over any embedder-supplied
    /// transport so tests can substitute a fake.
    pub struct MidstreamerTransport<T: QuicTransport = QuicConnection> {
        connection: T,
        remote_addr: String,
    }

    impl MidstreamerTransport<QuicConnection> {
        /// Open a client connection to `addr` and wrap it. The
        /// returned transport is ready to `send` / `recv`.
        ///
        /// `addr` must be a `host:port` string parseable by
        /// `midstreamer-quic`'s connect path; the same string is
        /// later echoed back from `recv` as the sender.
        pub async fn connect(addr: &str) -> Result<Self, PeerError> {
            let connection = QuicConnection::connect(addr)
                .await
                .map_err(|e| PeerError::Transport(format!("connect {addr}: {e}")))?;
            Ok(Self {
                connection,
                remote_addr: addr.to_string(),
            })
        }
    }

    impl<T: QuicTransport> MidstreamerTransport<T> {
        /// Wrap an already-established transport. Used when the peer
        /// is the server side of a connection (accepted) or in tests.
        pub fn from_connection(connection: T, remote_addr: String) -> Self {
            Self {
                connection,
                remote_addr,
            }
        }
    }

    #[async_trait]
    impl<T: QuicTransport + 'static> TransportProvider for MidstreamerTransport<T> {
        async fn send(&self, addr: &str, msg: FederationMessage) -> Result<(), PeerError> {
            // Today the transport is single-connection; only sends
            // to the established remote are valid. The TS-side
            // loader holds the routing table, so an addr mismatch
            // here is a programmer error rather than a runtime one.
            if addr != self.remote_addr {
                return Err(PeerError::Transport(format!(
                    "addr {addr} does not match established remote {}",
                    self.remote_addr
                )));
            }
            let mut stream = self
                .connection
                .open_bi_stream()
                .await
                .map_err(|e| PeerError::Transport(format!("open_bi_stream: {e}")))?;
            let mut line = serde_json::to_vec(&msg)?;
            line.push(b'\n');
            stream
                .send(&line)
                .await
                .map_err(|e| PeerError::Transport(format!("write: {e}")))?;
            stream
                .finish()
                .await
                .map_err(|e| PeerError::Transport(format!("finish: {e}")))?;
            Ok(())
        }

        async fn recv(&self) -> Result<(String, FederationMessage), PeerError> {
            let mut stream = self
                .connection
                .accept_bi_stream()
                .await
                .map_err(|e| PeerError::Transport(format!("accept_bi_stream: {e}")))?;
            // QUIC streams are reliable + framed-by-finish; read in
            // chunks until the peer finishes the stream. Cap total
            // at 16 MiB to bound memory; federation messages are
            // small.
            const MAX: usize = 16 * 1024 * 1024;
            const CHUNK: usize = 8 * 1024;
            let mut buf: Vec<u8> = Vec::with_capacity(4096);
            let mut chunk = [0u8; CHUNK];
            loop {
                let n = stream
                    .recv(&mut chunk)
                    .await
                    .map_err(|e| PeerError::Transport(format!("read: {e}")))?;
                if n == 0 {
                    break;
                }
                if buf.len() + n > MAX {
                    return Err(PeerError::Transport(format!(
                        "inbound message exceeded {MAX} bytes",
                    )));
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            // Strip trailing newline framing if present.
            let trimmed: &[u8] = match buf.last() {
                Some(&b'\n') => &buf[..buf.len() - 1],
                _ => &buf,
            };
            let msg: FederationMessage = serde_json::from_slice(trimmed)?;
            Ok((self.remote_addr.clone(), msg))
        }

        async fn close(&self) -> Result<(), PeerError> {
            self.connection.close(0, b"peer shutdown");
            Ok(())
        }
    }
}

/// Production safety gate adapting any `aimds_core::SafetyGate`
/// (e.g. AIMDS's `ComposedGate` running detection + analysis +
/// response) to the peer's `FederationMessage` shape. Only
/// available under `--features native`.
#[cfg(feature = "native")]
pub mod native_gate {
    //! Adapter that lets the peer compose any `aimds_core::SafetyGate`
    //! implementation. Converts `FederationMessage` → `PromptInput`
    //! by serializing the payload to a string + carrying the
    //! metadata as context; converts the verdict back into the
    //! peer-local enum.
    //!
    //! Embedders construct one of these with their preferred gate
    //! pipeline. AIMDS's canonical `ComposedGate` (detection +
    //! analysis + response, short-circuit on Block) is the expected
    //! default, but any `aimds_core::SafetyGate` works.
    use super::*;
    use aimds_core::{PromptInput, SafetyGate as AimdsSafetyGate, SafetyVerdict as AimdsVerdict};
    use std::sync::Arc;

    /// Concrete [`SafetyGate`] that delegates to a user-provided
    /// `aimds_core::SafetyGate`. Cheap to clone (Arc-wrapped).
    pub struct AimdsGate {
        inner: Arc<dyn AimdsSafetyGate>,
    }

    impl AimdsGate {
        /// Construct from any `aimds_core::SafetyGate` implementor.
        /// Pass `AIMDS`'s canonical `ComposedGate` here, or a custom
        /// 3-gate composition.
        pub fn new<G: AimdsSafetyGate + 'static>(gate: G) -> Self {
            Self {
                inner: Arc::new(gate),
            }
        }
    }

    impl Clone for AimdsGate {
        fn clone(&self) -> Self {
            Self {
                inner: Arc::clone(&self.inner),
            }
        }
    }

    /// Adapt a `FederationMessage` to `aimds-core`'s `PromptInput`.
    /// The gate inspects message content as a stringified JSON
    /// payload; metadata + stream-id ride along in `context` so the
    /// gate can correlate per-session.
    fn to_prompt_input(msg: &FederationMessage) -> PromptInput {
        let content = serde_json::to_string(&msg.payload)
            .unwrap_or_else(|_| msg.payload.to_string());
        let context = serde_json::json!({
            "federation_id": msg.id,
            "kind": msg.kind,
            "metadata": msg.metadata,
            "streamId": msg.stream_id,
        });
        PromptInput {
            id: uuid::Uuid::new_v4(),
            timestamp: chrono::Utc::now(),
            content,
            context,
            session_id: msg.stream_id.clone(),
            user_id: None,
        }
    }

    #[async_trait]
    impl SafetyGate for AimdsGate {
        async fn inspect(&self, msg: &FederationMessage) -> Result<SafetyVerdict, PeerError> {
            let input = to_prompt_input(msg);
            let verdict = self
                .inner
                .inspect(&input)
                .await
                .map_err(|e| PeerError::Gate(format!("aimds: {e}")))?;
            Ok(match verdict {
                AimdsVerdict::Pass => SafetyVerdict::Pass,
                AimdsVerdict::Block(reason) => SafetyVerdict::Block(reason),
                AimdsVerdict::Redact(sanitized) => {
                    // The peer's verdict carries a full
                    // `FederationMessage`; rewrap the sanitized
                    // content as the message payload + preserve the
                    // routing metadata.
                    let redacted = FederationMessage {
                        id: msg.id.clone(),
                        kind: msg.kind.clone(),
                        payload: serde_json::json!({
                            "sanitized": sanitized.sanitized_content,
                            "modifications": sanitized.modifications,
                            "is_safe": sanitized.is_safe,
                        }),
                        metadata: msg.metadata.clone(),
                        stream_id: msg.stream_id.clone(),
                    };
                    SafetyVerdict::Redact(redacted)
                }
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal in-memory transport used by the dispatch-loop test.
    struct StubTransport {
        inbound: tokio::sync::Mutex<Vec<(String, FederationMessage)>>,
    }

    #[async_trait]
    impl TransportProvider for StubTransport {
        async fn send(&self, _addr: &str, _msg: FederationMessage) -> Result<(), PeerError> {
            Ok(())
        }
        async fn recv(&self) -> Result<(String, FederationMessage), PeerError> {
            let mut g = self.inbound.lock().await;
            if let Some(v) = g.pop() {
                Ok(v)
            } else {
                Err(PeerError::Transport("closed".into()))
            }
        }
        async fn close(&self) -> Result<(), PeerError> {
            Ok(())
        }
    }

    struct PassThroughGate;

    #[async_trait]
    impl SafetyGate for PassThroughGate {
        async fn inspect(&self, _msg: &FederationMessage) -> Result<SafetyVerdict, PeerError> {
            Ok(SafetyVerdict::Pass)
        }
    }

    struct BlockEverythingGate;

    #[async_trait]
    impl SafetyGate for BlockEverythingGate {
        async fn inspect(&self, _msg: &FederationMessage) -> Result<SafetyVerdict, PeerError> {
            Ok(SafetyVerdict::Block("test rule".into()))
        }
    }

    struct CountingDispatcher(tokio::sync::Mutex<usize>);

    #[async_trait]
    impl Dispatcher for CountingDispatcher {
        async fn dispatch(&self, _sender: &str, _msg: FederationMessage) -> Result<(), PeerError> {
            let mut g = self.0.lock().await;
            *g += 1;
            Ok(())
        }
    }

    fn msg(id: &str) -> FederationMessage {
        FederationMessage {
            id: id.to_string(),
            kind: "task".to_string(),
            payload: serde_json::Value::Null,
            metadata: Default::default(),
            stream_id: None,
        }
    }

    #[tokio::test]
    async fn run_dispatches_inbound_messages_that_pass_the_gate() {
        let transport = StubTransport {
            inbound: tokio::sync::Mutex::new(vec![
                ("peer-1".into(), msg("a")),
                ("peer-1".into(), msg("b")),
            ]),
        };
        let gate = PassThroughGate;
        let counter = CountingDispatcher(tokio::sync::Mutex::new(0));
        let dispatcher = CountingDispatcher(tokio::sync::Mutex::new(0));
        let peer = Peer::new(transport, gate, dispatcher);
        peer.run().await.unwrap();
        assert_eq!(*peer.dispatcher.0.lock().await, 2);
        // counter is unused; we hold it just to test the move semantics
        let _ = counter;
    }

    #[tokio::test]
    async fn run_quarantines_messages_that_the_gate_blocks() {
        let transport = StubTransport {
            inbound: tokio::sync::Mutex::new(vec![("peer-1".into(), msg("a"))]),
        };
        let gate = BlockEverythingGate;
        let dispatcher = CountingDispatcher(tokio::sync::Mutex::new(0));
        let peer = Peer::new(transport, gate, dispatcher);
        peer.run().await.unwrap();
        assert_eq!(*peer.dispatcher.0.lock().await, 0);
    }

    #[tokio::test]
    async fn outbound_send_blocks_when_gate_says_block() {
        let transport = StubTransport {
            inbound: tokio::sync::Mutex::new(vec![]),
        };
        let gate = BlockEverythingGate;
        let dispatcher = CountingDispatcher(tokio::sync::Mutex::new(0));
        let peer = Peer::new(transport, gate, dispatcher);
        let err = peer.send("peer-2", msg("c")).await.unwrap_err();
        match err {
            PeerError::Gate(reason) => assert_eq!(reason, "test rule"),
            other => panic!("expected Gate error, got {other:?}"),
        }
    }

    /// Round-trips a `FederationMessage` through the real
    /// `AimdsGate` adapter wired to an in-test `aimds_core::SafetyGate`
    /// implementor. Exercises the actual upstream trait surface
    /// (`midstreamer-quic@0.3.0` and `aimds-core@0.2.0`).
    #[cfg(feature = "native")]
    #[tokio::test]
    async fn aimds_gate_adapter_forwards_pass_and_block_verdicts() {
        use crate::native_gate::AimdsGate;
        use aimds_core::{
            AimdsError, PromptInput, SafetyGate as AimdsSafetyGate,
            SafetyVerdict as AimdsVerdict,
        };

        // Test gate: block messages whose payload contains "secret".
        struct PatternGate;
        #[async_trait]
        impl AimdsSafetyGate for PatternGate {
            async fn inspect(
                &self,
                input: &PromptInput,
            ) -> Result<AimdsVerdict, AimdsError> {
                if input.content.contains("secret") {
                    Ok(AimdsVerdict::Block("pattern: 'secret'".into()))
                } else {
                    Ok(AimdsVerdict::Pass)
                }
            }
        }

        let adapter = AimdsGate::new(PatternGate);

        let safe = FederationMessage {
            id: "1".into(),
            kind: "task".into(),
            payload: serde_json::json!({"text": "hello world"}),
            metadata: Default::default(),
            stream_id: None,
        };
        match adapter.inspect(&safe).await.unwrap() {
            SafetyVerdict::Pass => {}
            other => panic!("expected Pass, got {other:?}"),
        }

        let unsafe_msg = FederationMessage {
            id: "2".into(),
            kind: "task".into(),
            payload: serde_json::json!({"text": "the secret is out"}),
            metadata: Default::default(),
            stream_id: None,
        };
        match adapter.inspect(&unsafe_msg).await.unwrap() {
            SafetyVerdict::Block(reason) => assert!(reason.contains("secret")),
            other => panic!("expected Block, got {other:?}"),
        }
    }
}
