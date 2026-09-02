<script lang="ts">
  import { page } from '$app/stores';

  let { open = $bindable(true) } = $props();

  const sections = [
    {
      category: 'OPERATIONS',
      items: [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/schedule', label: 'Schedule' },
        { href: '/employees', label: 'Employees' },
      ],
    },
    {
      category: 'ANALYTICS',
      items: [
        { href: '/forecasting', label: 'Forecasting' },
        { href: '/labor-cost', label: 'Labor Cost' },
        { href: '/reports', label: 'Reports' },
      ],
    },
    {
      category: 'COMPLIANCE',
      items: [
        { href: '/compliance', label: 'Compliance' },
        { href: '/settings', label: 'Settings' },
      ],
    },
  ];

  function isActive(href: string): boolean {
    return $page.url.pathname.startsWith(href);
  }
</script>

{#if open}
<aside class="flex w-56 flex-col bg-sidebar">
  <div class="flex h-16 items-center gap-3 px-6">
    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
      <span class="text-sm font-bold text-white">H</span>
    </div>
    <span class="text-base font-semibold text-white">HELIXO</span>
  </div>

  <nav class="flex-1 px-3 py-4 space-y-6">
    {#each sections as section}
      <div>
        <p class="px-3 mb-2 text-[11px] font-semibold tracking-wider text-sidebar-category uppercase">
          {section.category}
        </p>
        <div class="space-y-0.5">
          {#each section.items as item}
            <a
              href={item.href}
              class="block rounded-md px-3 py-2 text-sm transition-colors
                {isActive(item.href)
                  ? 'bg-sidebar-hover text-sidebar-active font-medium'
                  : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'}"
            >
              {item.label}
            </a>
          {/each}
        </div>
      </div>
    {/each}
  </nav>
</aside>
{/if}
