# Product Requirements — Work Order & Planning Integration

## Overview

Naologic is a full-stack manufacturing scheduling and planning application. It
lets a manufacturing team schedule production work at specific work centers,
see the resulting effect on component inventory, and understand — before they
commit to a build — whether they actually have the parts to finish it.

The app has two main views behind authentication:

- **Work Orders** — a timeline of production orders grouped by work center,
  with Day/Week/Month zoom, create/edit/delete, and CSV export.
- **Planning** — a BOM-explosion dashboard for a target product and quantity,
  showing buildability, component shortages, and readiness timing.

An **Auth** flow (signup/login, JWT-based sessions) gates every route, and an
**Admin** screen lets administrators manage other users' roles.

## Roles and permissions

Every account has exactly one role:

| Role | Can do |
|------|--------|
| **Viewer** | Read-only. Can view the Work Orders timeline and the Planning dashboard, but cannot create, edit, delete, or complete work orders. |
| **Planner** | Everything a Viewer can do, plus create/edit/delete work orders (subject to the lifecycle rules below). |
| **Admin** | Everything a Planner can do, plus the user-management screen (view all users, change their roles). |

Authentication is JWT-based: `POST /api/auth/login` and `POST /api/auth/signup`
return a token plus the authenticated user's profile (email, name, role); the
frontend stores the session and attaches the token to subsequent API calls.
Every API endpoint requires a valid token (`[Authorize]`); mutating work-order
endpoints (`POST`/`PUT`/`DELETE /api/work-orders`) additionally require the
**`PlannerWriteAccess`** authorization policy, which accepts the `Admin` and
`Planner` roles and rejects `Viewer`. Admin-only endpoints (`/api/admin/*`)
require the `Admin` role specifically. Signup currently always creates an
`Admin` account — there is no self-service way to sign up as Planner or
Viewer; those roles are assigned later via the admin screen.

## Work Orders view

The Work Orders page shows a timeline: each row is a work center, and bars on
the row represent scheduled orders. The visible window can be scaled to
**Day**, **Week**, or **Month**, and a "Today" control scrolls the timeline to
the current date if it falls in view.

Every order on the board is a **production order** — build a given quantity of
a specific part, at a specific work center, between a start and end date. Each
order carries:

- **Name** — free-text label shown on the timeline bar.
- **Part** — required. Selected from the *buildable parts* list only, i.e.
  parts that have at least one bill-of-materials (BOM) line. Today that list
  is exactly **Tractor Model 1000** and **Wheel Assembly** — "Control Panel"
  and "26in Wheel Rim" are real parts in the catalog but have no BOM of their
  own, so they cannot be produced as work orders (they only appear as
  components inside other parts' BOMs).
- **Quantity** — required, must be greater than zero.
- **Work center** — required. Selecting a part defaults the work-center field
  to that part's configured default work center (e.g. Wheel Assembly defaults
  to Wheel Build Line, Tractor Model 1000 to Final Assembly); the user can
  override the default and pick any work center.
- **Status** — one of `open`, `in-progress`, `complete`, `blocked`.
- **Start date / end date** — the scheduled window, shown as the bar's
  position and width on the timeline.

**Overlap validation:** before saving, the panel checks (client-side) that the
new or edited order's date range does not overlap another order already on
the same work center; an overlap blocks the save with an inline error. This
check is a UI convenience only — the API does not independently enforce
non-overlapping schedules.

**CSV export:** the timeline toolbar can export the full order list to CSV
with columns Work Center, Work Order, Part, Quantity, Status, Start Date, End
Date.

## Production-order lifecycle

A work order is not just a calendar entry — its status drives real inventory
movement. The rule is single-level BOM explosion: an order's "components" are
its part's direct BOM lines, and the quantity required per component is
`quantity per BOM line × order quantity`.

| Order action | Effect on inventory |
|---|---|
| Create with status **open**, **in-progress**, or **blocked** | Each component's allocated quantity increases by the required amount (the parts are reserved but not yet consumed). |
| Create with status **complete** | The order is checked for a shortage first (see below); if it clears, each component's on-hand quantity decreases by the required amount and the finished good's on-hand quantity increases by the order quantity. |
| Edit any field (name, part, quantity, work center, status, dates) | The order's old effect is fully reversed, then the new state is applied as if it were a brand-new order. There is no per-field delta math — editing quantity, changing the part, and completing an order are all the same reverse-then-apply operation. |
| Status changes to **complete** | Shortage check, then components' on-hand decreases and their allocation is released (both effects happen together, in one transaction); the finished good's on-hand increases by the order quantity. |
| Reopen (status moves away from **complete**) | The completion is reversed: components' on-hand increases and they are re-allocated; the finished good's on-hand decreases by the order quantity. |
| Delete a non-complete order | The components' allocation is released; nothing else changes. |
| Delete a complete order | The completion is reversed (as in reopen), without re-allocating — the order simply disappears along with its inventory effect. |

**Completion is blocked with a per-component shortage message when stock is
insufficient.** If completing (or re-completing after an edit) an order would
require more of a component than is on hand, the save is rejected with a 400
response listing exactly which components are short, how many are required,
how many are on hand, and how many units short each one is. No partial effect
is applied — the whole mutation is rolled back. The comparison is deliberately
against on-hand stock, not "available" stock: the order releases its own
allocation as part of the same completion, so checking against on-hand (after
that release) is correct and does not double-penalize the order for its own
reservation.

**Inventory can never go negative.** Whether it's a shortage on completion, or
a reversal (e.g. reopening an order after its finished-good stock was already
consumed elsewhere) that would drive on-hand or allocated quantity below
zero, the mutation is rejected outright with an explanatory message naming
the part. The system never silently clamps a negative value to zero — an
attempted negative means the data is inconsistent and that should be visible,
not hidden.

If a component (or the finished good itself) doesn't yet have an inventory
row when it's needed, one is created on demand with the correct starting
values — this is how the seed data's Tractor Model 1000, which starts with no
inventory row, ends up with one after the seeded pilot build order.

## Planning view

The Planning page runs a BOM explosion for a chosen target product (today:
Tractor Model 1000) and a target quantity (4, 6, 8, 10, or 12), and shows:

- **Summary cards** — Target quantity, Buildable Now (the maximum number of
  the target product that could be assembled today given current available
  component stock), Total Shortage (units short across all components), and
  Critical Part (the component driving the largest shortage).
- **Three charts** — Required vs. Available by component, Shortage by
  component, and Projected Ready Days by component (each chart's data can be
  exported to its own CSV).
- **A component gap grid** listing every direct BOM component of the target
  product with: Required (quantity needed for the target build), Available
  (on-hand minus allocated), **Allocated** (quantity already reserved by open,
  in-progress, or blocked work orders), On Order (quantity on order from
  suppliers/production), Shortage (how many units short, floored at zero),
  and Ready Days (build or lead time depending on part type). The grid can be
  exported to CSV with all of these columns.

Because work orders move `Allocated` and `OnHand` directly, this view reacts
live to every work-order mutation: creating an order raises `Allocated` on
its components immediately; completing an order lowers `OnHand` on its
components and raises `OnHand` on the finished good; deleting or reopening an
order reverses those effects. No separate sync step or refresh trigger is
needed beyond reloading the planning query.

## Out of scope

The following are explicitly not part of this feature, per the design spec:

- **Multi-level MRP** — BOM explosion is single-level only (an order's
  components are its part's direct BOM lines; components are not themselves
  exploded into their own sub-components).
- **Partial issues** — a work order either allocates/consumes its full
  required quantity or is rejected; there is no partial pick or backorder
  concept.
- **Scrap** — no scrap or yield-loss accounting during production.
- **Capacity checks** — the timeline does not check whether a work center has
  the throughput capacity to run overlapping or back-to-back orders (only the
  client-side date-overlap check described above applies, and only within a
  single work center).
- **`ProductionDemand` table usage** — the schema retains a `ProductionDemand`
  table from the original planning feature, but nothing in this feature reads
  or writes it.
