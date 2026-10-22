# ADR 423: "Start here" steps on pages with an order

Status: Accepted (ships in ruflo-console 0.24.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/views/steps.ts`, `hooks/views/pane.ts`, `tests/steps.spec.ts`, `tests/steps.test.ts`.

Extends: ADR 407, ADR 422 (cards). Companion to Mission Control's NEXT STEP box (ADR 409).

## 1. Context

Several pages are about a job with a real order: a swarm needs ruflo set up, then a swarm, then agents; a hive-mind needs a hive, then workers, then a proposal, then votes; learning needs the daemon and a pretrain. A page showed all of its parts at once, and the order lived in the person's head or in an empty-state sentence ("start a hierarchical one, then spawn agents into it"). Mission Control already answered this with a NEXT STEP to-do; the other pages had nothing like it.

## 2. Decision

A **Start here** card leads a page that has an order: a numbered list of steps, each with a status, a few words on why, and the button that does it.

- **Status** is read from the disk the console already reads, not from a click: ✔ done, ▶ the next one (with a primary **do this** button), ○ later (a plain **▸** button, so any step can be done out of order). The header counts progress: "2 of 5 done".
- **What a button does** is one of: a one-click start or run (each asks first, the confirm opens right under the step, and the exact command is on the confirm row), put the keys in the page's own field, open another page, or claim the selected task. Nothing runs without the confirm that ran before.
- **Where the disk cannot say** whether a step is done (a score, a scan), the steps are a numbered menu in order, none marked done.
- The card is a collapsible section like any other, and it **goes away once every step the disk can check is done**, so a set-up page is not cluttered by instructions it no longer needs.
- Nine pages have steps: Overview (init, daemon, swarm), Swarm (init, swarm, coder, tester, reviewer, watch), Hive-Mind (init, hive, workers, propose, votes), Claims (task, claim), Learning (daemon, pretrain, the Learning Lab), Federation (join, read, the x.ruv.io board), MetaHarness (score, scan, trend), Memory Lab (stats, health, browse) and Plugins (the marketplace, the catalog). The steps are a table (`STEPS`), so another page is one entry.
- Cards only: in a compact inline pane and in the plain-text dump the page is unchanged.

## 3. Alternatives considered

- **A wizard that walks the steps and hides the page.** Rejected: someone who knows ruflo must not be made to click through; the card is above the page, collapsible, and any step is open to any order.
- **Steps from a click log.** Rejected: the disk is the truth (a swarm started in a terminal counts); a click log would be wrong the moment anything else touched the project.
- **Steps on every page.** Rejected: most pages are a list to read or a lab with no order, and an invented order is noise.

## 4. Consequences

A first-time visitor of an empty project sees what to do and in what order, with one button for it. An established project sees no card on the pages whose steps are all done. The count and the marks cost nothing a page did not already read.

## 5. Tests

- `tests/steps.spec.ts` (pure): every step points at a start, a run, a field or a page that exists; the Swarm, Hive-Mind and Claims checks read the disk's facts as they say; only the pages with an order have steps.
- `tests/steps.test.ts` (kit): in an empty project the Swarm page leads with its steps, the first marked next, its button asks before it runs and Cancel runs nothing; in a project with ruflo and a swarm those two steps show done and the next is marked.
- The live smoke draws every page with its card.
