<script lang="ts">
  let {
    title,
    value,
    subtitle = '',
    target = '',
    trend = 'neutral',
    trendValue = '',
    status = 'neutral',
  } = $props<{
    title: string;
    value: string;
    subtitle?: string;
    target?: string;
    trend?: 'up' | 'down' | 'neutral';
    trendValue?: string;
    status?: 'good' | 'warning' | 'critical' | 'neutral';
  }>();

  let trendColor = $derived(
    trend === 'up' && status === 'good' ? 'text-accent-green' :
    trend === 'up' && status !== 'good' ? 'text-accent-red' :
    trend === 'down' && status === 'good' ? 'text-accent-green' :
    trend === 'down' ? 'text-accent-red' :
    'text-gray-400'
  );

  let trendArrow = $derived(
    trend === 'up' ? '↗' :
    trend === 'down' ? '↘' :
    ''
  );
</script>

<div class="rounded-lg border border-gray-200 bg-white p-5">
  <div class="flex items-start justify-between">
    <div>
      <p class="text-sm text-gray-500">{title}</p>
      <p class="mt-2 text-3xl font-bold text-gray-900 tracking-tight">{value}</p>
      {#if subtitle}
        <p class="mt-1 text-xs text-gray-400">{subtitle}</p>
      {/if}
      {#if target}
        <p class="mt-1 text-xs text-gray-400">{target}</p>
      {/if}
    </div>
    {#if trendValue}
      <span class="flex items-center gap-0.5 text-sm font-medium {trendColor}">
        {trendArrow} {trendValue}
      </span>
    {/if}
  </div>
</div>
