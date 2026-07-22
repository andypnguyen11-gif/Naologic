# Work Order ↔ Planning Integration — Design Spec

**Date:** 2026-07-21
**Status:** Approved pending user review

## Problem

Work orders and planning data are disconnected. Work orders carry only a name,
work center, status, and date range — no part, no quantity. The planning view
computes component gaps from BOM + Inventory and never reads the WorkOrders
table. Creating, editing, completing, or deleting a work order has zero effect
on the planning view. The only shared dimension is the work-center list.

## Goal

Make work orders behave like thin production orders (SAP/Odoo style): a work
order is "build N units of part X at work center Y between these dates," and
its lifecycle moves inventory so the planning view reacts to every mutation.

**Explicitly out of scope:** multi-level MRP, partial issues, scrap, negative
inventory, incoming-supply/"in production" UI, capacity checks against
schedule dates, ProductionDemand table usage.

## Design decisions (approved)

1. **Full lifecycle** — allocate on create, consume + receive on complete,
   reverse on delete/reopen. All mutations transactional.
2. **Block on shortage** — completion is rejected (HTTP 400) if any component
   is short; inventory never goes negative.
3. **Planning UI change is the Allocated column only** — no incoming-supply
   section.
4. **`PartId` is NOT NULL** — every work order is a production order. No
   part-less "timeline color" orders.
5. **BOM-only rule** — only parts with at least one BOM line are orderable
   (currently Tractor Model 1000 and Wheel Assembly). Enforced in the picker
   AND server-side on create/update. Do not invent BOMs for Control Panel or
   26in Wheel Rim.
6. **Seed rewrite** — tractor-domain orders with fully consistent inventory:
   Allocated matches open/in-progress/blocked explosions, and OnHand already
   reflects completed orders' consumption and receipts.

## 1. Data model

### Schema change (`WorkOrders`)

```sql
ALTER TABLE WorkOrders ADD
    PartId NVARCHAR(50) NOT NULL,       -- FK -> Parts(PartId)
    Quantity DECIMAL(12,2) NOT NULL;
-- CONSTRAINT FK_WorkOrders_Parts FOREIGN KEY (PartId) REFERENCES Parts(PartId)
-- CONSTRAINT CK_WorkOrders_Quantity CHECK (Quantity > 0)
```

Delivered two ways:
- `api/database/NaologicDb.sql` updated in place (fresh-install path; the
  WorkOrders CREATE TABLE and seed move logically after Parts exists — see
  seed section for script-ordering note).
- `api/database/Migration_WorkOrderParts.sql` — standalone migration for the
  deployed Railway DB. SQL Server cannot `ADD ... NOT NULL` on a non-empty
  table, so the migration must: add `PartId`/`Quantity` as nullable → delete
  the old seed orders and insert the new ones (or backfill) → `ALTER COLUMN`
  to NOT NULL and add the FK + CHECK constraints → fix inventory rows.

**Script ordering note:** `NaologicDb.sql` currently creates WorkOrders before
`Planning.sql` creates Parts. The FK requires Parts to exist first. Resolution:
`NaologicDb.sql` creates WorkCenters only; a combined ordering is established
where Parts/BOM/Inventory (Planning.sql) run before the WorkOrders table +
seed. Exact file split is an implementation choice, but the documented setup
order in the README must remain a working sequence.

### Work-center rename (polish, IDs unchanged)

| Id | Old name | New name |
|----|----------|----------|
| wc-001 | Extrusion Line A | Fabrication Line A |
| wc-002 | CNC Machine 1 | CNC Machining |
| wc-003 | Assembly Station | Final Assembly |
| wc-004 | Quality Control | Quality Control (unchanged) |
| wc-005 | Packaging Line | Wheel Build Line |

## 2. Lifecycle rules

A new backend service (`WorkOrderInventoryService`, used by the work-orders
repository/controller path) owns all inventory math. Every mutation runs in a
single SQL transaction; the shortage check happens inside the transaction.

**BOM explosion is single-level:** components = the part's direct BOM lines,
required = `QuantityPer × Quantity`.

| Action | Inventory effect |
|--------|------------------|
| Create with status `open` / `in-progress` / `blocked` | Component `QuantityAllocated += required` |
| Create with status `complete` | Shortage check, then component `OnHand −= required`; FG `OnHand += Quantity` |
| Edit (any field) | Fully reverse the old order's effect, then apply the new state as if created fresh |
| Status → `complete` | Shortage check; components `OnHand −= required`, `Allocated −= required`; FG `OnHand += Quantity` |
| Reopen (`complete` → other) | Reverse completion: components `OnHand += required`, `Allocated += required`; FG `OnHand −= Quantity` |
| Delete (non-complete) | Component `Allocated −= required` |
| Delete (complete) | Reverse completion (as reopen), without re-allocating |

**Guards (all return HTTP 400, state unchanged):**
- Completion shortage: any component with `OnHand < required` →
  `{ message, shortages: [{ partId, partName, requiredQty, onHand, shortBy }] }`.
  The check deliberately compares **OnHand, not Available**: on completion the
  order releases its own allocation in the same transaction, so requiring
  `Available >= required` would double-count that reservation. Other orders'
  soft allocations do not block consumption — standard backflush semantics.
  Do not "fix" this to Available later.
- Reversal would drive any quantity negative (e.g. reopening a Tractor order
  after the received tractors' stock was reduced) → rejected with a message
  naming the part.
- Part has no BOM lines → rejected (mirror of the picker rule).
- `Quantity <= 0` → rejected (also a DB CHECK constraint).
- Clamp floor: reversals must never leave `QuantityAllocated < 0`; if the math
  would, reject rather than clamp silently (data inconsistency should be loud).

**Missing inventory rows:** completing an order for a part with no Inventory
row (Tractor today) creates the row (`OnHand = Quantity`, others 0).
Allocation against a component with no row also creates one (`OnHand = 0`,
`Allocated = required`) — same "row on demand" rule everywhere.

### Edge cases (explicit)

- **Edit qty on a complete order:** reverse consumption/receipt at the old
  qty, re-apply completion at the new qty (with shortage check on the delta
  path — the reverse-then-apply model handles this uniformly).
- **Reopen complete when FG already consumed elsewhere:** rejected 400 (FG
  OnHand would go negative).
- **Blocked still allocates:** yes — blocked work is still planned demand.
- **Part change on edit:** full reverse of old part's effect, then re-apply
  with the new part. No delta math per component.

## 3. API changes

- `WorkOrderData` gains `PartId`, `Quantity`; response documents also carry
  `PartNumber` and `PartName` (joined from Parts) for display.
- `CreateWorkOrderRequest` / `UpdateWorkOrderRequest` gain `PartId`,
  `Quantity` (required).
- New endpoint: `GET /api/parts/buildable` → parts having ≥1 BOM line:
  `[{ partId, partNumber, name, defaultWorkCenterId }]`. `[Authorize]`, no
  write policy needed.
- Planning endpoint unchanged — it already returns `QuantityAllocated`.
- Error contract for lifecycle guards: 400 with `message` and, for shortages,
  the `shortages` array above.

## 4. Frontend changes

- **Work-order panel:** required Part ng-select (from `/parts/buildable`) and
  Quantity number input (> 0, integer step). Selecting a part defaults the
  work-center select to the part's `defaultWorkCenterId` (user can override).
  API 400s (shortage list, reversal block) render as the panel's error state,
  listing each short component.
- **Timeline:** bar tooltip shows part name + quantity. CSV export gains
  `Part` and `Quantity` columns.
- **Planning grid:** add **Allocated** column (between Available and On Order
  or as fits the existing layout); include in the grid CSV export. Data is
  already present in the API response and, if present, the TS model —
  otherwise extend the model.
- Models in `models/work-orders.models.ts` extended to match the wire shape.

## 5. Seed data

All orders reference real parts. Two work centers carry the schedule
(Final Assembly, Wheel Build Line); other centers have empty rows — accepted
consequence of PartId NOT NULL + BOM-only.

### Work orders

| Id | Name | PartId | Qty | WC | Status | Dates |
|----|------|--------|-----|----|--------|-------|
| wo-001 | Wheel Assembly Batch 1 | part-wheel-assembly | 10 | wc-005 | complete | 2025-09-01 → 2025-09-20 |
| wo-002 | Tractor Pilot Build | part-tractor-1000 | 2 | wc-003 | complete | 2025-10-01 → 2025-11-15 |
| wo-003 | Wheel Assembly Batch 2 | part-wheel-assembly | 8 | wc-005 | in-progress | 2025-12-01 → 2026-02-10 |
| wo-004 | Tractor Production Run A | part-tractor-1000 | 4 | wc-003 | open | 2026-01-05 → 2026-03-20 |
| wo-005 | Wheel Assembly Batch 3 | part-wheel-assembly | 6 | wc-005 | open | 2026-03-01 → 2026-04-10 |
| wo-006 | Tractor Production Run B | part-tractor-1000 | 2 | wc-003 | blocked | 2026-04-01 → 2026-05-15 |

This seeds the closed-loop demo story: wheels were built (complete), more are
in flight, and open/blocked tractor orders have allocated the stock.

### Inventory (final state, all three effects reconciled)

The seed inventory is a **full rewrite with an intentional baseline** — it
does not derive from the old Planning.sql numbers. The baseline ("stock as
procured, before any seeded order ran") is chosen so that after applying the
two completed orders, every part's Available stays ≥ 0 and the demo story is
clean. The table below is the derivation; the **Seed OnHand / Allocated**
columns are what Planning.sql actually inserts.

Completed-order deltas: wo-001 (wheel ×10): tire −10, rim −10, wheel +10.
wo-002 (tractor ×2): frame/engine/seat/hydraulic/control −2 each, wheel −8,
tractor +2.

Allocated = Σ open/in-progress/blocked explosions:
tire 14 (8+6), rim 14 (8+6), frame 6 (4+2), engine 6, seat 6, hydraulic 6,
control-panel 6, wheel-assembly 24 (4×4 + 4×2).

| Part | Baseline | wo-001 Δ | wo-002 Δ | Seed OnHand | Allocated | Available |
|------|----------|----------|----------|-------------|-----------|-----------|
| part-frame-assembly | 10 | | −2 | 8 | 6 | 2 |
| part-engine-diesel | 10 | | −2 | 8 | 6 | 2 |
| part-wheel-assembly | 28 | +10 | −8 | 30 | 24 | 6 |
| part-seat-cab | 11 | | −2 | 9 | 6 | 3 |
| part-hydraulic-kit | 9 | | −2 | 7 | 6 | 1 |
| part-control-panel | 9 | | −2 | 7 | 6 | 1 |
| part-tire-26 | 34 | −10 | | 24 | 14 | 10 |
| part-rim-26 | 30 | −10 | | 20 | 14 | 6 |
| part-tractor-1000 | 0 | | +2 | 2 | 0 | 2 |

OnOrder values carry over unchanged (engine 4, hydraulic 6, control-panel 2,
tire 12, rim 8); the tractor row is **new** (OnOrder 0, SafetyStock 0).

Planning at target 10 (Tractor): Buildable Now = 1 (wheel Available 6 ÷ 4 per
tractor), shortages on every component. **Demo:** completing Wheel Assembly
Batch 2 (×8) adds 8 to wheel OnHand and releases the batch's tire/rim
allocations; wheel Allocated (24, all tractor demand) is untouched, so
wheel-assembly Available rises from 6 to 14 and its shortage at target 10
drops from 34 to 26. (Overall Buildable Now stays at 1 — hydraulic and
control-panel are still the binding constraints — the demo point is the grid
reacting live, not a buildability jump.)

## 6. Documentation deliverables

- `docs/prd.md` — product requirements: what the app does, the two views, the
  production-order lifecycle, roles/permissions.
- `docs/tasks.md` — implementation task checklist for this feature (kept in
  sync as work proceeds).
- `docs/architecture.md` — stack, API surface, schema (incl. new columns),
  the inventory lifecycle service, and the WO ↔ planning data flow.
- README setup instructions updated for the new script order / migration.

## 7. Testing

- **Backend:** unit/integration tests for `WorkOrderInventoryService` — each
  lifecycle row in the table above, each guard (shortage 400 payload shape,
  negative-reversal block, no-BOM rejection, qty ≤ 0), row-on-demand creation,
  and edit-as-reverse-then-apply (qty change, part change, complete→edit).
- **Frontend:** panel spec tests for part/qty validation, work-center
  defaulting, and shortage-error rendering; existing timeline/CSV specs
  extended for the new columns.
- **Manual demo script:** create tractor order → planning Available drops;
  complete wheel batch → tractor buildability rises; try to complete a short
  tractor order → blocked with named shortages; delete → planning recovers.
