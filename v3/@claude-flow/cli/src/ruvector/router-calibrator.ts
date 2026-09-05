/**
 * router-calibrator.ts — Post-hoc isotonic calibration for the KRR router
 * (ADR-149 iter 22).
 *
 * The bundled KRR systematically under-predicts at the low end (gap 0.45 at
 * 0.0–0.1) and over-predicts at the high end (gap 0.15 at 0.9–1.0). Both
 * deviations are monotone, so a piecewise-constant non-decreasing function
 * fit via Pool-Adjacent-Violators (PAV) can correct them without retraining
 * the KRR.
 *
 * USAGE
 *
 *   const cal = IsotonicCalibrator.fit([[0.07, 0.52], [0.55, 0.60], …]);
 *   const corrected = cal.transform(rawKrrScore);
 *
 *   // Persist & reload:
 *   writeFileSync(path, JSON.stringify(cal.toJSON()));
 *   const loaded = IsotonicCalibrator.fromJSON(JSON.parse(readFileSync(path, 'utf8')));
 *
 * Pure TS — no native deps. ~25 lines of fitting logic, O(n log n) sort +
 * O(n) PAV pass.
 *
 * @module router-calibrator
 */

export interface CalibratorBucket {
  /** Inclusive lower bound of predicted-values pooled into this bucket. */
  predMin: number;
  /** Inclusive upper bound. */
  predMax: number;
  /** Calibrated output value (mean of observed values in the pool). */
  calibrated: number;
  /** Number of (pred,obs) pairs pooled. */
  count: number;
}

export interface CalibratorJSON {
  v: 1;
  buckets: CalibratorBucket[];
}

export class IsotonicCalibrator {
  private buckets: CalibratorBucket[];

  private constructor(buckets: CalibratorBucket[]) {
    this.buckets = buckets;
  }

  /**
   * Fit an isotonic regression to (predicted, observed) pairs via PAV.
   *
   * Result is a non-decreasing piecewise-constant function over the
   * empirical predicted-value range, equivalent in spirit to sklearn's
   * IsotonicRegression(increasing=True, out_of_bounds='clip').
   */
  static fit(pairs: Array<[number, number]>): IsotonicCalibrator {
    if (pairs.length === 0) return new IsotonicCalibrator([]);
    // Sort by predicted value ascending; stable sort isn't required because
    // ties only affect bucket boundaries (which PAV then pools anyway).
    const sorted = [...pairs].sort((a, b) => a[0] - b[0]);

    type Pool = { predMin: number; predMax: number; sumObs: number; count: number };
    const pools: Pool[] = sorted.map(([p, o]) => ({ predMin: p, predMax: p, sumObs: o, count: 1 }));

    // Pool-Adjacent-Violators: walk left-to-right, merge adjacent pools
    // whose averages violate monotonicity. After merging, back up one step
    // to check the new pool against its predecessor.
    let i = 0;
    while (i < pools.length - 1) {
      const a = pools[i], b = pools[i + 1];
      const avgA = a.sumObs / a.count;
      const avgB = b.sumObs / b.count;
      if (avgA > avgB) {
        pools[i] = {
          predMin: a.predMin,
          predMax: b.predMax,
          sumObs: a.sumObs + b.sumObs,
          count: a.count + b.count,
        };
        pools.splice(i + 1, 1);
        if (i > 0) i--;
      } else {
        i++;
      }
    }

    const buckets: CalibratorBucket[] = pools.map(p => ({
      predMin: p.predMin,
      predMax: p.predMax,
      calibrated: p.sumObs / p.count,
      count: p.count,
    }));
    return new IsotonicCalibrator(buckets);
  }

  /**
   * Map a raw predicted value to its calibrated value. Uses piecewise-linear
   * interpolation between adjacent bucket midpoints, clamped at the
   * empirical edges (extrapolation outside the training range returns the
   * nearest edge bucket's calibrated value).
   */
  transform(x: number): number {
    const n = this.buckets.length;
    if (n === 0) return x;            // No calibration data → pass-through.
    if (n === 1) return this.buckets[0].calibrated;

    const mids = this.buckets.map(b => (b.predMin + b.predMax) / 2);
    if (x <= mids[0]) return this.buckets[0].calibrated;
    if (x >= mids[n - 1]) return this.buckets[n - 1].calibrated;

    // Linear interpolation between two adjacent bucket midpoints. Could be
    // binary-searched, but n is typically <30 after PAV so linear is fine.
    for (let i = 0; i < n - 1; i++) {
      if (x >= mids[i] && x <= mids[i + 1]) {
        const t = (x - mids[i]) / (mids[i + 1] - mids[i]);
        return this.buckets[i].calibrated * (1 - t) + this.buckets[i + 1].calibrated * t;
      }
    }
    return x; // unreachable given the bounds above
  }

  /** Pure-JSON serialization — calibrator JSON is small (typically <2kB). */
  toJSON(): CalibratorJSON {
    return { v: 1, buckets: this.buckets };
  }

  static fromJSON(j: CalibratorJSON): IsotonicCalibrator {
    if (!j || j.v !== 1) throw new Error(`unsupported calibrator schema v=${j?.v}`);
    return new IsotonicCalibrator(j.buckets);
  }

  /** Diagnostic — number of distinct calibration points after PAV. */
  get bucketCount(): number {
    return this.buckets.length;
  }

  /** Diagnostic — return a copy of the bucket array (read-only view). */
  inspect(): CalibratorBucket[] {
    return this.buckets.map(b => ({ ...b }));
  }
}
