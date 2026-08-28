//! Throughput benchmarks: per-token generation cost for both schemes and the
//! detector scan rate. These quantify the "negligible impact on speed" claim —
//! watermarking is a handful of hashes per emitted token.

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use ruflo_watermark::{detect_gumbel, detect_tournament, Scheme, WatermarkConfig, WatermarkKey, Watermarker};

fn candidates(vocab: u32) -> (Vec<u32>, Vec<f32>) {
    let tokens: Vec<u32> = (0..vocab).collect();
    let probs = vec![1.0f32 / vocab as f32; vocab as usize];
    (tokens, probs)
}

fn bench_generation(c: &mut Criterion) {
    let (tokens, probs) = candidates(256);
    let mut group = c.benchmark_group("generation_per_token");
    group.throughput(Throughput::Elements(1));

    for depth in [2u32, 4, 8] {
        let cfg = WatermarkConfig::new(WatermarkKey(1)).with_layers(depth);
        group.bench_with_input(BenchmarkId::new("tournament_depth", depth), &depth, |b, _| {
            let mut wm = Watermarker::new(cfg, Scheme::Tournament);
            b.iter(|| wm.step(&tokens, &probs));
        });
    }

    let cfg = WatermarkConfig::new(WatermarkKey(1)).with_layers(1);
    group.bench_function("gumbel", |b| {
        let mut wm = Watermarker::new(cfg, Scheme::Gumbel);
        b.iter(|| wm.step(&tokens, &probs));
    });
    group.finish();
}

fn bench_detection(c: &mut Criterion) {
    let (tokens, probs) = candidates(256);
    let cfg = WatermarkConfig::new(WatermarkKey(1)).with_layers(6);
    let mut wm = Watermarker::new(cfg, Scheme::Tournament);
    let stream: Vec<u32> = (0..2000).map(|_| tokens[wm.step(&tokens, &probs)]).collect();

    let mut group = c.benchmark_group("detection");
    group.throughput(Throughput::Elements(stream.len() as u64));
    group.bench_function("tournament_scan", |b| b.iter(|| detect_tournament(&stream, cfg)));

    let cfg_g = WatermarkConfig::new(WatermarkKey(1)).with_layers(1);
    let mut wmg = Watermarker::new(cfg_g, Scheme::Gumbel);
    let stream_g: Vec<u32> = (0..2000).map(|_| tokens[wmg.step(&tokens, &probs)]).collect();
    group.bench_function("gumbel_scan", |b| b.iter(|| detect_gumbel(&stream_g, cfg_g)));
    group.finish();
}

criterion_group!(benches, bench_generation, bench_detection);
criterion_main!(benches);
