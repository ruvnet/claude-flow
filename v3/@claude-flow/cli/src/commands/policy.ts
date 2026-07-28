import type {
  BudgetLimit,
  PolicyRequest,
  PolicyRule,
  PolicyState,
} from '@claude-flow/security';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  autoMigratePolicyStateIfNeeded,
  evaluatePolicyRequest,
  loadPolicyState,
  revokePolicyApproval,
  setPolicyBudget,
  setPolicyMode,
  upsertPolicyRule,
  verifyPolicyLedger,
} from '../services/policy-runtime.js';

function argJson<T>(value: string | undefined, label: string): T {
  if (!value) throw new Error(`${label} requires a JSON argument`);
  try { return JSON.parse(value) as T; }
  catch { throw new Error(`${label} must be valid JSON`); }
}

function print(data: unknown): CommandResult {
  output.writeln(JSON.stringify(data, null, 2));
  return { success: true, exitCode: 0, data };
}

function requireInteractiveAdministrator(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('policy administration requires an interactive local terminal');
  }
}

export const policyCommand: Command = {
  name: 'policy',
  description: 'Agentic policy engine — evaluate actions, manage rules/approvals, and verify the decision ledger (ADR-324)',
  options: [
    { name: 'mode', type: 'string', description: 'Policy mode: legacy | observe | enforce' },
    { name: 'project-root', type: 'string', description: 'Project root containing .claude-flow/policy' },
  ],
  async action(context: CommandContext): Promise<CommandResult> {
    const args = (context as { args?: string[] }).args ?? [];
    const flags = (context as { flags?: Record<string, unknown> }).flags ?? {};
    const root = String(flags.projectRoot ?? process.cwd());
    const operation = args[0] ?? 'status';
    try {
      if (operation === 'init' || operation === 'migrate') {
        if (flags.mode || args[1]) requireInteractiveAdministrator();
        const migration = await autoMigratePolicyStateIfNeeded(root);
        const mode = String(flags.mode ?? args[1] ?? '') as PolicyState['mode'];
        if (mode) {
          if (!['legacy', 'observe', 'enforce'].includes(mode)) throw new Error('mode must be legacy, observe, or enforce');
          await setPolicyMode(mode, root);
        }
        return print({ ...migration, state: loadPolicyState(root) });
      }
      if (operation === 'status') {
        const state = loadPolicyState(root);
        return print({
          version: state.version,
          mode: state.mode,
          migratedFrom: state.migratedFrom,
          rules: state.rules.length,
          budgets: state.budgets.length,
          approvals: state.approvals.length,
          receipts: state.receipts.length,
          ledger: await verifyPolicyLedger(root),
        });
      }
      if (operation === 'evaluate') {
        return print(await evaluatePolicyRequest(argJson<PolicyRequest>(args[1], 'evaluate'), root));
      }
      if (operation === 'rule' && args[1] === 'add') {
        requireInteractiveAdministrator();
        const rule = argJson<PolicyRule>(args[2], 'rule add');
        await upsertPolicyRule(rule, root);
        return print({ success: true, ruleId: rule.id });
      }
      if (operation === 'budget' && args[1] === 'set') {
        requireInteractiveAdministrator();
        const budget = argJson<BudgetLimit>(args[2], 'budget set');
        await setPolicyBudget(budget, root);
        return print({ success: true, budgetId: budget.id });
      }
      if (operation === 'approve') {
        throw new Error(
          'approval issuance requires an authenticated human identity adapter; '
          + 'the local TTY is not an identity credential',
        );
      }
      if (operation === 'revoke') {
        requireInteractiveAdministrator();
        if (!args[1]) throw new Error('revoke requires an approval id');
        return print({ success: await revokePolicyApproval(args[1], root), approvalId: args[1] });
      }
      if (operation === 'audit') {
        const state = loadPolicyState(root);
        return print({ receipts: state.receipts });
      }
      if (operation === 'verify') return print(await verifyPolicyLedger(root));
      throw new Error(`unknown policy operation: ${operation}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.printError(message);
      return { success: false, exitCode: 1, data: { error: message } };
    }
  },
  examples: [
    { command: 'ruflo policy status', description: 'Show policy mode and ledger health' },
    { command: 'ruflo policy init --mode observe', description: 'Migrate an existing install without blocking legacy actions' },
    { command: 'ruflo policy budget set \'{"id":"daily-model","action":"model.call","maxCostUsd":10,"periodMs":86400000}\'', description: 'Set an atomic policy budget ceiling' },
    { command: 'ruflo policy evaluate \'{"identity":{"id":"agent-1","type":"agent"},"action":{"type":"deploy","environment":"production"}}\'', description: 'Evaluate an action and write a decision receipt' },
  ],
};

export default policyCommand;
