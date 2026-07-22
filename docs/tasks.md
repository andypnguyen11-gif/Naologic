# Implementation Task Checklist — Work Order & Planning Integration

Source of truth for **what** to build (behavior, schema, lifecycle rules,
seed data) is the design spec:
[`docs/superpowers/specs/2026-07-21-work-order-planning-integration-design.md`](superpowers/specs/2026-07-21-work-order-planning-integration-design.md).

Source of truth for **sequencing** (task order, file lists, commit points) is
the implementation plan:
[`docs/superpowers/plans/2026-07-21-work-order-planning-integration.md`](superpowers/plans/2026-07-21-work-order-planning-integration.md).

If the plan and the spec ever disagree, the spec wins.

---

## Task 1: Database scripts — split, reseed, migrate

**Files:** `api/database/NaologicDb.sql` (modify), `api/database/Planning.sql`
(modify, inventory seed), `api/database/WorkOrders.sql` (create),
`api/database/Migration_WorkOrderParts.sql` (create), `README.md` (modify,
Database setup section).

- [x] `NaologicDb.sql` reduced to `CREATE DATABASE` + `WorkCenters` (renamed)
      only — `WorkOrders` moved out because its new FK to `Parts` requires
      `Planning.sql` to have run first.
- [x] `Planning.sql` inventory seed replaced with the reconciled spec §5
      values (`inv-001`…`inv-009`, including the new tractor row).
- [x] `WorkOrders.sql` created: `WorkOrders` table with `PartId`/`Quantity`
      columns, FKs, and `CHECK` constraints, plus the six seeded orders
      (`wo-001`…`wo-006`).
- [x] `Migration_WorkOrderParts.sql` created for the already-deployed
      Railway DB (nullable-add → reseed → tighten → reconcile inventory).
- [x] README "Database setup" section documents the required script order.

## Task 2: Test project + InventoryPlanner (create-path effects)

**Files:** `api.Tests/Naologic-API.Tests.csproj` (create), `api.Tests/InventoryPlannerTests.cs`
(create), `api/Services/InventoryPlanner.cs` (create), `Naologic.sln` (modify).

- [x] xUnit test project scaffolded and added to the solution.
- [x] `InventoryPlanner.PlanTransition` implemented: pure lifecycle math with
      no SQL — reverse the old order's effect, apply the new order's effect,
      validate the result (shortage check, negative guard).
- [x] Create-path tests: allocate on open/in-progress/blocked, consume +
      receive on complete, shortage payload shape, missing-inventory-row
      handling.

## Task 3: InventoryPlanner transition + guard tests

**Files:** `api.Tests/InventoryPlannerTests.cs` (modify, append tests).

- [x] Every row of the spec §2 lifecycle table covered by a test: open→complete,
      reopen (complete→open), delete (non-complete and complete), quantity
      edit, part-change edit, quantity edit on a complete order.
- [x] Every guard covered: reversal driving allocation negative, completion
      shortage after reversal.

## Task 4: API models, validators, and read path

**Files:** `api/Models/WorkOrders/WorkOrderModels.cs` (modify),
`api/Validation/WorkOrderValidators.cs` (modify),
`api/Repositories/WorkOrdersRepository.cs` (modify).

- [x] `WorkOrderData`, `CreateWorkOrderRequest`, `UpdateWorkOrderRequest` gain
      `PartId`/`Quantity`; responses also carry `PartNumber`/`PartName`.
- [x] Validator requires `PartId` and rejects `Quantity <= 0`.
- [x] `WorkOrdersRepository` is read-only (`GetWorkCentersAsync`,
      `GetWorkOrdersAsync` now joined to `Parts`); mutation methods removed —
      they moved into `WorkOrderInventoryService` in Task 5.

## Task 5: WorkOrderInventoryService + controller wiring

**Files:** `api/Services/WorkOrderInventoryService.cs` (create),
`api/Controllers/WorkOrdersController.cs` (modify), `api/Program.cs`
(modify, DI).

- [x] `WorkOrderInventoryService` created: loads order/BOM/inventory state
      under `UPDLOCK`, calls `InventoryPlanner`, applies deltas and the
      order-row mutation inside one SQL transaction. Creates inventory rows
      on demand.
- [x] `WorkOrdersController` routes `POST`/`PUT`/`DELETE` through the
      service and maps `PlanError` to a 400 response with
      `{ message, shortages? }`.
- [x] `WorkOrderInventoryService` and `PartsRepository` registered in DI.

## Task 5b: WorkOrderInventoryService integration tests (DB-backed)

**Files:** `api.Tests/WorkOrderInventoryServiceTests.cs` (create).

- [x] DB-backed tests for the transactional executor (create/allocate +
      delete/restore round-trip, complete + consume/receive + reverse,
      shortage rollback leaves no trace, update reverses-then-applies).
      Gated on the `NAOLOGIC_TEST_DB` environment variable so `dotnet test`
      stays green without a database attached.

## Task 6: Buildable-parts endpoint

**Files:** `api/Models/Parts/PartModels.cs` (create),
`api/Repositories/PartsRepository.cs` (create),
`api/Controllers/PartsController.cs` (create), `api/Program.cs` (modify, DI).

- [x] `GET /api/parts/buildable` returns parts with at least one BOM line —
      `[{ partId, partNumber, name, defaultWorkCenterId }]` — `[Authorize]`,
      no write policy required.

## Task 7: Frontend models + services

**Files:** `frontend/src/app/models/work-orders.models.ts` (modify),
`frontend/src/app/services/work-orders.service.ts` (modify).

- [x] `WorkOrderData` extended with `partId`/`quantity`/`partNumber?`/`partName?`;
      new `BuildablePart`, `WorkOrderShortage`, `WorkOrderErrorBody` types.
- [x] `WorkOrdersService` sends the new fields on create/update and exposes
      `getBuildableParts()`.

## Task 8: Work-order panel — part, quantity, work center

**Files:** `frontend/src/app/pages/work-orders/panel/work-order-panel/work-order-panel.ts`
(modify), `.html` (modify), `.spec.ts` (modify/test).

- [x] Panel gains `buildableParts`/`workCenters`/`defaultWorkCenterId`
      inputs, a required part select and quantity input; selecting a part
      defaults the work-center select to that part's default work center
      (user can still override it).
- [x] Submit event value carries `partId`/`quantity`/`workCenterId`.

## Task 9: Page wiring, shortage errors, timeline tooltip + CSV

**Files:** `frontend/src/app/pages/work-orders/work-orders-page/work-orders-page.ts`
(modify), `.html` (modify), `frontend/src/app/pages/work-orders/timeline/timeline.ts`
(modify), `.html` (modify), `work-orders-page.spec.ts` (modify/test).

- [x] Page loads buildable parts alongside work centers/orders and passes
      them into the panel; API 400 shortage/error bodies render in the
      panel's error state.
- [x] Timeline bar tooltip shows part name and quantity (e.g. "Wheel
      Assembly × 8").
- [x] CSV export gains Part and Quantity columns.

## Task 10: Planning grid Allocated column

**Files:** `frontend/src/app/pages/planning/planning-page/planning-page.html`
(modify), `frontend/src/app/pages/planning/planning-page/planning-page.ts`
(modify).

- [x] Grid gains an **Allocated** column (`quantityAllocated`, already
      present in the API response and TS model) between Available and On
      Order.
- [x] Grid CSV export includes the Allocated column.

## Task 11: Documentation — prd.md, tasks.md, architecture.md, README

**Files:** `docs/prd.md` (create), `docs/tasks.md` (create),
`docs/architecture.md` (create), `README.md` (modify, feature bullets).

- [x] `docs/prd.md` written: overview, roles, Work Orders view, the
      production-order lifecycle, Planning view, out-of-scope list.
- [x] `docs/tasks.md` (this file) written.
- [x] `docs/architecture.md` written: stack, API surface table, schema,
      inventory lifecycle internals, WO ↔ planning data flow.
- [x] `README.md` feature bullets updated for part/quantity selection and
      live planning reaction to work-order lifecycle changes; Database setup
      section (added in Task 1) preserved.

## Task 12: End-to-end verification

**Files:** none (verification only; fix regressions where found).

- [x] Full builds and test suites green (`dotnet build`/`dotnet test`,
      `npm run build`/`npm test`), including the DB-backed integration
      tests when a disposable test database is available.
- [x] Manual API smoke test against the demo script in spec §7 (buildable
      parts list, baseline planning numbers, create/complete/shortage/
      reverse flow, planning numbers returning to baseline).
- [x] Browser sanity pass (optional but recommended).
- [x] Any regressions found are fixed and committed.

Outcome: backend 19/19 (incl. live-DB integration run), frontend 26/26
Karma, spec §7 API smoke all-green incl. shortage rollback and baseline
restore.
