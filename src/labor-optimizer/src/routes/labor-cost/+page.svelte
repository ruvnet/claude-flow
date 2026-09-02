<script lang="ts">
	import MetricCard from '$lib/components/dashboard/MetricCard.svelte';
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Labor Cost Analysis</h1>
			<p class="mt-1 text-sm text-gray-500">Track labor efficiency and budget adherence</p>
		</div>
		<select class="rounded-lg border border-gray-300 px-3 py-2 text-sm">
			<option value="week">This Week</option>
			<option value="month">This Month</option>
			<option value="quarter">This Quarter</option>
		</select>
	</div>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<MetricCard title="Labor Cost %" value="—" target="28.0%" status="neutral" />
		<MetricCard title="CPLH" value="—" subtitle="Covers per labor hour" status="neutral" />
		<MetricCard title="RPLH" value="—" subtitle="Revenue per labor hour" status="neutral" />
		<MetricCard title="Overtime Cost" value="—" subtitle="This period" status="neutral" />
	</div>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<div class="rounded-xl border border-gray-200 bg-white p-6">
			<h2 class="text-lg font-semibold text-gray-900">Cost by Role</h2>
			<p class="mt-1 text-sm text-gray-500">Labor cost breakdown by staff role</p>
			<div class="mt-6 flex items-center justify-center py-12 text-gray-400">
				<p class="text-sm">Connect Toast POS to see role-level cost data</p>
			</div>
		</div>

		<div class="rounded-xl border border-gray-200 bg-white p-6">
			<h2 class="text-lg font-semibold text-gray-900">Daypart Analysis</h2>
			<p class="mt-1 text-sm text-gray-500">Labor efficiency by service period</p>
			<div class="mt-4 space-y-3">
				{#each ['Lunch', 'Afternoon', 'Dinner', 'Late Night'] as daypart}
					<div class="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
						<span class="text-sm font-medium text-gray-700">{daypart}</span>
						<div class="flex items-center gap-4 text-sm text-gray-500">
							<span>—% labor</span>
							<span>— CPLH</span>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div class="rounded-xl border border-gray-200 bg-white p-6">
		<h2 class="text-lg font-semibold text-gray-900">Labor Cost Trend</h2>
		<p class="mt-1 text-sm text-gray-500">Weekly labor cost % over time</p>
		<div class="mt-6 flex items-center justify-center py-12 text-gray-400">
			<p class="text-sm">Historical data will populate as schedules are completed</p>
		</div>
	</div>
</div>
