//! `ruflo-federation-peer` binary entry point.
//!
//! Reads configuration from environment variables (the same set the
//! TypeScript federation plugin already understands) and runs the
//! peer until the transport closes.
//!
//! Under `--features native` the binary boots a tokio runtime that
//! drives [`Peer::run`] against a real `MidstreamerTransport`
//! (midstreamer-quic@0.3.0) and a real `AimdsGate` adapter
//! (aimds-core@0.2.0). Without that feature it's a smoke binary
//! useful only for probing `--version`.

use std::process::ExitCode;

fn main() -> ExitCode {
    if std::env::args().any(|a| a == "--version" || a == "-V") {
        println!("ruflo-federation-peer {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }

    #[cfg(feature = "native")]
    {
        return native_main();
    }

    #[cfg(not(feature = "native"))]
    {
        eprintln!(
            "ruflo-federation-peer {} — built without `--features native`.\n\
             The binary's trait surface is exported as a library only;\n\
             rebuild with `--features native` to drive the real QUIC + AIMDS backend.",
            env!("CARGO_PKG_VERSION"),
        );
        ExitCode::SUCCESS
    }
}

#[cfg(feature = "native")]
fn native_main() -> ExitCode {
    use aimds_core::{AimdsError, PromptInput, SafetyGate, SafetyVerdict};
    use async_trait::async_trait;
    use ruflo_federation_peer::{
        native_gate::AimdsGate,
        native_transport::MidstreamerTransport,
        Dispatcher, FederationMessage, Peer, PeerError,
    };

    let remote = match std::env::var("RUFLO_FEDERATION_REMOTE_ADDR") {
        Ok(v) => v,
        Err(_) => {
            eprintln!(
                "RUFLO_FEDERATION_REMOTE_ADDR is required (e.g. hub.local:4433).",
            );
            return ExitCode::from(2);
        }
    };

    // Default gate: pass-through. Operators wanting the real 3-gate
    // pipeline construct `AimdsGate::new(ComposedGate::default())`
    // from their own bin shim; this default keeps the smoke boot
    // path useful when AIMDS detection rules aren't yet configured.
    struct PassGate;
    #[async_trait]
    impl SafetyGate for PassGate {
        async fn inspect(
            &self,
            _input: &PromptInput,
        ) -> Result<SafetyVerdict, AimdsError> {
            Ok(SafetyVerdict::Pass)
        }
    }

    // Default dispatcher: emit NDJSON to stdout so the parent
    // process (the ruflo MCP server) can ingest verdicts.
    struct StdoutDispatcher;
    #[async_trait]
    impl Dispatcher for StdoutDispatcher {
        async fn dispatch(
            &self,
            sender: &str,
            msg: FederationMessage,
        ) -> Result<(), PeerError> {
            let line = serde_json::to_string(&serde_json::json!({
                "sender": sender,
                "message": msg,
            }))?;
            println!("{line}");
            Ok(())
        }
    }

    let rt = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("ruflo-federation-peer: failed to build runtime: {e}");
            return ExitCode::from(2);
        }
    };

    rt.block_on(async move {
        let transport = match MidstreamerTransport::connect(&remote).await {
            Ok(t) => t,
            Err(e) => {
                eprintln!("ruflo-federation-peer: connect failed: {e}");
                return ExitCode::from(1);
            }
        };
        let gate = AimdsGate::new(PassGate);
        let peer = Peer::new(transport, gate, StdoutDispatcher);
        if let Err(e) = peer.run().await {
            eprintln!("ruflo-federation-peer: run failed: {e}");
            return ExitCode::from(1);
        }
        ExitCode::SUCCESS
    })
}
