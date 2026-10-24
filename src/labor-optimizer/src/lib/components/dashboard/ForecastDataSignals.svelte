<script lang="ts">
  /**
   * ForecastDataSignals — renders compact data-driven indicators
   * below each forecast row: booking pace, events, competitive demand,
   * weather (already in header), and WoW momentum.
   *
   * Props come from the enriched suggestion object.
   */
  interface Props {
    bookingPace: { booked: number; avgAtThisPoint: number; delta: number } | null;
    events: { name: string; type: string; impactPct: number }[];
    competitiveDemand: { avgPctBooked: number; signal: string } | null;
    wowTrend: string | null;
  }

  let { bookingPace, events, competitiveDemand, wowTrend }: Props = $props();

  function eventIcon(type: string): string {
    const icons: Record<string, string> = {
      concert: '🎵', music: '🎵', festival: '🎪', sports: '⚾',
      conference: '📋', holiday: '🎉', theater: '🎭', food: '🍽️',
    };
    return icons[type?.toLowerCase()] || '📅';
  }
</script>

<!-- Compact row of data signals -->
<div class="forecast-signals">
  <!-- Enhancement 6: Booking Pace -->
  {#if bookingPace && bookingPace.booked > 0}
  <span
    class="signal-badge"
    style="color: {bookingPace.delta >= 0 ? '#16a34a' : '#dc2626'}; background: {bookingPace.delta >= 0 ? '#f0fdf4' : '#fef2f2'};"
    title="Resy bookings vs 4-week same-day average"
  >
    {bookingPace.booked} booked
    ({bookingPace.delta >= 0 ? '↑' : '↓'} {bookingPace.delta >= 0 ? '+' : ''}{bookingPace.delta} vs avg)
  </span>
  {/if}

  <!-- Enhancement 8: Event Callouts -->
  {#each events.slice(0, 2) as evt}
  <span
    class="signal-badge"
    style="color: #ea580c; background: #fff7ed;"
    title="{evt.name} — estimated {evt.impactPct}% impact"
  >
    {eventIcon(evt.type)} {evt.name.length > 28 ? evt.name.slice(0, 26) + '...' : evt.name}
    {#if evt.impactPct > 0}(+{evt.impactPct}%){/if}
  </span>
  {/each}

  <!-- Enhancement 9: Competitive Demand -->
  {#if competitiveDemand}
  {@const dotColor = competitiveDemand.signal === 'high' ? '#16a34a' : competitiveDemand.signal === 'moderate' ? '#eab308' : '#9ca3af'}
  <span
    class="signal-badge"
    style="color: #374151; background: #f3f4f6;"
    title="Competitor avg {competitiveDemand.avgPctBooked}% booked — {competitiveDemand.signal} demand"
  >
    <span class="signal-dot" style="background: {dotColor};"></span>
    {competitiveDemand.signal} demand
  </span>
  {/if}

</div>

<style>
  .forecast-signals {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 2px 0;
  }
  .signal-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 500;
    font-family: 'Inter', sans-serif;
    padding: 1px 6px;
    border-radius: 4px;
    white-space: nowrap;
    line-height: 1.4;
  }
  .signal-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  /* Mobile: hide signals to keep table clean */
  @media (max-width: 768px) {
    .forecast-signals {
      display: none;
    }
  }
</style>
