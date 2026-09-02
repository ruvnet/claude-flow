/**
 * Staffing Constraints (Min/Max Floors & Ceilings)
 *
 * Configurable per-location per-position staffing limits.
 * Ensures headcount stays within operator-defined bounds.
 */

import { getSupabase, getSupabaseService, ALL_POSITIONS } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaffingConstraint {
  id?: string;
  locationId: string;
  position: string;
  minHeadcount: number;
  maxHeadcount: number;
  minHoursPerShift: number;
  maxHoursPerShift: number;
}

export interface ConstraintViolation {
  position: string;
  date: string;
  currentHeadcount: number;
  minHeadcount: number;
  maxHeadcount: number;
  violation: 'under_minimum' | 'over_maximum';
  adjustment: number; // positive = add, negative = remove
}

// ---------------------------------------------------------------------------
// Default constraints
// ---------------------------------------------------------------------------

const DEFAULT_CONSTRAINTS: Record<string, { min: number; max: number; minHrs: number; maxHrs: number }> = {
  Server:      { min: 1, max: 10, minHrs: 4, maxHrs: 10 },
  Bartender:   { min: 1, max: 6,  minHrs: 4, maxHrs: 10 },
  Host:        { min: 1, max: 3,  minHrs: 4, maxHrs: 8  },
  Barista:     { min: 0, max: 4,  minHrs: 4, maxHrs: 8  },
  Support:     { min: 0, max: 8,  minHrs: 4, maxHrs: 10 },
  Training:    { min: 0, max: 4,  minHrs: 4, maxHrs: 8  },
  'Line Cooks': { min: 1, max: 8, minHrs: 4, maxHrs: 10 },
  'Prep Cooks': { min: 0, max: 4, minHrs: 4, maxHrs: 8  },
  Pastry:      { min: 0, max: 3,  minHrs: 4, maxHrs: 8  },
  Dishwashers: { min: 1, max: 3,  minHrs: 4, maxHrs: 10 },
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Get staffing constraints for a location.
 * Returns saved constraints merged with defaults for any missing positions.
 */
export async function getStaffingConstraints(
  locationId: string,
): Promise<StaffingConstraint[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('staffing_constraints')
    .select('id, location_id, position, min_headcount, max_headcount, min_hours_per_shift, max_hours_per_shift')
    .eq('location_id', locationId);

  const saved = new Map<string, StaffingConstraint>();
  for (const row of (data || []) as any[]) {
    saved.set(row.position, {
      id: row.id,
      locationId: row.location_id,
      position: row.position,
      minHeadcount: row.min_headcount,
      maxHeadcount: row.max_headcount,
      minHoursPerShift: row.min_hours_per_shift,
      maxHoursPerShift: row.max_hours_per_shift,
    });
  }

  // Merge with defaults
  const result: StaffingConstraint[] = [];
  for (const pos of ALL_POSITIONS) {
    if (saved.has(pos)) {
      result.push(saved.get(pos)!);
    } else {
      const def = DEFAULT_CONSTRAINTS[pos] || { min: 0, max: 10, minHrs: 4, maxHrs: 10 };
      result.push({
        locationId,
        position: pos,
        minHeadcount: def.min,
        maxHeadcount: def.max,
        minHoursPerShift: def.minHrs,
        maxHoursPerShift: def.maxHrs,
      });
    }
  }

  return result;
}

/**
 * Upsert staffing constraints for a location.
 * Each constraint is upserted by (location_id, position).
 */
export async function upsertConstraints(
  locationId: string,
  constraints: Array<{
    position: string;
    minHeadcount: number;
    maxHeadcount: number;
    minHoursPerShift?: number;
    maxHoursPerShift?: number;
  }>,
): Promise<{ saved: number; errors: string[] }> {
  const sb = getSupabaseService();
  const errors: string[] = [];
  let saved = 0;

  for (const c of constraints) {
    // Validate
    if (c.minHeadcount < 0) {
      errors.push(`${c.position}: minHeadcount cannot be negative`);
      continue;
    }
    if (c.maxHeadcount < c.minHeadcount) {
      errors.push(`${c.position}: maxHeadcount (${c.maxHeadcount}) must be >= minHeadcount (${c.minHeadcount})`);
      continue;
    }

    const row = {
      location_id: locationId,
      position: c.position,
      min_headcount: c.minHeadcount,
      max_headcount: c.maxHeadcount,
      min_hours_per_shift: c.minHoursPerShift ?? 4,
      max_hours_per_shift: c.maxHoursPerShift ?? 10,
      updated_at: new Date().toISOString(),
    };

    const { error } = await sb
      .from('staffing_constraints')
      .upsert(row, { onConflict: 'location_id,position' });

    if (error) {
      errors.push(`${c.position}: ${error.message}`);
    } else {
      saved++;
    }
  }

  return { saved, errors };
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

interface PositionHeadcount {
  position: string;
  date: string;
  headcount: number;
}

/**
 * Check a set of headcount assignments against constraints.
 * Returns violations and recommended adjustments.
 */
export function checkConstraintViolations(
  headcounts: PositionHeadcount[],
  constraints: StaffingConstraint[],
): ConstraintViolation[] {
  const constraintMap = new Map<string, StaffingConstraint>();
  for (const c of constraints) constraintMap.set(c.position, c);

  const violations: ConstraintViolation[] = [];

  for (const hc of headcounts) {
    const constraint = constraintMap.get(hc.position);
    if (!constraint) continue;

    if (hc.headcount < constraint.minHeadcount) {
      violations.push({
        position: hc.position,
        date: hc.date,
        currentHeadcount: hc.headcount,
        minHeadcount: constraint.minHeadcount,
        maxHeadcount: constraint.maxHeadcount,
        violation: 'under_minimum',
        adjustment: constraint.minHeadcount - hc.headcount,
      });
    } else if (hc.headcount > constraint.maxHeadcount) {
      violations.push({
        position: hc.position,
        date: hc.date,
        currentHeadcount: hc.headcount,
        minHeadcount: constraint.minHeadcount,
        maxHeadcount: constraint.maxHeadcount,
        violation: 'over_maximum',
        adjustment: constraint.maxHeadcount - hc.headcount,
      });
    }
  }

  return violations;
}

/**
 * Enforce constraints on a staffing recommendation.
 * Adjusts headcount to be within min/max bounds per position.
 *
 * Returns the adjusted positions array and any violations that were corrected.
 */
export function enforceConstraints(
  positions: Array<{ position: string; totalHeadcount: number; shifts: any[] }>,
  constraints: StaffingConstraint[],
  date: string,
): {
  adjusted: Array<{ position: string; totalHeadcount: number; shifts: any[] }>;
  corrections: ConstraintViolation[];
} {
  const constraintMap = new Map<string, StaffingConstraint>();
  for (const c of constraints) constraintMap.set(c.position, c);

  const corrections: ConstraintViolation[] = [];
  const adjusted = positions.map((pos) => {
    const constraint = constraintMap.get(pos.position);
    if (!constraint) return { ...pos };

    let newHeadcount = pos.totalHeadcount;

    if (newHeadcount < constraint.minHeadcount) {
      corrections.push({
        position: pos.position,
        date,
        currentHeadcount: newHeadcount,
        minHeadcount: constraint.minHeadcount,
        maxHeadcount: constraint.maxHeadcount,
        violation: 'under_minimum',
        adjustment: constraint.minHeadcount - newHeadcount,
      });
      newHeadcount = constraint.minHeadcount;
    } else if (newHeadcount > constraint.maxHeadcount) {
      corrections.push({
        position: pos.position,
        date,
        currentHeadcount: newHeadcount,
        minHeadcount: constraint.minHeadcount,
        maxHeadcount: constraint.maxHeadcount,
        violation: 'over_maximum',
        adjustment: constraint.maxHeadcount - newHeadcount,
      });
      newHeadcount = constraint.maxHeadcount;
    }

    // If headcount changed, adjust shift counts proportionally
    if (newHeadcount !== pos.totalHeadcount && pos.shifts.length > 0) {
      const ratio = newHeadcount / Math.max(1, pos.totalHeadcount);
      const newShifts = pos.shifts.map((s: any) => ({
        ...s,
        count: Math.max(1, Math.round(s.count * ratio)),
      }));
      // Ensure total matches
      const shiftTotal = newShifts.reduce((sum: number, s: any) => sum + s.count, 0);
      if (shiftTotal !== newHeadcount && newShifts.length > 0) {
        // Adjust the peak shift to match
        const peakIdx = newShifts.findIndex((s: any) => s.role === 'peak');
        const adjustIdx = peakIdx >= 0 ? peakIdx : 0;
        newShifts[adjustIdx].count += newHeadcount - shiftTotal;
        newShifts[adjustIdx].count = Math.max(1, newShifts[adjustIdx].count);
      }
      return { ...pos, totalHeadcount: newHeadcount, shifts: newShifts };
    }

    return { ...pos, totalHeadcount: newHeadcount };
  });

  // Add positions that are missing but have min > 0
  for (const constraint of constraints) {
    if (constraint.minHeadcount <= 0) continue;
    const exists = adjusted.some((p) => p.position === constraint.position);
    if (!exists) {
      corrections.push({
        position: constraint.position,
        date,
        currentHeadcount: 0,
        minHeadcount: constraint.minHeadcount,
        maxHeadcount: constraint.maxHeadcount,
        violation: 'under_minimum',
        adjustment: constraint.minHeadcount,
      });
      // We flag but don't create shifts here -- the caller needs to handle
      // adding shifts for a position that wasn't in the original recommendation
    }
  }

  return { adjusted, corrections };
}
