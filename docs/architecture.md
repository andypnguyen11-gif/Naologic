# Architecture — Work Order & Planning Integration

## Stack

- **Frontend:** Angular 20, standalone components (no `NgModule`s), using
  `@Input()`/`@Output()` rather than signal-based component APIs. Reactive
  forms for the work-order panel. `ng-select` for searchable dropdowns
  (part/work-center pickers), `@ng-bootstrap/ng-bootstrap` for the date
  picker, and `highcharts` (via `highcharts-angular`) for the planning
  charts. Karma/Jasmine for unit tests.
- **Backend:** ASP.NET Core targeting `net10.0`. Data access is raw ADO.NET
  via `Microsoft.Data.SqlClient` — no Entity Framework or other ORM;
  repositories and services hand-write SQL and map `SqlDataReader` rows to
  records directly.
- **Database:** SQL Server (Microsoft SQL Server, e.g. `mssql:2022` in
  Docker for local/test use).
- **Auth:** JWT bearer tokens issued by `AuthController`/`JwtTokenService`,
  validated by ASP.NET Core's `AddJwtBearer` middleware. Roles are carried
  as claims and checked via ASP.NET Core `[Authorize(Roles = ...)]` and a
  named authorization policy.
- **Deployment:** Railway, both the Angular frontend and the ASP.NET Core
  API as separate services, against a Railway-hosted SQL Server database.
  See the README's "Live Deployment" section for URLs and the admin test
  account.

## API surface

All endpoints are under `/api` and require a valid JWT (`[Authorize]`)
unless noted. Work-order mutations additionally require the
**`PlannerWriteAccess`** policy (roles `Admin` or `Planner`); admin
endpoints require the `Admin` role.

| Method & path | Auth | Description |
|---|---|---|
| `POST /api/auth/signup` | none | Create a new account (always created with the `Admin` role today) and return a JWT + user profile. |
| `POST /api/auth/login` | none | Authenticate and return a JWT + user profile. |
| `GET /api/auth/me` | any authenticated user | Return the current user's profile from the token's identity claim. |
| `GET /api/work-centers` | any authenticated user | List all work centers (`WorkCenterDocument[]`). |
| `GET /api/work-orders` | any authenticated user | List all work orders, joined to `Parts` for display (`WorkOrderDocument[]`, includes `partNumber`/`partName`). |
| `POST /api/work-orders` | `PlannerWriteAccess` | Create a work order. Body: `CreateWorkOrderRequest` (`name`, `workCenterId`, `status`, `startDate`, `endDate`, `partId`, `quantity`). Runs the full inventory-allocation lifecycle transactionally. `201` with the created document, `400` on validation failure or a lifecycle guard (see below). |
| `PUT /api/work-orders/{id}` | `PlannerWriteAccess` | Update a work order. Body: `UpdateWorkOrderRequest` (same shape as create). Reverses the order's old inventory effect and re-applies the new state in one transaction. `200` with the updated document, `404` if the id doesn't exist, `400` on validation/guard failure. |
| `DELETE /api/work-orders/{id}` | `PlannerWriteAccess` | Delete a work order, reversing its inventory effect first. `204` on success, `404` if the id doesn't exist, `400` if the reversal would drive a quantity negative. |
| `GET /api/parts/buildable` | any authenticated user | List parts that have at least one BOM line — the only parts orderable as work orders. `[{ partId, partNumber, name, defaultWorkCenterId }]`. |
| `GET /api/planning/component-gaps?partId&targetQty` | any authenticated user | BOM explosion for `partId` at `targetQty`: one row per direct BOM component with required/on-hand/allocated/on-order/available/shortage/ready-days. `400` if `partId` is blank or `targetQty <= 0`. |
| `GET /api/admin/users` | `Admin` | List all user accounts. |
| `PUT /api/admin/users/update-roles` | `Admin` | Bulk-update user roles; rejects unrecognized role values with a 400. |

### Document wire shape

Work-center and work-order responses (and requests that echo them back) use a
consistent envelope:

```json
{ "docId": "wo-004", "docType": "workOrder", "data": { "...": "..." } }
```

`GET /api/parts/buildable` and `GET /api/planning/component-gaps` are the two
endpoints that do **not** use this envelope — they return flat arrays of
objects (`BuildablePartDocument`, `ComponentGapDocument`) directly, matching
their existing/previous shape.

### Shortage error payload (400)

Every lifecycle guard failure from a work-order mutation returns HTTP 400
with the same body shape:

```json
{
  "message": "Cannot complete: insufficient component inventory.",
  "shortages": [
    { "partId": "part-frame-assembly", "partName": "Frame Assembly", "requiredQty": 9, "onHand": 8, "shortBy": 1 }
  ]
}
```

`shortages` is `null`/omitted for guards that are not stock shortages (e.g.
"Unknown part.", "Selected part has no bill of materials and cannot be
produced.", or a reversal-would-go-negative message that names the part in
`message` instead).

## Schema

All tables live in the single `NaologicDb` database.

**`WorkCenters`**

| Column | Type | Notes |
|---|---|---|
| `WorkCenterId` | `NVARCHAR(50)` | Primary key. |
| `Name` | `NVARCHAR(200)` | e.g. "Final Assembly", "Wheel Build Line". |

**`Parts`**

| Column | Type | Notes |
|---|---|---|
| `PartId` | `NVARCHAR(50)` | Primary key. |
| `PartNumber` | `NVARCHAR(50)` | Display part number, e.g. `FG-1000`. |
| `Name` | `NVARCHAR(200)` | |
| `PartType` | `NVARCHAR(30)` | `CHECK IN ('finished-good','assembly','manufactured','purchased')`. |
| `DefaultWorkCenterId` | `NVARCHAR(50)` | Nullable FK → `WorkCenters`; drives the work-order panel's WC default. |
| `StandardBuildDays` | `INT` | Used for `ProjectedReadyDays` on manufactured/assembly/finished-good parts. |
| `StandardLeadDays` | `INT` | Used for `ProjectedReadyDays` on purchased parts. |
| `UnitCost` | `DECIMAL(12,2)` | Not currently surfaced in the UI. |

**`BillOfMaterials`**

| Column | Type | Notes |
|---|---|---|
| `BomId` | `NVARCHAR(50)` | Primary key. |
| `ParentPartId` | `NVARCHAR(50)` | FK → `Parts`; the part being built. |
| `ComponentPartId` | `NVARCHAR(50)` | FK → `Parts`; a required component. |
| `QuantityPer` | `DECIMAL(12,2)` | `CHECK > 0`. Units of the component per one unit of the parent. |

A part is "buildable" (orderable as a work order) exactly when at least one
`BillOfMaterials` row has it as `ParentPartId`.

**`Inventory`**

| Column | Type | Notes |
|---|---|---|
| `InventoryId` | `NVARCHAR(50)` | Primary key. |
| `PartId` | `NVARCHAR(50)` | FK → `Parts`. Not unique at the schema level, but the app treats it as one row per part, creating a new row on demand only when none exists. |
| `QuantityOnHand` | `DECIMAL(12,2)` | Physical stock. Mutated by the work-order lifecycle. |
| `QuantityAllocated` | `DECIMAL(12,2)` | Soft-reserved by open/in-progress/blocked work orders. |
| `QuantityOnOrder` | `DECIMAL(12,2)` | Incoming supply; not mutated by this feature. |
| `SafetyStock` | `DECIMAL(12,2)` | Not currently surfaced beyond the raw seed value. |

**`ProductionDemand`** (legacy — unused by this feature; kept for schema
compatibility, `DemandId`, `ProductPartId` FK → `Parts`, `DemandMonth`,
`QuantityRequired`).

**`WorkOrders`** (this feature's schema change)

| Column | Type | Notes |
|---|---|---|
| `WorkOrderId` | `NVARCHAR(50)` | Primary key. |
| `Name` | `NVARCHAR(200)` | |
| `WorkCenterId` | `NVARCHAR(50)` | FK → `WorkCenters`. |
| **`PartId`** | `NVARCHAR(50)` | **New.** FK → `Parts`. `NOT NULL` — every work order is a production order; there is no part-less order. |
| **`Quantity`** | `DECIMAL(12,2)` | **New.** `NOT NULL`, `CHECK (Quantity > 0)`. |
| `Status` | `NVARCHAR(50)` | `CHECK IN ('open','in-progress','complete','blocked')`. |
| `StartDate` / `EndDate` | `DATE` | |

**`Users`**

| Column | Type | Notes |
|---|---|---|
| `UserId` | `UNIQUEIDENTIFIER` | Primary key, `DEFAULT NEWID()`. |
| `Email` | `NVARCHAR(255)` | Unique index (`UX_Users_Email`). |
| `PasswordHash` | `NVARCHAR(500)` | ASP.NET Core Identity `PasswordHasher` output. |
| `FirstName` / `LastName` | `NVARCHAR(100)` | |
| `Role` | `NVARCHAR(50)` | `CHECK IN ('Admin','Planner','Viewer')`. |
| `IsActive` | `BIT` | `DEFAULT 1`. |
| `CreatedAt` | `DATETIME2` | `DEFAULT SYSUTCDATETIME()`. |

### Script run order

Because `WorkOrders.PartId` is a foreign key to `Parts`, the setup scripts
must run in this order (fresh install):

1. `api/database/NaologicDb.sql` — creates the database and `WorkCenters` only.
2. `api/database/Planning.sql` — `Parts`, `BillOfMaterials`, `Inventory`,
   `ProductionDemand`, and their seed data (so `Parts` exists before
   `WorkOrders` references it).
3. `api/database/WorkOrders.sql` — `WorkOrders` table + the six seeded
   orders.
4. `api/database/Users.sql` — auth tables and the admin account.

### Migration for a pre-existing database

`api/database/Migration_WorkOrderParts.sql` upgrades an already-deployed
database (e.g. Railway) that still has the old part-less `WorkOrders` schema.
SQL Server rejects `ALTER TABLE ... ADD col NOT NULL` on a non-empty table
without a default, so the migration proceeds in steps: rename the work
centers → add `PartId`/`Quantity` as nullable → delete the legacy seed rows
and insert the new production-order seed set → tighten both columns to
`NOT NULL` and add the FK/CHECK constraints → reconcile the `Inventory`
table to the spec §5 values (including inserting the previously-absent
`part-tractor-1000` row). This script is meant to be run once against a
target database and is not idempotent against itself.

## Inventory lifecycle

Two collaborating pieces own the entire feature's business logic:

### `InventoryPlanner` (`api/Services/InventoryPlanner.cs`)

A static class with a single pure function,
`PlanTransition(oldState, newState, bomByParent, inventory, partNames)`,
that contains **all** inventory math and **no SQL**. Every lifecycle
operation — create, edit, status change, delete — is modeled uniformly as:

1. If there is an old order state, reverse its effect (sign = −1).
2. If there is a new order state, apply its effect (sign = +1).
3. If the new state's status is `complete`, run the shortage check against
   the resulting on-hand quantity for each component.
4. Run a generic guard: no accumulated delta may drive any part's `OnHand`
   or `Allocated` below zero.
5. Return either a `PlanResult.Success` with a map of `PartId → InventoryDelta`
   (only for parts that actually changed), or a `PlanResult.Failure` with a
   `PlanError` (`Message` plus an optional `Shortages` list).

An order's "effect" depends on its status: non-complete orders
(`open`/`in-progress`/`blocked`) only touch `Allocated` on the part's BOM
components (`QuantityPer × Quantity` each); a `complete` order instead
reduces `OnHand` on those same components and increases `OnHand` on the
order's own part (the finished good) by the order quantity. Because "create"
is just "reverse nothing, apply new" and "delete" is "reverse old, apply
nothing," and "edit" (including a part change) is "reverse old, apply new,"
one function correctly implements every row of the lifecycle table below.

The shortage check compares against **on-hand, not available**, quantity: a
completing order's own allocation release is already folded into the
accumulated deltas by the time the check runs, so checking on-hand avoids
double-counting the order's own reservation against itself. Other orders'
allocations do not block this order's completion — this is standard
backflush-style semantics, not a bug, and the code comments explicitly warn
against "fixing" it to compare against `Available`.

`InventoryPlanner` is covered by `api.Tests/InventoryPlannerTests.cs`, which
exercises every row of the lifecycle table below plus every guard (shortage
payload shape, negative-reversal rejection, missing-inventory-row handling
treated as zero).

### `WorkOrderInventoryService` (`api/Services/WorkOrderInventoryService.cs`)

The transactional executor and the only place that mutates `WorkOrders` or
`Inventory` rows. For every `CreateAsync`/`UpdateAsync`/`DeleteAsync` call it:

1. Opens a connection and begins a `SqlTransaction`.
2. For update/delete, loads the order's current state with
   `SELECT ... FROM WorkOrders WITH (UPDLOCK) WHERE WorkOrderId = @id` — the
   update lock prevents a concurrent mutation of the same order from racing
   inside the transaction.
3. For create/update, validates references: the work center exists, the
   part exists, and the part has at least one BOM line (mirroring the
   picker's buildable-parts rule server-side).
4. Loads the BOM lines for the old and/or new part, then loads
   `Inventory WITH (UPDLOCK)` rows for every affected part (both parents and
   components) in one `IN (...)` query, plus their display names.
5. Calls `InventoryPlanner.PlanTransition` with that state.
6. On success, applies every returned delta with an
   `UPDATE Inventory SET QuantityOnHand += @onHand, QuantityAllocated += @allocated WHERE PartId = @partId`;
   if the `UPDATE` affects zero rows (no inventory row exists yet for that
   part), it inserts a fresh row with those values instead — the "row on
   demand" rule the design spec calls out, applied identically whether the
   part is a component or a finished good.
7. Writes the actual `WorkOrders` row change (`INSERT`/`UPDATE`/`DELETE`).
8. Commits the transaction and returns a `WorkOrderMutationResult` (the
   built document, or a `PlanError`, or a not-found flag).

Any guard failure (unknown work center/part, no BOM, shortage, negative
guard) returns before the transaction commits, so the `using`/`await using`
disposal rolls the transaction back automatically — no partial writes ever
reach the database on a rejected mutation. `WorkOrdersController` maps a
`WorkOrderMutationResult` with a non-null `Error` to
`400 { message, shortages }`, a `NotFound` result to `404`, and otherwise
returns `201`/`200`/`204` as appropriate.

`WorkOrderInventoryServiceTests.cs` (`api.Tests/`) exercises the executor
end-to-end against a real SQL Server: allocate-then-restore round trips,
complete-then-reverse round trips, and a shortage attempt that verifies
*nothing* was written (no order row, no inventory movement). These tests
read their connection string from the `NAOLOGIC_TEST_DB` environment
variable and no-op when it is unset, so `dotnet test` stays green on a
machine without a database; they are meant to be run for real against a
disposable, seeded SQL Server instance (never against the Railway
production database).

### Lifecycle table (from the design spec, §2)

| Action | Inventory effect |
|---|---|
| Create with status `open` / `in-progress` / `blocked` | Component `QuantityAllocated += required` |
| Create with status `complete` | Shortage check, then component `OnHand −= required`; finished good `OnHand += Quantity` |
| Edit (any field) | Fully reverse the old order's effect, then apply the new state as if created fresh |
| Status → `complete` | Shortage check; components `OnHand −= required`, `Allocated −= required`; finished good `OnHand += Quantity` |
| Reopen (`complete` → other) | Reverse completion: components `OnHand += required`, `Allocated += required`; finished good `OnHand −= Quantity` |
| Delete (non-complete) | Component `Allocated −= required` |
| Delete (complete) | Reverse completion (as reopen), without re-allocating |

Where `required = QuantityPer × Quantity` for each of the part's direct BOM
lines.

## WO ↔ Planning data flow

There is no separate sync mechanism between work orders and the planning
view — they read and write the same `Inventory` table:

1. A work-order mutation (create/update/delete, via
   `WorkOrderInventoryService`) moves `Inventory.QuantityOnHand` and/or
   `Inventory.QuantityAllocated` for the affected parts, inside one
   transaction, as described above.
2. `GET /api/planning/component-gaps?partId&targetQty`
   (`PlanningRepository.GetComponentGapsAsync`) computes, per BOM component
   of the target part: `QuantityRequired = QuantityPer × targetQty`,
   `QuantityAvailable = QuantityOnHand − QuantityAllocated`, and
   `Shortage = MAX(0, QuantityRequired − QuantityAvailable)` — reading
   straight from the current `Inventory` row (via a `LEFT JOIN`, defaulting
   to zero when no row exists yet).
3. The Angular planning page (`PlanningPage`) calls this endpoint on load
   and whenever the target product or target quantity filter changes; there
   is no push/websocket channel, so the grid and charts reflect whatever was
   true in `Inventory` at the moment of the last `GET` — a work-order change
   made in another tab is picked up on the next reload/filter change, not
   automatically.

Because `QuantityAllocated` is exactly what work orders reserve and
`QuantityOnHand` is exactly what completions consume/receive, the planning
grid's Allocated column is a direct, unmediated view of live work-order
demand: creating a tractor order raises the Allocated figure on every one of
its components in the same request that created the order; completing a
wheel-assembly batch raises `OnHand` (and lowers the wheel's own Allocated,
since its own reservation is released) in the same request that completed
it.
