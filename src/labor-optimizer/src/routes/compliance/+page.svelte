<script lang="ts">
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Compliance</h1>
			<p class="mt-1 text-sm text-gray-500">Labor law compliance monitoring and alerts</p>
		</div>
		<button class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
			Run Compliance Check
		</button>
	</div>

	<!-- Status Cards -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div class="rounded-xl border border-green-200 bg-green-50 p-5">
			<p class="text-sm font-medium text-green-700">Active Violations</p>
			<p class="mt-2 text-3xl font-bold text-green-900">0</p>
		</div>
		<div class="rounded-xl border border-amber-200 bg-amber-50 p-5">
			<p class="text-sm font-medium text-amber-700">Warnings</p>
			<p class="mt-2 text-3xl font-bold text-amber-900">0</p>
		</div>
		<div class="rounded-xl border border-gray-200 bg-white p-5">
			<p class="text-sm font-medium text-gray-600">Rules Configured</p>
			<p class="mt-2 text-3xl font-bold text-gray-900">0</p>
		</div>
	</div>

	<!-- Rules Configuration -->
	<div class="rounded-xl border border-gray-200 bg-white p-6">
		<h2 class="text-lg font-semibold text-gray-900">Compliance Rules</h2>
		<p class="mt-1 text-sm text-gray-500">Configure rules by jurisdiction</p>
		<div class="mt-4 space-y-3">
			{#each [
				{ name: 'Federal Overtime', desc: 'Weekly overtime after 40 hours at 1.5x rate', jurisdiction: 'Federal' },
				{ name: 'Meal Break', desc: '30-minute unpaid meal break for shifts over 5 hours', jurisdiction: 'State' },
				{ name: 'Rest Break', desc: '10-minute paid rest break per 4 hours worked', jurisdiction: 'State' },
				{ name: 'Predictive Scheduling', desc: '14-day advance notice for schedules', jurisdiction: 'Local' },
			] as rule}
				<div class="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3">
					<div>
						<p class="text-sm font-medium text-gray-900">{rule.name}</p>
						<p class="text-xs text-gray-500">{rule.desc}</p>
					</div>
					<div class="flex items-center gap-3">
						<span class="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">{rule.jurisdiction}</span>
						<button class="text-sm font-medium text-brand-600 hover:text-brand-700">Enable</button>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Violation Log -->
	<div class="rounded-xl border border-gray-200 bg-white p-6">
		<h2 class="text-lg font-semibold text-gray-900">Violation Log</h2>
		<p class="mt-1 text-sm text-gray-500">History of detected compliance issues</p>
		<div class="mt-4 flex items-center justify-center py-8 text-gray-400">
			<p class="text-sm">No violations detected. Enable rules above to start monitoring.</p>
		</div>
	</div>
</div>
