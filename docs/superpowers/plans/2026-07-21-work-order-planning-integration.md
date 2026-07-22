# Work Order ↔ Planning Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make work orders behave like thin production orders — part + quantity on every order, single-level BOM explosion, and a transactional allocate / consume+receive / reverse lifecycle that the planning view reacts to.

**Architecture:** A new pure static class `InventoryPlanner` computes inventory deltas (or guard errors) for any lifecycle transition; a new `WorkOrderInventoryService` loads state and applies deltas inside one SQL transaction and owns all work-order mutations. The controller maps planner errors to HTTP 400 with a structured shortage payload. The frontend panel gains part/quantity/work-center selects fed by a new `GET /api/parts/buildable` endpoint, and the planning grid gains an Allocated column.

**Tech Stack:** ASP.NET Core (net10.0) with raw ADO.NET (`Microsoft.Data.SqlClient`), xUnit (new test project), Angular 20 standalone components with ng-select and Karma/Jasmine, SQL Server.

**Authoritative spec:** `docs/superpowers/specs/2026-07-21-work-order-planning-integration-design.md`. If this plan and the spec disagree, the spec wins.

## Global Constraints

- Statuses are exactly `open`, `in-progress`, `complete`, `blocked`. Allocation applies to `open`/`in-progress`/`blocked`; consumption+receipt applies to `complete` only.
- `WorkOrders.PartId` is `NVARCHAR(50) NOT NULL` FK → `Parts(PartId)`; `Quantity` is `DECIMAL(12,2) NOT NULL` with `CHECK (Quantity > 0)`.
- Only parts with ≥ 1 BOM line are orderable — enforced server-side AND in the picker. Do not invent BOMs for other parts.
- Inventory may never go negative (OnHand or Allocated). Guards reject with HTTP 400 — never clamp silently.
- Shortage 400 payload shape: `{ message, shortages: [{ partId, partName, requiredQty, onHand, shortBy }] }` (camelCase on the wire).
- The completion shortage check compares **OnHand, not Available** (the order releases its own allocation in the same transaction — see spec §2).
- Every mutation (order row + inventory rows) runs in a single SQL transaction.
- Edits are **full reverse then re-apply** — no per-field delta math.
- Wire shape for documents stays `{ docId, docType, data: { ... } }` with camelCase JSON.
- API base URL locally: `http://localhost:5080/api`. Admin test account: `naologic.admin@example.com` / `NaoAdmin123!`.
- Seed data must match spec §5 exactly (work orders wo-001…wo-006; inventory table with OnHand/Allocated per part; tractor row `inv-009` OnHand 2).
- Backend test command: `dotnet test Naologic.sln`. Frontend test command: `cd frontend && npm test -- --watch=false --browsers=ChromeHeadless`. Frontend build: `cd frontend && npm run build`.
- **Testing is not optional.** Every behavioral change in this plan ships with automated tests: planner logic via unit tests, the SQL executor via DB-backed integration tests (gated on the `NAOLOGIC_TEST_DB` env var so CI/dev without a DB still passes), and frontend logic via Karma specs. The same standard applies to future features in this repo.
- Commit after every task (steps below include the commands).

## File Structure

| File | Responsibility |
|------|----------------|
| `api/database/NaologicDb.sql` (modify) | CREATE DATABASE + WorkCenters (renamed) only. WorkOrders moves out. |
| `api/database/Planning.sql` (modify) | Parts / BOM / Inventory / ProductionDemand; reconciled inventory seed incl. new tractor row. |
| `api/database/WorkOrders.sql` (create) | WorkOrders table (new columns + FKs + CHECKs) + 6 seed orders. Runs after Planning.sql. |
| `api/database/Migration_WorkOrderParts.sql` (create) | Idempotent-enough migration for the already-deployed Railway DB. |
| `api/Services/InventoryPlanner.cs` (create) | Pure lifecycle math: transition → deltas or `PlanError`. Zero SQL. |
| `api/Services/WorkOrderInventoryService.cs` (create) | Transactional executor: loads order/BOM/inventory, calls planner, applies deltas, mutates WorkOrders. |
| `api/Models/WorkOrders/WorkOrderModels.cs` (modify) | `PartId`/`Quantity` on data + requests; `PartNumber`/`PartName` on responses. |
| `api/Models/Parts/PartModels.cs` (create) | `BuildablePartDocument`. |
| `api/Repositories/WorkOrdersRepository.cs` (modify) | Read-only now (work centers + orders joined to Parts). Mutations move to the service. |
| `api/Repositories/PartsRepository.cs` (create) | Buildable-parts query. |
| `api/Controllers/WorkOrdersController.cs` (modify) | Route mutations through the service; map `PlanError` → 400 payload. |
| `api/Controllers/PartsController.cs` (create) | `GET /api/parts/buildable`. |
| `api/Validation/WorkOrderValidators.cs` (modify) | PartId required, Quantity > 0. |
| `api/Program.cs` (modify) | Register `WorkOrderInventoryService`, `PartsRepository`. |
| `api.Tests/Naologic-API.Tests.csproj` + `api.Tests/InventoryPlannerTests.cs` (create) | xUnit tests for the planner. |
| `api.Tests/WorkOrderInventoryServiceTests.cs` (create) | DB-backed integration tests for the executor (gated on `NAOLOGIC_TEST_DB`). |
| `frontend/src/app/models/work-orders.models.ts` (modify) | `partId`/`quantity`/`partNumber`/`partName`; `BuildablePart`; shortage error types. |
| `frontend/src/app/services/work-orders.service.ts` (modify) | Send new fields; `getBuildableParts()`. |
| `frontend/src/app/pages/work-orders/panel/work-order-panel/*` (modify) | Part select, quantity input, work-center select, WC defaulting; spec tests. |
| `frontend/src/app/pages/work-orders/work-orders-page/*` (modify) | Wire new inputs, use panel's work center, shortage error rendering, CSV Part/Quantity columns. |
| `frontend/src/app/pages/work-orders/timeline/*` (modify) | Tooltip part + quantity line. |
| `frontend/src/app/pages/planning/planning-page/*` (modify) | Allocated column in grid + grid CSV. |
| `docs/prd.md`, `docs/tasks.md`, `docs/architecture.md` (create), `README.md` (modify) | Documentation deliverables. |

---

### Task 1: Database scripts — split, reseed, migrate

**Files:**
- Modify: `api/database/NaologicDb.sql`
- Modify: `api/database/Planning.sql:83-93` (Inventory seed)
- Create: `api/database/WorkOrders.sql`
- Create: `api/database/Migration_WorkOrderParts.sql`
- Modify: `README.md` (database setup section)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the schema every later task assumes — `WorkOrders(WorkOrderId, Name, WorkCenterId, PartId, Quantity, Status, StartDate, EndDate)`, work-center names `Fabrication Line A / CNC Machining / Final Assembly / Quality Control / Wheel Build Line`, inventory rows `inv-001…inv-009` with the spec §5 values.

- [ ] **Step 1: Rewrite `api/database/NaologicDb.sql`** — WorkOrders moves out (its FK to Parts requires Planning.sql to run first). Replace the entire file with:

```sql
CREATE DATABASE NaologicDb;
GO

USE NaologicDb;
GO

CREATE TABLE WorkCenters (
    WorkCenterId NVARCHAR(50) NOT NULL PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL
);
GO

INSERT INTO WorkCenters (WorkCenterId, Name)
VALUES
('wc-001', 'Fabrication Line A'),
('wc-002', 'CNC Machining'),
('wc-003', 'Final Assembly'),
('wc-004', 'Quality Control'),
('wc-005', 'Wheel Build Line');
GO
```

- [ ] **Step 2: Update the Inventory seed in `api/database/Planning.sql`** — replace the existing `INSERT INTO Inventory ...` statement (currently lines 83–93) with the reconciled values from spec §5 (OnHand reflects the two completed seed orders; Allocated matches the open/in-progress/blocked explosions):

```sql
INSERT INTO Inventory (InventoryId, PartId, QuantityOnHand, QuantityAllocated, QuantityOnOrder, SafetyStock)
VALUES
('inv-001', 'part-frame-assembly', 8, 6, 0, 1),
('inv-002', 'part-engine-diesel', 8, 6, 4, 1),
('inv-003', 'part-wheel-assembly', 30, 24, 0, 2),
('inv-004', 'part-seat-cab', 9, 6, 0, 1),
('inv-005', 'part-hydraulic-kit', 7, 6, 6, 1),
('inv-006', 'part-control-panel', 7, 6, 2, 1),
('inv-007', 'part-tire-26', 24, 14, 12, 2),
('inv-008', 'part-rim-26', 20, 14, 8, 2),
('inv-009', 'part-tractor-1000', 2, 0, 0, 0);
GO
```

Leave the Parts, BillOfMaterials, and ProductionDemand sections untouched.

- [ ] **Step 3: Create `api/database/WorkOrders.sql`** (runs after Planning.sql — the FK needs Parts):

```sql
USE NaologicDb;
GO

CREATE TABLE WorkOrders (
    WorkOrderId NVARCHAR(50) NOT NULL PRIMARY KEY,
    Name NVARCHAR(200) NOT NULL,
    WorkCenterId NVARCHAR(50) NOT NULL,
    PartId NVARCHAR(50) NOT NULL,
    Quantity DECIMAL(12,2) NOT NULL,
    Status NVARCHAR(50) NOT NULL,
    StartDate DATE NOT NULL,
    EndDate DATE NOT NULL,
    CONSTRAINT FK_WorkOrders_WorkCenters
        FOREIGN KEY (WorkCenterId) REFERENCES WorkCenters(WorkCenterId),
    CONSTRAINT FK_WorkOrders_Parts
        FOREIGN KEY (PartId) REFERENCES Parts(PartId),
    CONSTRAINT CK_WorkOrders_Status
        CHECK (Status IN ('open', 'in-progress', 'complete', 'blocked')),
    CONSTRAINT CK_WorkOrders_Quantity
        CHECK (Quantity > 0)
);
GO

INSERT INTO WorkOrders (WorkOrderId, Name, WorkCenterId, PartId, Quantity, Status, StartDate, EndDate)
VALUES
('wo-001', 'Wheel Assembly Batch 1', 'wc-005', 'part-wheel-assembly', 10, 'complete', '2025-09-01', '2025-09-20'),
('wo-002', 'Tractor Pilot Build', 'wc-003', 'part-tractor-1000', 2, 'complete', '2025-10-01', '2025-11-15'),
('wo-003', 'Wheel Assembly Batch 2', 'wc-005', 'part-wheel-assembly', 8, 'in-progress', '2025-12-01', '2026-02-10'),
('wo-004', 'Tractor Production Run A', 'wc-003', 'part-tractor-1000', 4, 'open', '2026-01-05', '2026-03-20'),
('wo-005', 'Wheel Assembly Batch 3', 'wc-005', 'part-wheel-assembly', 6, 'open', '2026-03-01', '2026-04-10'),
('wo-006', 'Tractor Production Run B', 'wc-003', 'part-tractor-1000', 2, 'blocked', '2026-04-01', '2026-05-15');
GO
```

- [ ] **Step 4: Create `api/database/Migration_WorkOrderParts.sql`** for the already-deployed DB. SQL Server cannot `ADD ... NOT NULL` on a non-empty table, so the order is: add nullable → replace rows → tighten:

```sql
USE NaologicDb;
GO

-- 1. Work-center renames (IDs unchanged).
UPDATE WorkCenters SET Name = 'Fabrication Line A' WHERE WorkCenterId = 'wc-001';
UPDATE WorkCenters SET Name = 'CNC Machining' WHERE WorkCenterId = 'wc-002';
UPDATE WorkCenters SET Name = 'Final Assembly' WHERE WorkCenterId = 'wc-003';
UPDATE WorkCenters SET Name = 'Wheel Build Line' WHERE WorkCenterId = 'wc-005';
GO

-- 2. Add new columns as NULLABLE first: SQL Server rejects ADD ... NOT NULL
--    on a non-empty table without a default.
ALTER TABLE WorkOrders ADD
    PartId NVARCHAR(50) NULL,
    Quantity DECIMAL(12,2) NULL;
GO

-- 3. Replace the legacy seed orders with the production-order seed set.
DELETE FROM WorkOrders;
GO

INSERT INTO WorkOrders (WorkOrderId, Name, WorkCenterId, PartId, Quantity, Status, StartDate, EndDate)
VALUES
('wo-001', 'Wheel Assembly Batch 1', 'wc-005', 'part-wheel-assembly', 10, 'complete', '2025-09-01', '2025-09-20'),
('wo-002', 'Tractor Pilot Build', 'wc-003', 'part-tractor-1000', 2, 'complete', '2025-10-01', '2025-11-15'),
('wo-003', 'Wheel Assembly Batch 2', 'wc-005', 'part-wheel-assembly', 8, 'in-progress', '2025-12-01', '2026-02-10'),
('wo-004', 'Tractor Production Run A', 'wc-003', 'part-tractor-1000', 4, 'open', '2026-01-05', '2026-03-20'),
('wo-005', 'Wheel Assembly Batch 3', 'wc-005', 'part-wheel-assembly', 6, 'open', '2026-03-01', '2026-04-10'),
('wo-006', 'Tractor Production Run B', 'wc-003', 'part-tractor-1000', 2, 'blocked', '2026-04-01', '2026-05-15');
GO

-- 4. Tighten the schema now that every row has a part and quantity.
ALTER TABLE WorkOrders ALTER COLUMN PartId NVARCHAR(50) NOT NULL;
ALTER TABLE WorkOrders ALTER COLUMN Quantity DECIMAL(12,2) NOT NULL;
GO

ALTER TABLE WorkOrders ADD CONSTRAINT FK_WorkOrders_Parts
    FOREIGN KEY (PartId) REFERENCES Parts(PartId);
ALTER TABLE WorkOrders ADD CONSTRAINT CK_WorkOrders_Quantity
    CHECK (Quantity > 0);
GO

-- 5. Reconciled inventory (derivation in the design spec, section 5).
UPDATE Inventory SET QuantityOnHand = 8,  QuantityAllocated = 6  WHERE PartId = 'part-frame-assembly';
UPDATE Inventory SET QuantityOnHand = 8,  QuantityAllocated = 6  WHERE PartId = 'part-engine-diesel';
UPDATE Inventory SET QuantityOnHand = 30, QuantityAllocated = 24 WHERE PartId = 'part-wheel-assembly';
UPDATE Inventory SET QuantityOnHand = 9,  QuantityAllocated = 6  WHERE PartId = 'part-seat-cab';
UPDATE Inventory SET QuantityOnHand = 7,  QuantityAllocated = 6  WHERE PartId = 'part-hydraulic-kit';
UPDATE Inventory SET QuantityOnHand = 7,  QuantityAllocated = 6  WHERE PartId = 'part-control-panel';
UPDATE Inventory SET QuantityOnHand = 24, QuantityAllocated = 14 WHERE PartId = 'part-tire-26';
UPDATE Inventory SET QuantityOnHand = 20, QuantityAllocated = 14 WHERE PartId = 'part-rim-26';

IF NOT EXISTS (SELECT 1 FROM Inventory WHERE PartId = 'part-tractor-1000')
    INSERT INTO Inventory (InventoryId, PartId, QuantityOnHand, QuantityAllocated, QuantityOnOrder, SafetyStock)
    VALUES ('inv-009', 'part-tractor-1000', 2, 0, 0, 0);
GO
```

- [ ] **Step 5: Add a Database setup section to `README.md`** (after the "The database layer includes:" list). Insert:

```markdown
### Database setup

Run the SQL scripts against your SQL Server instance **in this order** (WorkOrders
has a foreign key to Parts, so Planning.sql must run before WorkOrders.sql):

1. `api/database/NaologicDb.sql` — creates the database and work centers
2. `api/database/Planning.sql` — parts, bill of materials, inventory, demand
3. `api/database/WorkOrders.sql` — work orders (references Parts)
4. `api/database/Users.sql` — auth tables and the admin account

For a database created before work orders carried a part and quantity (e.g. the
deployed Railway DB), run `api/database/Migration_WorkOrderParts.sql` once
instead of re-creating.
```

- [ ] **Step 6: Verify the fresh-install script order works.** If a disposable SQL Server is available (e.g. Docker):

Run:
```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=LocalTest123!" -p 14333:1433 -d --name naologic-sqltest mcr.microsoft.com/mssql/server:2022-latest
sleep 25
for f in NaologicDb.sql Planning.sql WorkOrders.sql Users.sql; do docker exec -i naologic-sqltest /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'LocalTest123!' -C -i /dev/stdin < api/database/$f; done
docker exec naologic-sqltest /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'LocalTest123!' -C -Q "USE NaologicDb; SELECT COUNT(*) FROM WorkOrders; SELECT QuantityOnHand, QuantityAllocated FROM Inventory WHERE PartId='part-wheel-assembly';"
docker rm -f naologic-sqltest
```
Expected: no errors; counts `6` and `30 / 24`. If Docker/sqlcmd is unavailable, note it and rely on the smoke test in Task 12.

- [ ] **Step 7: Commit**

```bash
git add api/database/NaologicDb.sql api/database/Planning.sql api/database/WorkOrders.sql api/database/Migration_WorkOrderParts.sql README.md
git commit -m "feat(db): add part+quantity to work orders with reconciled production seed"
```

---

### Task 2: Test project + InventoryPlanner (create-path effects)

**Files:**
- Create: `api.Tests/Naologic-API.Tests.csproj` (via `dotnet new`)
- Create: `api.Tests/InventoryPlannerTests.cs`
- Create: `api/Services/InventoryPlanner.cs`
- Modify: `Naologic.sln` (via `dotnet sln add`)

**Interfaces:**
- Consumes: nothing from other tasks (pure code).
- Produces (used by Tasks 3, 5):
  - `OrderState(string PartId, decimal Quantity, string Status)`
  - `BomLine(string ComponentPartId, decimal QuantityPer)`
  - `InventoryQuantities(decimal OnHand, decimal Allocated)` with `static InventoryQuantities Zero`
  - `InventoryDelta(decimal OnHand, decimal Allocated)`
  - `ShortageDetail(string PartId, string PartName, decimal RequiredQty, decimal OnHand, decimal ShortBy)`
  - `PlanError(string Message, IReadOnlyList<ShortageDetail>? Shortages = null)`
  - `PlanResult(IReadOnlyDictionary<string, InventoryDelta>? Deltas, PlanError? Error)`
  - `static PlanResult InventoryPlanner.PlanTransition(OrderState? oldState, OrderState? newState, IReadOnlyDictionary<string, IReadOnlyList<BomLine>> bomByParent, IReadOnlyDictionary<string, InventoryQuantities> inventory, IReadOnlyDictionary<string, string> partNames)`
  - All in namespace `Naologic_API.Services`.

- [ ] **Step 1: Scaffold the test project**

Run:
```bash
cd /Users/andynguyen/Desktop/Naologic
dotnet new xunit -o api.Tests -n Naologic-API.Tests
dotnet add api.Tests/Naologic-API.Tests.csproj reference api/Naologic-API.csproj
dotnet sln Naologic.sln add api.Tests/Naologic-API.Tests.csproj
rm api.Tests/UnitTest1.cs
```
Expected: project created and added to the solution without errors. If the generated project targets a different TFM than `net10.0`, edit `<TargetFramework>` in `api.Tests/Naologic-API.Tests.csproj` to `net10.0`.

- [ ] **Step 2: Write failing tests for create-path effects** — create `api.Tests/InventoryPlannerTests.cs`:

```csharp
using Naologic_API.Services;

namespace Naologic_API.Tests;

public class InventoryPlannerTests
{
    // Miniature BOM world: tractor = 1 frame + 4 wheels; wheel = 1 tire + 1 rim.
    private static readonly IReadOnlyDictionary<string, IReadOnlyList<BomLine>> Boms =
        new Dictionary<string, IReadOnlyList<BomLine>>
        {
            ["tractor"] = new List<BomLine> { new("frame", 1), new("wheel", 4) },
            ["wheel"] = new List<BomLine> { new("tire", 1), new("rim", 1) }
        };

    private static readonly IReadOnlyDictionary<string, string> Names =
        new Dictionary<string, string>
        {
            ["tractor"] = "Tractor",
            ["wheel"] = "Wheel Assembly",
            ["frame"] = "Frame",
            ["tire"] = "Tire",
            ["rim"] = "Rim"
        };

    private static Dictionary<string, InventoryQuantities> Stock(
        params (string PartId, decimal OnHand, decimal Allocated)[] rows) =>
        rows.ToDictionary(row => row.PartId, row => new InventoryQuantities(row.OnHand, row.Allocated));

    [Theory]
    [InlineData("open")]
    [InlineData("in-progress")]
    [InlineData("blocked")]
    public void Create_NonComplete_AllocatesComponents(string status)
    {
        var result = InventoryPlanner.PlanTransition(
            null,
            new OrderState("wheel", 8, status),
            Boms,
            Stock(("tire", 24, 14), ("rim", 20, 14)),
            Names);

        Assert.Null(result.Error);
        Assert.Equal(new InventoryDelta(0, 8), result.Deltas!["tire"]);
        Assert.Equal(new InventoryDelta(0, 8), result.Deltas!["rim"]);
        Assert.False(result.Deltas!.ContainsKey("wheel"));
    }

    [Fact]
    public void Create_Complete_ConsumesComponentsAndReceivesFinishedGood()
    {
        var result = InventoryPlanner.PlanTransition(
            null,
            new OrderState("wheel", 5, "complete"),
            Boms,
            Stock(("tire", 10, 0), ("rim", 10, 0)),
            Names);

        Assert.Null(result.Error);
        Assert.Equal(new InventoryDelta(-5, 0), result.Deltas!["tire"]);
        Assert.Equal(new InventoryDelta(-5, 0), result.Deltas!["rim"]);
        Assert.Equal(new InventoryDelta(5, 0), result.Deltas!["wheel"]);
    }

    [Fact]
    public void Create_Complete_WithShortage_FailsWithStructuredPayload()
    {
        var result = InventoryPlanner.PlanTransition(
            null,
            new OrderState("wheel", 5, "complete"),
            Boms,
            Stock(("tire", 3, 0), ("rim", 10, 0)),
            Names);

        Assert.Null(result.Deltas);
        Assert.NotNull(result.Error);
        var shortage = Assert.Single(result.Error!.Shortages!);
        Assert.Equal("tire", shortage.PartId);
        Assert.Equal("Tire", shortage.PartName);
        Assert.Equal(5, shortage.RequiredQty);
        Assert.Equal(3, shortage.OnHand);
        Assert.Equal(2, shortage.ShortBy);
    }

    [Fact]
    public void MissingInventoryRows_AreTreatedAsZero()
    {
        var allocate = InventoryPlanner.PlanTransition(
            null,
            new OrderState("wheel", 8, "open"),
            Boms,
            Stock(),
            Names);
        Assert.Null(allocate.Error);
        Assert.Equal(new InventoryDelta(0, 8), allocate.Deltas!["tire"]);

        var complete = InventoryPlanner.PlanTransition(
            null,
            new OrderState("wheel", 8, "complete"),
            Boms,
            Stock(),
            Names);
        Assert.NotNull(complete.Error);
        Assert.Equal(2, complete.Error!.Shortages!.Count);
        Assert.All(complete.Error.Shortages!, s => Assert.Equal(0, s.OnHand));
    }
}
```

- [ ] **Step 3: Run tests, verify they fail to compile**

Run: `dotnet test Naologic.sln`
Expected: compile errors — `InventoryPlanner`, `OrderState`, etc. do not exist yet.

- [ ] **Step 4: Implement `api/Services/InventoryPlanner.cs`** (the full transition algorithm — Task 3 only adds tests for the old-state paths):

```csharp
namespace Naologic_API.Services;

// Pure inventory math for work-order lifecycle transitions. No SQL here — the
// executor loads state, calls PlanTransition, and applies the returned deltas
// inside one transaction. Every transition is modeled as: reverse the old
// order's effect, apply the new order's effect, then validate the result.

public sealed record OrderState(string PartId, decimal Quantity, string Status);

public sealed record BomLine(string ComponentPartId, decimal QuantityPer);

public sealed record InventoryQuantities(decimal OnHand, decimal Allocated)
{
    public static readonly InventoryQuantities Zero = new(0, 0);
}

public sealed record InventoryDelta(decimal OnHand, decimal Allocated);

public sealed record ShortageDetail(
    string PartId, string PartName, decimal RequiredQty, decimal OnHand, decimal ShortBy);

public sealed record PlanError(string Message, IReadOnlyList<ShortageDetail>? Shortages = null);

public sealed record PlanResult(IReadOnlyDictionary<string, InventoryDelta>? Deltas, PlanError? Error)
{
    public static PlanResult Success(IReadOnlyDictionary<string, InventoryDelta> deltas) => new(deltas, null);
    public static PlanResult Failure(PlanError error) => new(null, error);
}

public static class InventoryPlanner
{
    private const string CompleteStatus = "complete";

    public static PlanResult PlanTransition(
        OrderState? oldState,
        OrderState? newState,
        IReadOnlyDictionary<string, IReadOnlyList<BomLine>> bomByParent,
        IReadOnlyDictionary<string, InventoryQuantities> inventory,
        IReadOnlyDictionary<string, string> partNames)
    {
        var deltas = new Dictionary<string, (decimal OnHand, decimal Allocated)>();

        void Accumulate(string partId, decimal onHand, decimal allocated)
        {
            var current = deltas.GetValueOrDefault(partId);
            deltas[partId] = (current.OnHand + onHand, current.Allocated + allocated);
        }

        // sign = +1 applies an order's effect, -1 reverses it.
        void ApplyEffect(OrderState state, int sign)
        {
            var components = bomByParent.GetValueOrDefault(state.PartId, []);
            if (state.Status == CompleteStatus)
            {
                foreach (var line in components)
                {
                    Accumulate(line.ComponentPartId, -line.QuantityPer * state.Quantity * sign, 0);
                }
                Accumulate(state.PartId, state.Quantity * sign, 0);
            }
            else
            {
                foreach (var line in components)
                {
                    Accumulate(line.ComponentPartId, 0, line.QuantityPer * state.Quantity * sign);
                }
            }
        }

        if (oldState is not null)
        {
            ApplyEffect(oldState, -1);
        }
        if (newState is not null)
        {
            ApplyEffect(newState, 1);
        }

        decimal FinalOnHand(string partId) =>
            inventory.GetValueOrDefault(partId, InventoryQuantities.Zero).OnHand
            + deltas.GetValueOrDefault(partId).OnHand;

        string NameOf(string partId) => partNames.GetValueOrDefault(partId, partId);

        // Completion shortage gets a specific, actionable payload. The check is
        // against OnHand, not Available: the old state's reversal (including the
        // order's own allocation release) is already inside the deltas.
        if (newState?.Status == CompleteStatus)
        {
            var shortages = new List<ShortageDetail>();
            foreach (var line in bomByParent.GetValueOrDefault(newState.PartId, []))
            {
                var required = line.QuantityPer * newState.Quantity;
                var finalOnHand = FinalOnHand(line.ComponentPartId);
                if (finalOnHand < 0)
                {
                    // Report on-hand as the stock the completion actually draws
                    // from: current stock with the old order's effect reversed.
                    shortages.Add(new ShortageDetail(
                        line.ComponentPartId,
                        NameOf(line.ComponentPartId),
                        required,
                        finalOnHand + required,
                        -finalOnHand));
                }
            }

            if (shortages.Count > 0)
            {
                return PlanResult.Failure(new PlanError(
                    "Cannot complete: insufficient component inventory.", shortages));
            }
        }

        // Generic guard: no transition may drive OnHand or Allocated negative.
        // Reject loudly instead of clamping — a negative here means the data is
        // inconsistent and silent repair would hide it.
        foreach (var (partId, delta) in deltas)
        {
            var current = inventory.GetValueOrDefault(partId, InventoryQuantities.Zero);
            if (current.OnHand + delta.OnHand < 0)
            {
                return PlanResult.Failure(new PlanError(
                    $"Operation would drive on-hand inventory negative for {NameOf(partId)}."));
            }
            if (current.Allocated + delta.Allocated < 0)
            {
                return PlanResult.Failure(new PlanError(
                    $"Operation would drive allocated inventory negative for {NameOf(partId)}."));
            }
        }

        var materialized = deltas
            .Where(entry => entry.Value.OnHand != 0 || entry.Value.Allocated != 0)
            .ToDictionary(
                entry => entry.Key,
                entry => new InventoryDelta(entry.Value.OnHand, entry.Value.Allocated));
        return PlanResult.Success(materialized);
    }
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `dotnet test Naologic.sln`
Expected: PASS (6 tests: 3 theory cases + 3 facts).

- [ ] **Step 6: Commit**

```bash
git add api.Tests api/Services/InventoryPlanner.cs Naologic.sln
git commit -m "feat(api): add pure InventoryPlanner with create-path lifecycle tests"
```

---

### Task 3: InventoryPlanner transition + guard tests

**Files:**
- Modify: `api.Tests/InventoryPlannerTests.cs` (append tests)
- Modify: `api/Services/InventoryPlanner.cs` (only if a test exposes a bug)

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: verified behavior for every row of the spec §2 lifecycle table and every guard. No new public surface.

- [ ] **Step 1: Append transition/guard tests** to `api.Tests/InventoryPlannerTests.cs` (inside the existing class):

```csharp
    [Fact]
    public void Transition_OpenToComplete_ConsumesReleasesAndReceives()
    {
        var result = InventoryPlanner.PlanTransition(
            new OrderState("wheel", 8, "open"),
            new OrderState("wheel", 8, "complete"),
            Boms,
            Stock(("tire", 24, 14), ("rim", 20, 14), ("wheel", 30, 24)),
            Names);

        Assert.Null(result.Error);
        Assert.Equal(new InventoryDelta(-8, -8), result.Deltas!["tire"]);
        Assert.Equal(new InventoryDelta(-8, -8), result.Deltas!["rim"]);
        Assert.Equal(new InventoryDelta(8, 0), result.Deltas!["wheel"]);
    }

    [Fact]
    public void Reopen_CompleteToOpen_ReversesCompletionAndReallocates()
    {
        var result = InventoryPlanner.PlanTransition(
            new OrderState("wheel", 8, "complete"),
            new OrderState("wheel", 8, "open"),
            Boms,
            Stock(("tire", 16, 6), ("rim", 12, 6), ("wheel", 38, 24)),
            Names);

        Assert.Null(result.Error);
        Assert.Equal(new InventoryDelta(8, 8), result.Deltas!["tire"]);
        Assert.Equal(new InventoryDelta(8, 8), result.Deltas!["rim"]);
        Assert.Equal(new InventoryDelta(-8, 0), result.Deltas!["wheel"]);
    }

    [Fact]
    public void Reopen_WhenFinishedGoodAlreadyConsumed_Fails()
    {
        // Only 2 wheels remain on hand, but reopening must take back 8.
        var result = InventoryPlanner.PlanTransition(
            new OrderState("wheel", 8, "complete"),
            new OrderState("wheel", 8, "open"),
            Boms,
            Stock(("tire", 16, 6), ("rim", 12, 6), ("wheel", 2, 0)),
            Names);

        Assert.Null(result.Deltas);
        Assert.Contains("Wheel Assembly", result.Error!.Message);
        Assert.Null(result.Error.Shortages);
    }

    [Fact]
    public void Delete_Open_ReleasesAllocationOnly()
    {
        var result = InventoryPlanner.PlanTransition(
            new OrderState("wheel", 8, "open"),
            null,
            Boms,
            Stock(("tire", 24, 14), ("rim", 20, 14)),
            Names);

        Assert.Null(result.Error);
        Assert.Equal(new InventoryDelta(0, -8), result.Deltas!["tire"]);
        Assert.Equal(new InventoryDelta(0, -8), result.Deltas!["rim"]);
    }

    [Fact]
    public void Delete_Complete_ReversesWithoutReallocating()
    {
        var result = InventoryPlanner.PlanTransition(
            new OrderState("wheel", 8, "complete"),
            null,
            Boms,
            Stock(("tire", 16, 6), ("rim", 12, 6), ("wheel", 38, 24)),
            Names);

        Assert.Null(result.Error);
        Assert.Equal(new InventoryDelta(8, 0), result.Deltas!["tire"]);
        Assert.Equal(new InventoryDelta(8, 0), result.Deltas!["rim"]);
        Assert.Equal(new InventoryDelta(-8, 0), result.Deltas!["wheel"]);
    }

    [Fact]
    public void Edit_QuantityOnOpenOrder_ProducesNetAllocationDelta()
    {
        var result = InventoryPlanner.PlanTransition(
            new OrderState("wheel", 5, "open"),
            new OrderState("wheel", 8, "open"),
            Boms,
            Stock(("tire", 24, 5), ("rim", 20, 5)),
            Names);

        Assert.Null(result.Error);
        Assert.Equal(new InventoryDelta(0, 3), result.Deltas!["tire"]);
        Assert.Equal(new InventoryDelta(0, 3), result.Deltas!["rim"]);
    }

    [Fact]
    public void Edit_PartChange_FullyReversesOldAndAppliesNew()
    {
        var result = InventoryPlanner.PlanTransition(
            new OrderState("wheel", 5, "open"),
            new OrderState("tractor", 2, "open"),
            Boms,
            Stock(("tire", 24, 5), ("rim", 20, 5), ("frame", 8, 0), ("wheel", 30, 0)),
            Names);

        Assert.Null(result.Error);
        Assert.Equal(new InventoryDelta(0, -5), result.Deltas!["tire"]);
        Assert.Equal(new InventoryDelta(0, -5), result.Deltas!["rim"]);
        Assert.Equal(new InventoryDelta(0, 2), result.Deltas!["frame"]);
        Assert.Equal(new InventoryDelta(0, 8), result.Deltas!["wheel"]);
    }

    [Fact]
    public void Edit_QuantityOnCompleteOrder_ChecksShortageAfterReversal()
    {
        // Old completion consumed 5 tires; only 2 remain on hand. Raising the
        // quantity to 8 draws from 2 + 5 (reversed) = 7 — short by 1.
        var result = InventoryPlanner.PlanTransition(
            new OrderState("wheel", 5, "complete"),
            new OrderState("wheel", 8, "complete"),
            Boms,
            Stock(("tire", 2, 0), ("rim", 20, 0), ("wheel", 30, 0)),
            Names);

        Assert.NotNull(result.Error);
        var shortage = Assert.Single(result.Error!.Shortages!);
        Assert.Equal("tire", shortage.PartId);
        Assert.Equal(8, shortage.RequiredQty);
        Assert.Equal(7, shortage.OnHand);
        Assert.Equal(1, shortage.ShortBy);
    }

    [Fact]
    public void Reversal_ThatWouldDriveAllocationNegative_FailsLoudly()
    {
        // Data inconsistency: order says 8 allocated, inventory only shows 5.
        var result = InventoryPlanner.PlanTransition(
            new OrderState("wheel", 8, "open"),
            null,
            Boms,
            Stock(("tire", 24, 5), ("rim", 20, 14)),
            Names);

        Assert.Null(result.Deltas);
        Assert.Contains("allocated", result.Error!.Message);
        Assert.Contains("Tire", result.Error.Message);
    }
```

- [ ] **Step 2: Run tests**

Run: `dotnet test Naologic.sln`
Expected: PASS (15 total). The Task 2 implementation already generalizes to old-state paths; if any test fails, fix `InventoryPlanner.cs` — the tests are the authority (they encode the spec lifecycle table).

- [ ] **Step 3: Commit**

```bash
git add api.Tests/InventoryPlannerTests.cs api/Services/InventoryPlanner.cs
git commit -m "test(api): cover all lifecycle transitions and guards in InventoryPlanner"
```

---

### Task 4: API models, validators, and read path

**Files:**
- Modify: `api/Models/WorkOrders/WorkOrderModels.cs`
- Modify: `api/Validation/WorkOrderValidators.cs`
- Modify: `api/Repositories/WorkOrdersRepository.cs`

**Interfaces:**
- Consumes: schema from Task 1.
- Produces (used by Tasks 5, 7):
  - `WorkOrderData(string Name, string WorkCenterId, string Status, string StartDate, string EndDate, string PartId, decimal Quantity, string? PartNumber, string? PartName)`
  - `CreateWorkOrderRequest` / `UpdateWorkOrderRequest` / `WorkOrderMutationRequest` each gain `string PartId, decimal Quantity` (after `EndDate`).
  - `WorkOrdersRepository` becomes read-only: `GetWorkCentersAsync`, `GetWorkOrdersAsync` (now joined to Parts). Mutation methods and `WorkCenterExistsAsync` are DELETED (they move into `WorkOrderInventoryService` in Task 5 — the build stays broken until Task 5's controller change, which is why Tasks 4+5 land as one commit there; see Step 4).

- [ ] **Step 1: Replace `api/Models/WorkOrders/WorkOrderModels.cs`** with:

```csharp
namespace Naologic_API.Models.WorkOrders;

public sealed record WorkCenterData(string Name);

public sealed record WorkOrderData(
    string Name,
    string WorkCenterId,
    string Status,
    string StartDate,
    string EndDate,
    string PartId,
    decimal Quantity,
    string? PartNumber,
    string? PartName);

public sealed record WorkCenterDocument(string DocId, string DocType, WorkCenterData Data);

public sealed record WorkOrderDocument(string DocId, string DocType, WorkOrderData Data);

public abstract record WorkOrderMutationRequest(
    string Name, string WorkCenterId, string Status, string StartDate, string EndDate,
    string PartId, decimal Quantity);

public sealed record CreateWorkOrderRequest(
    string Name, string WorkCenterId, string Status, string StartDate, string EndDate,
    string PartId, decimal Quantity)
    : WorkOrderMutationRequest(Name, WorkCenterId, Status, StartDate, EndDate, PartId, Quantity);

public sealed record UpdateWorkOrderRequest(
    string Name, string WorkCenterId, string Status, string StartDate, string EndDate,
    string PartId, decimal Quantity)
    : WorkOrderMutationRequest(Name, WorkCenterId, Status, StartDate, EndDate, PartId, Quantity);
```

- [ ] **Step 2: Extend `api/Validation/WorkOrderValidators.cs`** — after the `workCenterId` check (line 19), insert:

```csharp
        if (string.IsNullOrWhiteSpace(request.PartId))
        {
            errors["partId"] = ["Part is required."];
        }

        if (request.Quantity <= 0)
        {
            errors["quantity"] = ["Quantity must be greater than zero."];
        }
```

- [ ] **Step 3: Make `WorkOrdersRepository` read-only with a Parts join.** Delete `CreateWorkOrderAsync`, `UpdateWorkOrderAsync`, `DeleteWorkOrderAsync`, and `WorkCenterExistsAsync`. Replace `GetWorkOrdersAsync`'s SQL and reader with:

```csharp
    public async Task<IReadOnlyList<WorkOrderDocument>> GetWorkOrdersAsync(CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT wo.WorkOrderId, wo.Name, wo.WorkCenterId, wo.Status, wo.StartDate, wo.EndDate,
                   wo.PartId, wo.Quantity, p.PartNumber, p.Name AS PartName
            FROM WorkOrders wo
            INNER JOIN Parts p ON p.PartId = wo.PartId
            ORDER BY wo.StartDate, wo.WorkOrderId;
            """;

        var workOrders = new List<WorkOrderDocument>();
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            workOrders.Add(new WorkOrderDocument(
                reader.GetString(0),
                "workOrder",
                new WorkOrderData(
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetDateTime(4).ToString("yyyy-MM-dd"),
                    reader.GetDateTime(5).ToString("yyyy-MM-dd"),
                    reader.GetString(6),
                    reader.GetDecimal(7),
                    reader.GetString(8),
                    reader.GetString(9))));
        }

        return workOrders;
    }
```

Also keep the `AllowedStatuses` array — the validator uses it.

- [ ] **Step 4: Note the intentionally broken build.** `WorkOrdersController` still calls the deleted mutation methods; Task 5 fixes it. Do NOT commit yet — Tasks 4 and 5 commit together at the end of Task 5. (If executing with per-task subagents, hand both tasks to the same agent or accept the red build between them.)

---

### Task 5: WorkOrderInventoryService + controller wiring

**Files:**
- Create: `api/Services/WorkOrderInventoryService.cs`
- Modify: `api/Controllers/WorkOrdersController.cs`
- Modify: `api/Program.cs:51-55` (DI)

**Interfaces:**
- Consumes: `InventoryPlanner` API (Task 2), models (Task 4), schema (Task 1).
- Produces (used by controller and Task 12 smoke tests):
  - `sealed record WorkOrderMutationResult(WorkOrderDocument? Document, PlanError? Error, bool NotFound = false)`
  - `WorkOrderInventoryService.CreateAsync(CreateWorkOrderRequest, CancellationToken) : Task<WorkOrderMutationResult>`
  - `WorkOrderInventoryService.UpdateAsync(string id, UpdateWorkOrderRequest, CancellationToken) : Task<WorkOrderMutationResult>`
  - `WorkOrderInventoryService.DeleteAsync(string id, CancellationToken) : Task<WorkOrderMutationResult>` (success = Document null, Error null, NotFound false)
  - HTTP error contract: 400 body `{ message, shortages? }`.

- [ ] **Step 1: Create `api/Services/WorkOrderInventoryService.cs`:**

```csharp
using Microsoft.Data.SqlClient;
using Naologic_API.Models.WorkOrders;

namespace Naologic_API.Services;

public sealed record WorkOrderMutationResult(
    WorkOrderDocument? Document, PlanError? Error, bool NotFound = false);

// Owns every work-order mutation. Loads order/BOM/inventory state under UPDLOCK,
// asks InventoryPlanner for the deltas, and applies deltas + the order row change
// in one transaction so planning data can never drift from the orders.
public sealed class WorkOrderInventoryService
{
    private sealed record PartInfo(string PartId, string PartNumber, string Name);

    private readonly string _connectionString;

    public WorkOrderInventoryService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");
    }

    public async Task<WorkOrderMutationResult> CreateAsync(
        CreateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);

        var guardError = await ValidateReferencesAsync(connection, transaction, request, cancellationToken);
        if (guardError is not null)
        {
            return new WorkOrderMutationResult(null, guardError);
        }

        var newState = new OrderState(request.PartId, request.Quantity, request.Status);
        var planError = await PlanAndApplyAsync(connection, transaction, null, newState, cancellationToken);
        if (planError is not null)
        {
            return new WorkOrderMutationResult(null, planError);
        }

        var workOrderId = $"wo-{Guid.NewGuid():N}"[..11];
        const string insertSql = """
            INSERT INTO WorkOrders (WorkOrderId, Name, WorkCenterId, PartId, Quantity, Status, StartDate, EndDate)
            VALUES (@workOrderId, @name, @workCenterId, @partId, @quantity, @status, @startDate, @endDate);
            """;
        await using (var command = new SqlCommand(insertSql, connection, transaction))
        {
            command.Parameters.AddWithValue("@workOrderId", workOrderId);
            AddMutationParameters(command, request);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        var part = await GetPartAsync(connection, transaction, request.PartId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new WorkOrderMutationResult(BuildDocument(workOrderId, request, part), null);
    }

    public async Task<WorkOrderMutationResult> UpdateAsync(
        string id, UpdateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);

        var oldState = await GetOrderStateAsync(connection, transaction, id, cancellationToken);
        if (oldState is null)
        {
            return new WorkOrderMutationResult(null, null, NotFound: true);
        }

        var guardError = await ValidateReferencesAsync(connection, transaction, request, cancellationToken);
        if (guardError is not null)
        {
            return new WorkOrderMutationResult(null, guardError);
        }

        var newState = new OrderState(request.PartId, request.Quantity, request.Status);
        var planError = await PlanAndApplyAsync(connection, transaction, oldState, newState, cancellationToken);
        if (planError is not null)
        {
            return new WorkOrderMutationResult(null, planError);
        }

        const string updateSql = """
            UPDATE WorkOrders
            SET Name = @name,
                WorkCenterId = @workCenterId,
                PartId = @partId,
                Quantity = @quantity,
                Status = @status,
                StartDate = @startDate,
                EndDate = @endDate
            WHERE WorkOrderId = @workOrderId;
            """;
        await using (var command = new SqlCommand(updateSql, connection, transaction))
        {
            command.Parameters.AddWithValue("@workOrderId", id);
            AddMutationParameters(command, request);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        var part = await GetPartAsync(connection, transaction, request.PartId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new WorkOrderMutationResult(BuildDocument(id, request, part), null);
    }

    public async Task<WorkOrderMutationResult> DeleteAsync(string id, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);

        var oldState = await GetOrderStateAsync(connection, transaction, id, cancellationToken);
        if (oldState is null)
        {
            return new WorkOrderMutationResult(null, null, NotFound: true);
        }

        var planError = await PlanAndApplyAsync(connection, transaction, oldState, null, cancellationToken);
        if (planError is not null)
        {
            return new WorkOrderMutationResult(null, planError);
        }

        const string deleteSql = "DELETE FROM WorkOrders WHERE WorkOrderId = @workOrderId;";
        await using (var command = new SqlCommand(deleteSql, connection, transaction))
        {
            command.Parameters.AddWithValue("@workOrderId", id);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return new WorkOrderMutationResult(null, null);
    }

    // ---- request-level reference guards -------------------------------------

    private static async Task<PlanError?> ValidateReferencesAsync(
        SqlConnection connection, SqlTransaction transaction,
        WorkOrderMutationRequest request, CancellationToken cancellationToken)
    {
        const string workCenterSql = "SELECT COUNT(1) FROM WorkCenters WHERE WorkCenterId = @id;";
        await using (var command = new SqlCommand(workCenterSql, connection, transaction))
        {
            command.Parameters.AddWithValue("@id", request.WorkCenterId);
            if ((int)await command.ExecuteScalarAsync(cancellationToken) == 0)
            {
                return new PlanError("Unknown work center.");
            }
        }

        var part = await GetPartAsync(connection, transaction, request.PartId, cancellationToken);
        if (part is null)
        {
            return new PlanError("Unknown part.");
        }

        // Mirror of the picker rule: only parts with a BOM are producible.
        var bom = await GetBomLinesAsync(connection, transaction, request.PartId, cancellationToken);
        if (bom.Count == 0)
        {
            return new PlanError("Selected part has no bill of materials and cannot be produced.");
        }

        return null;
    }

    // ---- planner orchestration ----------------------------------------------

    private static async Task<PlanError?> PlanAndApplyAsync(
        SqlConnection connection, SqlTransaction transaction,
        OrderState? oldState, OrderState? newState, CancellationToken cancellationToken)
    {
        var parentIds = new List<string>();
        if (oldState is not null)
        {
            parentIds.Add(oldState.PartId);
        }
        if (newState is not null && !parentIds.Contains(newState.PartId))
        {
            parentIds.Add(newState.PartId);
        }

        var bomByParent = new Dictionary<string, IReadOnlyList<BomLine>>();
        foreach (var parentId in parentIds)
        {
            bomByParent[parentId] = await GetBomLinesAsync(connection, transaction, parentId, cancellationToken);
        }

        var affectedIds = bomByParent.Values
            .SelectMany(lines => lines.Select(line => line.ComponentPartId))
            .Concat(parentIds)
            .Distinct()
            .ToList();

        var inventory = await GetInventoryAsync(connection, transaction, affectedIds, cancellationToken);
        var partNames = await GetPartNamesAsync(connection, transaction, affectedIds, cancellationToken);

        var result = InventoryPlanner.PlanTransition(oldState, newState, bomByParent, inventory, partNames);
        if (result.Error is not null)
        {
            return result.Error;
        }

        await ApplyDeltasAsync(connection, transaction, result.Deltas!, cancellationToken);
        return null;
    }

    private static async Task ApplyDeltasAsync(
        SqlConnection connection, SqlTransaction transaction,
        IReadOnlyDictionary<string, InventoryDelta> deltas, CancellationToken cancellationToken)
    {
        foreach (var (partId, delta) in deltas)
        {
            const string updateSql = """
                UPDATE Inventory
                SET QuantityOnHand = QuantityOnHand + @onHand,
                    QuantityAllocated = QuantityAllocated + @allocated
                WHERE PartId = @partId;
                """;
            await using var updateCommand = new SqlCommand(updateSql, connection, transaction);
            updateCommand.Parameters.AddWithValue("@onHand", delta.OnHand);
            updateCommand.Parameters.AddWithValue("@allocated", delta.Allocated);
            updateCommand.Parameters.AddWithValue("@partId", partId);
            var rows = await updateCommand.ExecuteNonQueryAsync(cancellationToken);

            if (rows == 0)
            {
                // Row on demand — the planner guarantees the resulting values are >= 0.
                var inventoryId = $"inv-{Guid.NewGuid():N}"[..12];
                const string insertSql = """
                    INSERT INTO Inventory (InventoryId, PartId, QuantityOnHand, QuantityAllocated, QuantityOnOrder, SafetyStock)
                    VALUES (@inventoryId, @partId, @onHand, @allocated, 0, 0);
                    """;
                await using var insertCommand = new SqlCommand(insertSql, connection, transaction);
                insertCommand.Parameters.AddWithValue("@inventoryId", inventoryId);
                insertCommand.Parameters.AddWithValue("@partId", partId);
                insertCommand.Parameters.AddWithValue("@onHand", delta.OnHand);
                insertCommand.Parameters.AddWithValue("@allocated", delta.Allocated);
                await insertCommand.ExecuteNonQueryAsync(cancellationToken);
            }
        }
    }

    // ---- loaders -------------------------------------------------------------

    private static async Task<OrderState?> GetOrderStateAsync(
        SqlConnection connection, SqlTransaction transaction, string id, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT PartId, Quantity, Status
            FROM WorkOrders WITH (UPDLOCK)
            WHERE WorkOrderId = @id;
            """;
        await using var command = new SqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("@id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }
        return new OrderState(reader.GetString(0), reader.GetDecimal(1), reader.GetString(2));
    }

    private static async Task<PartInfo?> GetPartAsync(
        SqlConnection connection, SqlTransaction transaction, string partId, CancellationToken cancellationToken)
    {
        const string sql = "SELECT PartId, PartNumber, Name FROM Parts WHERE PartId = @partId;";
        await using var command = new SqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("@partId", partId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }
        return new PartInfo(reader.GetString(0), reader.GetString(1), reader.GetString(2));
    }

    private static async Task<IReadOnlyList<BomLine>> GetBomLinesAsync(
        SqlConnection connection, SqlTransaction transaction, string parentPartId, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT ComponentPartId, QuantityPer
            FROM BillOfMaterials
            WHERE ParentPartId = @parentPartId;
            """;
        var lines = new List<BomLine>();
        await using var command = new SqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("@parentPartId", parentPartId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            lines.Add(new BomLine(reader.GetString(0), reader.GetDecimal(1)));
        }
        return lines;
    }

    private static async Task<IReadOnlyDictionary<string, InventoryQuantities>> GetInventoryAsync(
        SqlConnection connection, SqlTransaction transaction,
        IReadOnlyList<string> partIds, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, InventoryQuantities>();
        if (partIds.Count == 0)
        {
            return result;
        }

        var parameterNames = partIds.Select((_, index) => $"@p{index}").ToArray();
        var sql = $"""
            SELECT PartId, QuantityOnHand, QuantityAllocated
            FROM Inventory WITH (UPDLOCK)
            WHERE PartId IN ({string.Join(", ", parameterNames)});
            """;
        await using var command = new SqlCommand(sql, connection, transaction);
        for (var i = 0; i < partIds.Count; i++)
        {
            command.Parameters.AddWithValue($"@p{i}", partIds[i]);
        }
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result[reader.GetString(0)] = new InventoryQuantities(reader.GetDecimal(1), reader.GetDecimal(2));
        }
        return result;
    }

    private static async Task<IReadOnlyDictionary<string, string>> GetPartNamesAsync(
        SqlConnection connection, SqlTransaction transaction,
        IReadOnlyList<string> partIds, CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, string>();
        if (partIds.Count == 0)
        {
            return result;
        }

        var parameterNames = partIds.Select((_, index) => $"@p{index}").ToArray();
        var sql = $"SELECT PartId, Name FROM Parts WHERE PartId IN ({string.Join(", ", parameterNames)});";
        await using var command = new SqlCommand(sql, connection, transaction);
        for (var i = 0; i < partIds.Count; i++)
        {
            command.Parameters.AddWithValue($"@p{i}", partIds[i]);
        }
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result[reader.GetString(0)] = reader.GetString(1);
        }
        return result;
    }

    // ---- helpers -------------------------------------------------------------

    private static void AddMutationParameters(SqlCommand command, WorkOrderMutationRequest request)
    {
        command.Parameters.AddWithValue("@name", request.Name.Trim());
        command.Parameters.AddWithValue("@workCenterId", request.WorkCenterId);
        command.Parameters.AddWithValue("@partId", request.PartId);
        command.Parameters.AddWithValue("@quantity", request.Quantity);
        command.Parameters.AddWithValue("@status", request.Status);
        command.Parameters.AddWithValue("@startDate", DateOnly.Parse(request.StartDate).ToDateTime(TimeOnly.MinValue));
        command.Parameters.AddWithValue("@endDate", DateOnly.Parse(request.EndDate).ToDateTime(TimeOnly.MinValue));
    }

    private static WorkOrderDocument BuildDocument(
        string workOrderId, WorkOrderMutationRequest request, PartInfo? part) =>
        new(workOrderId, "workOrder", new WorkOrderData(
            request.Name.Trim(),
            request.WorkCenterId,
            request.Status,
            request.StartDate,
            request.EndDate,
            request.PartId,
            request.Quantity,
            part?.PartNumber,
            part?.Name));
}
```

- [ ] **Step 2: Rewire `api/Controllers/WorkOrdersController.cs`.** Replace the constructor injection and the three mutation actions (GET actions stay as-is):

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Naologic_API.Models.WorkOrders;
using Naologic_API.Repositories;
using Naologic_API.Services;
using Naologic_API.Validation;

namespace Naologic_API.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public sealed class WorkOrdersController : ControllerBase
{
    private readonly WorkOrdersRepository _repository;
    private readonly WorkOrderInventoryService _inventoryService;

    public WorkOrdersController(WorkOrdersRepository repository, WorkOrderInventoryService inventoryService)
    {
        _repository = repository;
        _inventoryService = inventoryService;
    }

    [HttpGet("work-centers")]
    public async Task<ActionResult<IReadOnlyList<WorkCenterDocument>>> GetWorkCenters(CancellationToken cancellationToken)
    {
        var workCenters = await _repository.GetWorkCentersAsync(cancellationToken);
        return Ok(workCenters);
    }

    [HttpGet("work-orders")]
    public async Task<ActionResult<IReadOnlyList<WorkOrderDocument>>> GetWorkOrders(CancellationToken cancellationToken)
    {
        var workOrders = await _repository.GetWorkOrdersAsync(cancellationToken);
        return Ok(workOrders);
    }

    [Authorize(Policy = "PlannerWriteAccess")]
    [HttpPost("work-orders")]
    public async Task<IResult> CreateWorkOrder([FromBody] CreateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        var validationError = WorkOrderValidators.ValidateWorkOrderRequest(request);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        var result = await _inventoryService.CreateAsync(request, cancellationToken);
        if (result.Error is not null)
        {
            return Results.BadRequest(new { message = result.Error.Message, shortages = result.Error.Shortages });
        }
        return Results.Created($"/api/work-orders/{result.Document!.DocId}", result.Document);
    }

    [Authorize(Policy = "PlannerWriteAccess")]
    [HttpPut("work-orders/{id}")]
    public async Task<IResult> UpdateWorkOrder(string id, [FromBody] UpdateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        var validationError = WorkOrderValidators.ValidateWorkOrderRequest(request);
        if (validationError is not null)
        {
            return Results.ValidationProblem(validationError);
        }

        var result = await _inventoryService.UpdateAsync(id, request, cancellationToken);
        if (result.NotFound)
        {
            return Results.NotFound();
        }
        if (result.Error is not null)
        {
            return Results.BadRequest(new { message = result.Error.Message, shortages = result.Error.Shortages });
        }
        return Results.Ok(result.Document);
    }

    [Authorize(Policy = "PlannerWriteAccess")]
    [HttpDelete("work-orders/{id}")]
    public async Task<IResult> DeleteWorkOrder(string id, CancellationToken cancellationToken)
    {
        var result = await _inventoryService.DeleteAsync(id, cancellationToken);
        if (result.NotFound)
        {
            return Results.NotFound();
        }
        if (result.Error is not null)
        {
            return Results.BadRequest(new { message = result.Error.Message, shortages = result.Error.Shortages });
        }
        return Results.NoContent();
    }
}
```

- [ ] **Step 3: Register the service in `api/Program.cs`** — after `builder.Services.AddSingleton<PlanningRepository>();` add:

```csharp
builder.Services.AddSingleton<WorkOrderInventoryService>();
```

and add `using Naologic_API.Services;` if not already present (it is — `JwtTokenService` is registered).

- [ ] **Step 4: Build and test**

Run: `dotnet build Naologic.sln && dotnet test Naologic.sln`
Expected: Build succeeded; 15 planner tests PASS.

- [ ] **Step 5: Commit Tasks 4+5 together**

```bash
git add api/Models/WorkOrders/WorkOrderModels.cs api/Validation/WorkOrderValidators.cs api/Repositories/WorkOrdersRepository.cs api/Services/WorkOrderInventoryService.cs api/Controllers/WorkOrdersController.cs api/Program.cs
git commit -m "feat(api): transactional work-order lifecycle with BOM allocation and consumption"
```

---

### Task 5b: WorkOrderInventoryService integration tests (DB-backed)

**Files:**
- Create: `api.Tests/WorkOrderInventoryServiceTests.cs`

**Interfaces:**
- Consumes: `WorkOrderInventoryService` (Task 5), seeded schema (Task 1).
- Produces: verified end-to-end SQL behavior — transaction rollback on guard errors, allocation round-trips, reverse-then-apply against a real database.
- **Gating:** tests read the connection string from the `NAOLOGIC_TEST_DB` environment variable and no-op (pass trivially) when it is unset, so `dotnet test` stays green on machines without a database. Run them for real against a disposable Docker SQL Server seeded with the four scripts — never against the Railway DB.

- [ ] **Step 1: Start a disposable, seeded SQL Server** (skip this step if one is already running from Task 1):

```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=LocalTest123!" -p 14333:1433 -d --name naologic-sqltest mcr.microsoft.com/mssql/server:2022-latest
sleep 25
for f in NaologicDb.sql Planning.sql WorkOrders.sql Users.sql; do docker exec -i naologic-sqltest /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P 'LocalTest123!' -C -i /dev/stdin < api/database/$f; done
export NAOLOGIC_TEST_DB="Server=localhost,14333;Database=NaologicDb;User Id=sa;Password=LocalTest123!;TrustServerCertificate=True;"
```

If Docker is unavailable, point `NAOLOGIC_TEST_DB` at any disposable SQL Server with the scripts applied; if none exists, note it, still write the tests (they gate themselves), and flag the gap in the Task 12 report.

- [ ] **Step 2: Write the failing integration tests** — create `api.Tests/WorkOrderInventoryServiceTests.cs`. Each test is a closed loop (create → assert → delete → assert restored) so the seeded data is left untouched:

```csharp
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Naologic_API.Models.WorkOrders;
using Naologic_API.Services;

namespace Naologic_API.Tests;

// DB-backed tests for the transactional executor. Gated on NAOLOGIC_TEST_DB so
// machines without a database still pass; run for real against a disposable
// seeded SQL Server (see the implementation plan, Task 5b).
public class WorkOrderInventoryServiceTests
{
    private static readonly string? ConnectionString =
        Environment.GetEnvironmentVariable("NAOLOGIC_TEST_DB");

    private static WorkOrderInventoryService CreateService() =>
        new(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = ConnectionString
            })
            .Build());

    private static async Task<(decimal OnHand, decimal Allocated)> GetInventoryAsync(string partId)
    {
        await using var connection = new SqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand(
            "SELECT QuantityOnHand, QuantityAllocated FROM Inventory WHERE PartId = @partId;", connection);
        command.Parameters.AddWithValue("@partId", partId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync(), $"No inventory row for {partId}");
        return (reader.GetDecimal(0), reader.GetDecimal(1));
    }

    private static CreateWorkOrderRequest WheelOrder(decimal quantity, string status) => new(
        "Integration Test Order", "wc-005", status, "2026-08-01", "2026-08-05",
        "part-wheel-assembly", quantity);

    [Fact]
    public async Task CreateOpen_Allocates_AndDeleteRestores()
    {
        if (ConnectionString is null) return;
        var service = CreateService();
        var tireBefore = await GetInventoryAsync("part-tire-26");

        var created = await service.CreateAsync(WheelOrder(2, "open"), CancellationToken.None);
        Assert.Null(created.Error);
        var tireDuring = await GetInventoryAsync("part-tire-26");
        Assert.Equal(tireBefore.Allocated + 2, tireDuring.Allocated);
        Assert.Equal(tireBefore.OnHand, tireDuring.OnHand);

        var deleted = await service.DeleteAsync(created.Document!.DocId, CancellationToken.None);
        Assert.Null(deleted.Error);
        Assert.Equal(tireBefore, await GetInventoryAsync("part-tire-26"));
    }

    [Fact]
    public async Task CreateComplete_ConsumesAndReceives_AndDeleteReverses()
    {
        if (ConnectionString is null) return;
        var service = CreateService();
        var tireBefore = await GetInventoryAsync("part-tire-26");
        var wheelBefore = await GetInventoryAsync("part-wheel-assembly");

        var created = await service.CreateAsync(WheelOrder(1, "complete"), CancellationToken.None);
        Assert.Null(created.Error);
        Assert.Equal(tireBefore.OnHand - 1, (await GetInventoryAsync("part-tire-26")).OnHand);
        Assert.Equal(wheelBefore.OnHand + 1, (await GetInventoryAsync("part-wheel-assembly")).OnHand);

        var deleted = await service.DeleteAsync(created.Document!.DocId, CancellationToken.None);
        Assert.Null(deleted.Error);
        Assert.Equal(tireBefore, await GetInventoryAsync("part-tire-26"));
        Assert.Equal(wheelBefore, await GetInventoryAsync("part-wheel-assembly"));
    }

    [Fact]
    public async Task Complete_WithShortage_FailsAndRollsBackEverything()
    {
        if (ConnectionString is null) return;
        var service = CreateService();
        var frameBefore = await GetInventoryAsync("part-frame-assembly");

        // Frame OnHand is 8 in seed; a 9-tractor completion must be short.
        var request = new CreateWorkOrderRequest(
            "Doomed Tractor", "wc-003", "complete", "2026-08-01", "2026-08-05",
            "part-tractor-1000", 9);
        var result = await service.CreateAsync(request, CancellationToken.None);

        Assert.NotNull(result.Error);
        Assert.NotNull(result.Error!.Shortages);
        Assert.Contains(result.Error.Shortages!, s => s.PartId == "part-frame-assembly");
        // Nothing may have been written: no order row, no inventory movement.
        Assert.Equal(frameBefore, await GetInventoryAsync("part-frame-assembly"));
        await using var connection = new SqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand(
            "SELECT COUNT(1) FROM WorkOrders WHERE Name = 'Doomed Tractor';", connection);
        Assert.Equal(0, (int)await command.ExecuteScalarAsync());
    }

    [Fact]
    public async Task Update_ReversesOldStateThenAppliesNew()
    {
        if (ConnectionString is null) return;
        var service = CreateService();
        var tireBefore = await GetInventoryAsync("part-tire-26");

        var created = await service.CreateAsync(WheelOrder(2, "open"), CancellationToken.None);
        Assert.Null(created.Error);

        var update = new UpdateWorkOrderRequest(
            "Integration Test Order", "wc-005", "open", "2026-08-01", "2026-08-05",
            "part-wheel-assembly", 5);
        var updated = await service.UpdateAsync(created.Document!.DocId, update, CancellationToken.None);
        Assert.Null(updated.Error);
        Assert.Equal(tireBefore.Allocated + 5, (await GetInventoryAsync("part-tire-26")).Allocated);

        await service.DeleteAsync(created.Document.DocId, CancellationToken.None);
        Assert.Equal(tireBefore, await GetInventoryAsync("part-tire-26"));
    }
}
```

Note the request records' positional order is `(Name, WorkCenterId, Status, StartDate, EndDate, PartId, Quantity)` — match Task 4's definitions exactly.

- [ ] **Step 3: Run with the DB attached**

Run: `NAOLOGIC_TEST_DB="Server=localhost,14333;Database=NaologicDb;User Id=sa;Password=LocalTest123!;TrustServerCertificate=True;" dotnet test Naologic.sln`
Expected: all planner tests plus 4 integration tests PASS. Also run once WITHOUT the env var and confirm the suite still passes (integration tests no-op).

- [ ] **Step 4: Commit**

```bash
git add api.Tests/WorkOrderInventoryServiceTests.cs
git commit -m "test(api): DB-backed integration tests for work-order inventory lifecycle"
```

---

### Task 6: Buildable-parts endpoint

**Files:**
- Create: `api/Models/Parts/PartModels.cs`
- Create: `api/Repositories/PartsRepository.cs`
- Create: `api/Controllers/PartsController.cs`
- Modify: `api/Program.cs` (DI)

**Interfaces:**
- Consumes: schema (Task 1).
- Produces (used by Task 7): `GET /api/parts/buildable` → `200 [{ partId, partNumber, name, defaultWorkCenterId }]`, `[Authorize]` (any role).

- [ ] **Step 1: Create `api/Models/Parts/PartModels.cs`:**

```csharp
namespace Naologic_API.Models.Parts;

public sealed record BuildablePartDocument(
    string PartId, string PartNumber, string Name, string? DefaultWorkCenterId);
```

- [ ] **Step 2: Create `api/Repositories/PartsRepository.cs`:**

```csharp
using Microsoft.Data.SqlClient;
using Naologic_API.Models.Parts;

namespace Naologic_API.Repositories;

public sealed class PartsRepository
{
    private readonly string _connectionString;

    public PartsRepository(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is not configured.");
    }

    public async Task<IReadOnlyList<BuildablePartDocument>> GetBuildablePartsAsync(CancellationToken cancellationToken)
    {
        // Buildable = has at least one BOM line; mirrors the server-side
        // mutation guard so the picker and the API can never disagree.
        const string sql = """
            SELECT p.PartId, p.PartNumber, p.Name, p.DefaultWorkCenterId
            FROM Parts p
            WHERE EXISTS (SELECT 1 FROM BillOfMaterials b WHERE b.ParentPartId = p.PartId)
            ORDER BY p.Name;
            """;

        var parts = new List<BuildablePartDocument>();
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            parts.Add(new BuildablePartDocument(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3)));
        }

        return parts;
    }
}
```

- [ ] **Step 3: Create `api/Controllers/PartsController.cs`:**

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Naologic_API.Models.Parts;
using Naologic_API.Repositories;

namespace Naologic_API.Controllers;

[ApiController]
[Authorize]
[Route("api/parts")]
public sealed class PartsController : ControllerBase
{
    private readonly PartsRepository _repository;

    public PartsController(PartsRepository repository)
    {
        _repository = repository;
    }

    [HttpGet("buildable")]
    public async Task<ActionResult<IReadOnlyList<BuildablePartDocument>>> GetBuildableParts(CancellationToken cancellationToken)
    {
        var parts = await _repository.GetBuildablePartsAsync(cancellationToken);
        return Ok(parts);
    }
}
```

- [ ] **Step 4: Register in `api/Program.cs`** — after the `WorkOrderInventoryService` registration add:

```csharp
builder.Services.AddSingleton<PartsRepository>();
```

- [ ] **Step 5: Build**

Run: `dotnet build Naologic.sln`
Expected: Build succeeded.

- [ ] **Step 6: Commit**

```bash
git add api/Models/Parts api/Repositories/PartsRepository.cs api/Controllers/PartsController.cs api/Program.cs
git commit -m "feat(api): add GET /api/parts/buildable endpoint"
```

---

### Task 7: Frontend models + services

**Files:**
- Modify: `frontend/src/app/models/work-orders.models.ts`
- Modify: `frontend/src/app/services/work-orders.service.ts`

**Interfaces:**
- Consumes: wire shapes from Tasks 5–6.
- Produces (used by Tasks 8–9): `WorkOrderData` with `partId`/`quantity`/`partNumber?`/`partName?`; `BuildablePart`; `WorkOrderShortage`; `WorkOrderErrorBody`; `WorkOrdersService.getBuildableParts()`.

- [ ] **Step 1: Extend `frontend/src/app/models/work-orders.models.ts`** — replace `WorkOrderData` and append the new interfaces:

```typescript
export interface WorkOrderData {
  name: string;
  workCenterId: string;
  partId: string;
  quantity: number;
  status: WorkOrderStatus;
  startDate: string;
  endDate: string;
  partNumber?: string | null;
  partName?: string | null;
}

export interface BuildablePart {
  partId: string;
  partNumber: string;
  name: string;
  defaultWorkCenterId: string | null;
}

export interface WorkOrderShortage {
  partId: string;
  partName: string;
  requiredQty: number;
  onHand: number;
  shortBy: number;
}

export interface WorkOrderErrorBody {
  message?: string;
  shortages?: WorkOrderShortage[];
}
```

(`WorkOrderStatus`, `BaseDocument`, `WorkCenterData`, and the document types stay unchanged.)

- [ ] **Step 2: Update `frontend/src/app/services/work-orders.service.ts`** — include the new fields in create/update bodies and add the buildable-parts call. The import line gains `BuildablePart`:

```typescript
import { BuildablePart, WorkCenterDocument, WorkOrderDocument } from '../models/work-orders.models';
```

In `createWorkOrder`, the POST body becomes:

```typescript
    return this.http.post<WorkOrderDocument>(`${this.apiBaseUrl}/work-orders`, {
      name: workOrder.data.name,
      workCenterId: workOrder.data.workCenterId,
      partId: workOrder.data.partId,
      quantity: workOrder.data.quantity,
      status: workOrder.data.status,
      startDate: workOrder.data.startDate,
      endDate: workOrder.data.endDate
    });
```

In `updateWorkOrder`, the PUT body becomes the same seven fields (same additions). Then append the new method:

```typescript
  getBuildableParts(): Observable<BuildablePart[]> {
    return this.http.get<BuildablePart[]>(`${this.apiBaseUrl}/parts/buildable`);
  }
```

- [ ] **Step 3: Build the frontend** (component compile errors from the changed `WorkOrderData` are expected only if strict object literals are constructed without the new fields — the page components construct `data` objects, so this build SHOULD fail listing them):

Run: `cd frontend && npm run build`
Expected: FAILS in `work-orders-page.ts` (missing `partId`/`quantity` in object literals). That's the Task 9 work; note the errors and continue — do not commit yet. Commit for Tasks 7–9 happens at the end of Task 9. (If executing per-task with subagents, hand Tasks 7, 8, and 9 to the same agent.)

---

### Task 8: Work-order panel — part, quantity, work center

**Files:**
- Modify: `frontend/src/app/pages/work-orders/panel/work-order-panel/work-order-panel.ts`
- Modify: `frontend/src/app/pages/work-orders/panel/work-order-panel/work-order-panel.html`
- Test: `frontend/src/app/pages/work-orders/panel/work-order-panel/work-order-panel.spec.ts`

**Interfaces:**
- Consumes: `BuildablePart`, `WorkCenterDocument` (Task 7).
- Produces (used by Task 9):
  - New `@Input()`s: `buildableParts: BuildablePart[]`, `workCenters: WorkCenterDocument[]`, `defaultWorkCenterId: string | null`.
  - `WorkOrderPanelSubmitEvent.value` gains `partId: string; quantity: number; workCenterId: string;`.

- [ ] **Step 1: Update the spec tests first** — replace `work-order-panel.spec.ts` content with:

```typescript
import { TestBed } from '@angular/core/testing';
import { WorkOrderPanel } from './work-order-panel';

describe('WorkOrderPanel', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkOrderPanel]
    }).compileComponents();
  });

  function createComponent(): any {
    const fixture = TestBed.createComponent(WorkOrderPanel);
    const component = fixture.componentInstance as any;
    component.buildableParts = [
      { partId: 'part-tractor-1000', partNumber: 'FG-1000', name: 'Tractor Model 1000', defaultWorkCenterId: 'wc-003' },
      { partId: 'part-wheel-assembly', partNumber: 'ASM-310', name: 'Wheel Assembly', defaultWorkCenterId: 'wc-005' }
    ];
    component.workCenters = [
      { docId: 'wc-003', docType: 'workCenter', data: { name: 'Final Assembly' } },
      { docId: 'wc-005', docType: 'workCenter', data: { name: 'Wheel Build Line' } }
    ];
    return component;
  }

  it('should create', () => {
    expect(createComponent()).toBeTruthy();
  });

  it('should mark the form invalid when end date is before start date', () => {
    const component = createComponent();
    component.form.setValue({
      name: 'Order 1',
      status: 'open',
      partId: 'part-wheel-assembly',
      quantity: 5,
      workCenterId: 'wc-005',
      startDate: { year: 2026, month: 3, day: 10 },
      endDate: { year: 2026, month: 3, day: 9 }
    });

    expect(component.form.errors?.['dateRange']).toBeTrue();
  });

  it('should require a part and a positive quantity', () => {
    const component = createComponent();
    component.form.patchValue({ partId: null, quantity: 0 });

    expect(component.form.get('partId')?.invalid).toBeTrue();
    expect(component.form.get('quantity')?.invalid).toBeTrue();
  });

  it('should default the work center from the selected part', () => {
    const component = createComponent();
    component.form.patchValue({ workCenterId: 'wc-003' });

    component.onPartSelected('part-wheel-assembly');

    expect(component.form.get('workCenterId')?.value).toBe('wc-005');
  });

  it('should emit a save event with part, quantity, work center, and ISO dates', () => {
    const component = createComponent();
    spyOn(component.saveOrder, 'emit');

    component.mode = 'create';
    component.form.setValue({
      name: 'Order 1',
      status: 'open',
      partId: 'part-wheel-assembly',
      quantity: 8,
      workCenterId: 'wc-005',
      startDate: { year: 2026, month: 3, day: 10 },
      endDate: { year: 2026, month: 3, day: 12 }
    });

    component.onSubmit();

    expect(component.saveOrder.emit).toHaveBeenCalledWith({
      mode: 'create',
      orderId: null,
      value: {
        name: 'Order 1',
        status: 'open',
        partId: 'part-wheel-assembly',
        quantity: 8,
        workCenterId: 'wc-005',
        startDate: '2026-03-10',
        endDate: '2026-03-12'
      }
    });
  });
});
```

- [ ] **Step 2: Run frontend tests, verify the new ones fail**

Run: `cd frontend && npm test -- --watch=false --browsers=ChromeHeadless`
Expected: FAIL — `form.setValue` throws (controls `partId`/`quantity`/`workCenterId` missing) and `onPartSelected` is undefined.

- [ ] **Step 3: Update `work-order-panel.ts`.**

Import line 6 becomes:

```typescript
import { BuildablePart, WorkCenterDocument, WorkOrderDocument, WorkOrderStatus } from '../../../../models/work-orders.models';
```

`WorkOrderPanelSubmitEvent.value` becomes:

```typescript
  value: {
    name: string;
    status: WorkOrderStatus;
    partId: string;
    quantity: number;
    workCenterId: string;
    startDate: string;
    endDate: string;
  };
```

New inputs (next to the existing `@Input()`s):

```typescript
  @Input() buildableParts: BuildablePart[] = [];
  @Input() workCenters: WorkCenterDocument[] = [];
  @Input() defaultWorkCenterId: string | null = null;
```

Form group construction gains three controls (after `status`):

```typescript
        partId: [null as string | null, [Validators.required]],
        quantity: [1, [Validators.required, Validators.min(1)]],
        workCenterId: [null as string | null, [Validators.required]],
```

`isFieldInvalid`'s parameter type becomes:

```typescript
  protected isFieldInvalid(fieldName: 'name' | 'status' | 'partId' | 'quantity' | 'workCenterId' | 'startDate' | 'endDate'): boolean {
```

Add the part-selection handler (near `getStatusLabel`):

```typescript
  // ng-select's (change) hands back the item object; tests call with a plain id.
  protected onPartSelected(part: BuildablePart | string | null): void {
    const partId = typeof part === 'string' ? part : (part?.partId ?? null);
    const match = this.buildableParts.find((candidate) => candidate.partId === partId);
    if (match?.defaultWorkCenterId) {
      this.form.patchValue({ workCenterId: match.defaultWorkCenterId });
    }
  }
```

`onSubmit`'s emit becomes:

```typescript
    this.saveOrder.emit({
      mode: this.mode,
      orderId: this.order?.docId ?? null,
      value: {
        name: formValue.name ?? '',
        status: (formValue.status as WorkOrderStatus | null) ?? 'open',
        partId: formValue.partId ?? '',
        quantity: Number(formValue.quantity ?? 0),
        workCenterId: formValue.workCenterId ?? '',
        startDate,
        endDate
      }
    });
```

`resetFormFromInputs` — the edit branch's `form.reset` gains:

```typescript
        partId: this.order.data.partId,
        quantity: this.order.data.quantity,
        workCenterId: this.order.data.workCenterId,
```

and the create branch's `form.reset` gains:

```typescript
        partId: null,
        quantity: 1,
        workCenterId: this.defaultWorkCenterId,
```

- [ ] **Step 4: Update `work-order-panel.html`.** Change the subtitle (line 6) to:

```html
        <p>Specify the part, quantity, dates, name and status for this order</p>
```

Insert after the Status field's closing `</div>` (line 47) and before the End date field:

```html
      <div class="wo-field">
        <label>Part</label>
        <ng-select
          formControlName="partId"
          [items]="buildableParts"
          bindLabel="name"
          bindValue="partId"
          [clearable]="false"
          placeholder="Select a part to build"
          (change)="onPartSelected($event)"
          [ngClass]="{ 'ng-select-invalid': isFieldInvalid('partId') }"
        >
          <ng-template ng-option-tmp let-item="item">
            <span>{{ item.name }}</span>
            <span class="wo-part-number">{{ item.partNumber }}</span>
          </ng-template>
        </ng-select>
        <p class="wo-field-error" *ngIf="isFieldInvalid('partId')">Part is required.</p>
      </div>

      <div class="wo-field">
        <label>Quantity</label>
        <input
          type="number"
          formControlName="quantity"
          min="1"
          step="1"
          [class.invalid]="isFieldInvalid('quantity')"
        />
        <p class="wo-field-error" *ngIf="isFieldInvalid('quantity')">Quantity must be at least 1.</p>
      </div>

      <div class="wo-field">
        <label>Work Center</label>
        <ng-select
          formControlName="workCenterId"
          [items]="workCenters"
          bindLabel="data.name"
          bindValue="docId"
          [clearable]="false"
          [searchable]="false"
          [ngClass]="{ 'ng-select-invalid': isFieldInvalid('workCenterId') }"
        />
        <p class="wo-field-error" *ngIf="isFieldInvalid('workCenterId')">Work center is required.</p>
      </div>
```

- [ ] **Step 5: Run frontend tests**

Run: `cd frontend && npm test -- --watch=false --browsers=ChromeHeadless`
Expected: panel specs PASS. (Other suites may still fail from Task 7's model change until Task 9 — only panel failures block this task.)

Do not commit yet — Tasks 7–9 commit together at the end of Task 9.

---

### Task 9: Page wiring, shortage errors, timeline tooltip + CSV

**Files:**
- Modify: `frontend/src/app/pages/work-orders/work-orders-page/work-orders-page.ts`
- Modify: `frontend/src/app/pages/work-orders/work-orders-page/work-orders-page.html`
- Modify: `frontend/src/app/pages/work-orders/timeline/timeline.ts`
- Modify: `frontend/src/app/pages/work-orders/timeline/timeline.html`
- Test: `frontend/src/app/pages/work-orders/work-orders-page/work-orders-page.spec.ts`

**Interfaces:**
- Consumes: Tasks 7–8 surfaces; API error contract from Task 5.
- Produces: complete work-orders UI flow.

- [ ] **Step 1: Update `work-orders-page.ts`.**

Imports — add a new `HttpErrorResponse` import and REPLACE the existing models import (line 8) so it reads:

```typescript
import { HttpErrorResponse } from '@angular/common/http';
import { BuildablePart, WorkCenterDocument, WorkOrderDocument, WorkOrderErrorBody } from '../../../models/work-orders.models';
```

Add state next to `workOrders`:

```typescript
  protected buildableParts: BuildablePart[] = [];
```

`loadPageData` loads parts in the same `Promise.all`:

```typescript
      const [workCenters, workOrders, buildableParts] = await Promise.all([
        firstValueFrom(this.workOrdersService.getWorkCenters()),
        firstValueFrom(this.workOrdersService.getWorkOrders()),
        firstValueFrom(this.workOrdersService.getBuildableParts())
      ]);
      this.workCenters = workCenters;
      this.workOrders = workOrders;
      this.buildableParts = buildableParts;
```

In `onSaveOrder`, the work center now comes from the panel (line 152-155):

```typescript
    const targetWorkCenterId = event.value.workCenterId;
```

Both the update and create payloads' `data` objects gain (next to `workCenterId`):

```typescript
            partId: event.value.partId,
            quantity: event.value.quantity,
```

Both `catch` blocks become error-aware. Edit branch:

```typescript
      } catch (error) {
        this.panelSaveError = this.buildSaveErrorMessage(error, 'Unable to save the work order. Check that the API is running.');
      }
```

Create branch:

```typescript
    } catch (error) {
      this.panelSaveError = this.buildSaveErrorMessage(error, 'Unable to create the work order. Check that the API is running.');
    }
```

`onDeleteWorkOrder`'s catch becomes (a delete can now be rejected, e.g. reversal guard):

```typescript
    } catch (error) {
      this.loadError = this.buildSaveErrorMessage(error, 'Unable to delete the work order. Check that the API is running.');
    }
```

Add the helper (near `escapeCsvValue`):

```typescript
  private buildSaveErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as WorkOrderErrorBody | null;
      if (body?.shortages?.length) {
        const details = body.shortages
          .map((shortage) => `${shortage.partName}: need ${shortage.requiredQty}, on hand ${shortage.onHand} (short ${shortage.shortBy})`)
          .join('; ');
        return `${body.message ?? 'Cannot complete: insufficient component inventory.'} ${details}`;
      }
      if (body?.message) {
        return body.message;
      }
    }
    return fallback;
  }
```

CSV export gains Part/Quantity — headers become:

```typescript
      ['Work Center', 'Work Order', 'Part', 'Quantity', 'Status', 'Start Date', 'End Date'],
```

and the row mapping in `buildExportRows` becomes:

```typescript
      .map((order) => [
        workCenterNameById.get(order.data.workCenterId) ?? 'Unknown Work Center',
        order.data.name,
        order.data.partName ?? order.data.partId,
        `${order.data.quantity}`,
        this.formatStatusForExport(order.data.status),
        order.data.startDate,
        order.data.endDate
      ]);
```

- [ ] **Step 2: Update `work-orders-page.html`** — the `<app-work-order-panel>` element gains three bindings:

```html
  <app-work-order-panel
    [open]="isPanelOpen"
    [mode]="panelMode"
    [order]="selectedOrder"
    [buildableParts]="buildableParts"
    [workCenters]="workCenters"
    [defaultWorkCenterId]="pendingCreateWorkCenterId"
    [defaultStartDate]="pendingCreateStartDate"
    [saveError]="panelSaveError"
    (closePanel)="onClosePanel()"
    (saveOrder)="onSaveOrder($event)"
  />
```

- [ ] **Step 3: Timeline tooltip.** In `timeline.ts`, next to `getWorkOrderTooltipStatus` (line 117), add:

```typescript
  getWorkOrderTooltipPart(order: WorkOrderDocument): string {
    const label = order.data.partName ?? order.data.partId;
    return `${label} × ${order.data.quantity}`;
  }
```

In `timeline.html`, inside the floating tooltip (after the `wo-bar-tooltip-name` div at line 132), add:

```html
          <div class="wo-bar-tooltip-part">{{ getWorkOrderTooltipPart(hoveredTooltipOrder) }}</div>
```

- [ ] **Step 4: Update `work-orders-page.spec.ts`** — the existing spy object and mock data no longer compile (`getBuildableParts` missing; work-order literal lacks `partId`/`quantity`), and the new error formatting deserves a test. Replace the file with:

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { WorkOrdersPage } from './work-orders-page';
import { WorkOrdersService } from '../../../services/work-orders.service';
import { AuthService } from '../../../auth/auth.service';

describe('WorkOrdersPage', () => {
  const workOrdersService = jasmine.createSpyObj<WorkOrdersService>('WorkOrdersService', [
    'getWorkCenters',
    'getWorkOrders',
    'getBuildableParts',
    'createWorkOrder',
    'updateWorkOrder',
    'deleteWorkOrder'
  ]);

  const authService = jasmine.createSpyObj<AuthService>('AuthService', ['currentUser', 'logout', 'canManageWorkOrders']);

  beforeEach(async () => {
    workOrdersService.getWorkCenters.calls.reset();
    workOrdersService.getWorkOrders.calls.reset();
    workOrdersService.getBuildableParts.calls.reset();
    authService.currentUser.calls.reset();
    authService.logout.calls.reset();
    authService.canManageWorkOrders.calls.reset();

    workOrdersService.getWorkCenters.and.returnValue(of([
      { docId: 'wc-005', docType: 'workCenter', data: { name: 'Wheel Build Line' } }
    ]));
    workOrdersService.getWorkOrders.and.returnValue(of([
      {
        docId: 'wo-001',
        docType: 'workOrder',
        data: {
          name: 'Order 1',
          workCenterId: 'wc-005',
          partId: 'part-wheel-assembly',
          quantity: 8,
          status: 'open',
          startDate: '2026-03-01',
          endDate: '2026-03-05',
          partNumber: 'ASM-310',
          partName: 'Wheel Assembly'
        }
      }
    ]));
    workOrdersService.getBuildableParts.and.returnValue(of([
      { partId: 'part-wheel-assembly', partNumber: 'ASM-310', name: 'Wheel Assembly', defaultWorkCenterId: 'wc-005' }
    ]));
    authService.currentUser.and.returnValue({
      userId: '1',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      role: 'Admin'
    });
    authService.canManageWorkOrders.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [WorkOrdersPage],
      providers: [
        provideRouter([]),
        { provide: WorkOrdersService, useValue: workOrdersService },
        { provide: AuthService, useValue: authService }
      ]
    }).compileComponents();
  });

  it('should load work centers, work orders, and buildable parts on init', async () => {
    const fixture = TestBed.createComponent(WorkOrdersPage);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance as any;
    expect(component.workCenters.length).toBe(1);
    expect(component.workOrders.length).toBe(1);
    expect(component.buildableParts.length).toBe(1);
  });

  it('should open create mode when a timeline create event occurs', async () => {
    const fixture = TestBed.createComponent(WorkOrdersPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as any;

    component.onCreateWorkOrder({ workCenterId: 'wc-005', startDate: '2026-03-10' });

    expect(component.isPanelOpen).toBeTrue();
    expect(component.panelMode).toBe('create');
    expect(component.pendingCreateWorkCenterId).toBe('wc-005');
  });

  it('should format shortage errors from the API into a readable message', async () => {
    const fixture = TestBed.createComponent(WorkOrdersPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as any;

    const error = new HttpErrorResponse({
      status: 400,
      error: {
        message: 'Cannot complete: insufficient component inventory.',
        shortages: [
          { partId: 'part-tire-26', partName: '26in Tractor Tire', requiredQty: 8, onHand: 5, shortBy: 3 }
        ]
      }
    });

    const message = component.buildSaveErrorMessage(error, 'fallback');

    expect(message).toContain('Cannot complete');
    expect(message).toContain('26in Tractor Tire: need 8, on hand 5 (short 3)');
  });

  it('should log out through the auth service', async () => {
    const fixture = TestBed.createComponent(WorkOrdersPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance as any;

    component.onLogout();

    expect(authService.logout).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Build and test the frontend**

Run: `cd frontend && npm run build && npm test -- --watch=false --browsers=ChromeHeadless`
Expected: build succeeds; all specs PASS.

- [ ] **Step 6: Commit Tasks 7–9**

```bash
git add frontend/src/app/models/work-orders.models.ts frontend/src/app/services/work-orders.service.ts frontend/src/app/pages/work-orders
git commit -m "feat(frontend): part, quantity, and work-center selection with shortage errors"
```

---

### Task 10: Planning grid Allocated column

**Files:**
- Modify: `frontend/src/app/pages/planning/planning-page/planning-page.html:131-158`
- Modify: `frontend/src/app/pages/planning/planning-page/planning-page.ts:102-118`

**Interfaces:**
- Consumes: `quantityAllocated` — already present in `ComponentGapDocument` (both API and TS model). No backend change.
- Produces: Allocated visible in the grid and its CSV.

- [ ] **Step 1: Add the column to the grid.** In `planning-page.html`, after `<th>Available</th>` (line 138) add:

```html
              <th>Allocated</th>
```

and after the Available cell (line 153) add:

```html
              <td>{{ item.quantityAllocated }}</td>
```

- [ ] **Step 2: Add it to the grid CSV.** In `exportGridCsv` (planning-page.ts), the headers array becomes:

```typescript
      ['Component', 'Part Number', 'Type', 'Work Center', 'Required', 'Available', 'Allocated', 'On Order', 'Shortage', 'Ready Days'],
```

and after `this.formatCsvNumber(item.quantityAvailable),` add:

```typescript
        this.formatCsvNumber(item.quantityAllocated),
```

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pages/planning
git commit -m "feat(frontend): show allocated quantity in planning grid and CSV"
```

---

### Task 11: Documentation — prd.md, tasks.md, architecture.md, README

**Files:**
- Create: `docs/prd.md`
- Create: `docs/tasks.md`
- Create: `docs/architecture.md`
- Modify: `README.md` (feature bullets)

**Interfaces:**
- Consumes: the finished behavior from Tasks 1–10 and the design spec.
- Produces: user-facing documentation. No code.

- [ ] **Step 1: Write `docs/prd.md`.** Required content (write full prose, no placeholders):
  - **Overview:** manufacturing scheduling + planning app; two main views (Work Orders timeline, Planning dashboard) plus auth and admin.
  - **Roles:** Viewer (read-only), Planner (work-order mutations), Admin (Planner + user management); JWT auth; `PlannerWriteAccess` policy gates POST/PUT/DELETE.
  - **Work Orders view:** timeline by work center with Day/Week/Month scales; each order is a *production order* — name, part (from the buildable list: parts with a BOM), quantity (> 0), work center (defaults from the part's `defaultWorkCenterId`, overridable), status, date range; overlap validation per work center; CSV export including Part and Quantity.
  - **Production-order lifecycle** (reproduce spec §2's table in user terms): open/in-progress/blocked allocate component stock; complete consumes components and receives the finished good; delete/reopen reverse; completion is blocked with a per-component shortage message when stock is insufficient; inventory can never go negative.
  - **Planning view:** BOM explosion for a target product/quantity; summary cards (Target, Buildable Now, Total Shortage, Critical Part); three charts; component gap grid with Required / Available / **Allocated** / On Order / Shortage / Ready Days and CSV exports.
  - **Out of scope** (from spec): multi-level MRP, partial issues, scrap, capacity checks, ProductionDemand usage.

- [ ] **Step 2: Write `docs/tasks.md`** — the implementation checklist for this feature, one section per task of this plan (Tasks 1 through 12, including 5b) with its file list and a `- [x]`/`- [ ]` checkbox reflecting actual completion state at time of writing. State at the top that the source of truth for design is the spec and for sequencing is this plan (link both paths).

- [ ] **Step 3: Write `docs/architecture.md`.** Required content:
  - **Stack:** Angular 20 (standalone, signals-free components with inputs/outputs, ng-select, Highcharts), ASP.NET Core net10.0 with raw ADO.NET (`Microsoft.Data.SqlClient`), SQL Server, JWT auth, deployed on Railway.
  - **API surface table:** every endpoint incl. `GET /api/work-centers`, `GET/POST /api/work-orders`, `PUT/DELETE /api/work-orders/{id}`, `GET /api/parts/buildable`, `GET /api/planning/component-gaps?partId&targetQty`, auth + admin endpoints; note the `{docId, docType, data}` document wire shape and the 400 shortage payload.
  - **Schema:** all tables with columns, incl. the new `WorkOrders.PartId` (FK → Parts) and `Quantity` (CHECK > 0); script run order NaologicDb → Planning → WorkOrders → Users; migration script for pre-existing DBs.
  - **Inventory lifecycle:** the `InventoryPlanner` (pure transition math: reverse old effect + apply new effect, shortage check on OnHand, negative guards) and `WorkOrderInventoryService` (UPDLOCK loads, single transaction, row-on-demand inventory creation). Include the lifecycle table from spec §2.
  - **WO ↔ Planning data flow:** mutations move `Inventory.QuantityAllocated`/`QuantityOnHand` → planning query computes Available = OnHand − Allocated → grid/charts react on reload.

- [ ] **Step 4: Update `README.md` feature bullets.** In "The frontend allows users to:" change the create/edit bullet to mention part + quantity selection from buildable parts; add a bullet "see planning availability react to work-order lifecycle changes (allocation, consumption, receipt)". In "The backend is responsible for:" add "enforcing the production-order inventory lifecycle (allocate / consume / receive / reverse) transactionally with shortage blocking". Keep the Database setup section added in Task 1.

- [ ] **Step 5: Commit**

```bash
git add docs/prd.md docs/tasks.md docs/architecture.md README.md
git commit -m "docs: add PRD, architecture, and task checklist for production-order integration"
```

---

### Task 12: End-to-end verification

**Files:** none (verification only; fix regressions where found).

**Interfaces:**
- Consumes: everything.
- Produces: a verified, demoable feature.

- [ ] **Step 1: Full builds and test suites**

Run:
```bash
cd /Users/andynguyen/Desktop/Naologic
dotnet build Naologic.sln && dotnet test Naologic.sln
cd frontend && npm run build && npm test -- --watch=false --browsers=ChromeHeadless
```
Expected: all green. If a disposable test DB is available, also run `dotnet test` with `NAOLOGIC_TEST_DB` set (see Task 5b) so the integration tests execute for real.

- [ ] **Step 2: Prepare a database.** Confirm `ConnectionStrings:DefaultConnection` in `api/appsettings.json` (or `appsettings.Development.json`) points at a SQL Server that has either (a) the four scripts run fresh in order, or (b) an old schema plus `Migration_WorkOrderParts.sql`. **Do not run the migration against the Railway production DB in this task** — that is a deploy step for the user to trigger.

- [ ] **Step 3: API smoke — the manual demo script from spec §7.**

Run (adjust the port if `dotnet run` reports a different one):
```bash
cd api && dotnet run &
sleep 8
TOKEN=$(curl -s -X POST http://localhost:5080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"naologic.admin@example.com","password":"NaoAdmin123!"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 1. Buildable parts → exactly Tractor Model 1000 and Wheel Assembly.
curl -s http://localhost:5080/api/parts/buildable -H "Authorization: Bearer $TOKEN"

# 2. Baseline planning at target 10 → wheel-assembly quantityAllocated 24, quantityAvailable 6.
curl -s "http://localhost:5080/api/planning/component-gaps?partId=part-tractor-1000&targetQty=10" -H "Authorization: Bearer $TOKEN"

# 3. Create an open tractor order ×1 → 201; re-query planning: frame/engine/seat/hydraulic/control allocated 7, wheel 28.
curl -s -X POST http://localhost:5080/api/work-orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Demo Tractor","workCenterId":"wc-003","partId":"part-tractor-1000","quantity":1,"status":"open","startDate":"2026-06-01","endDate":"2026-06-20"}'

# 4. Force a deterministic shortage: completing 9 tractors needs 9 frames (on hand 8)
#    and 36 wheels (on hand 30).
curl -s -X POST http://localhost:5080/api/work-orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Doomed Tractor","workCenterId":"wc-003","partId":"part-tractor-1000","quantity":9,"status":"complete","startDate":"2026-07-01","endDate":"2026-07-05"}'
# Expected: 400 {"message":"Cannot complete: insufficient component inventory.","shortages":[...frame short 1, wheel short 6...]}
#           and no "Doomed Tractor" row or inventory movement afterward (transaction rolled back).

# 5. Complete Wheel Batch 2 (wo-003, qty 8) → 200; planning: wheel quantityOnHand 38, quantityAvailable 14.
curl -s -X PUT http://localhost:5080/api/work-orders/wo-003 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Wheel Assembly Batch 2","workCenterId":"wc-005","partId":"part-wheel-assembly","quantity":8,"status":"complete","startDate":"2025-12-01","endDate":"2026-02-10"}'
curl -s "http://localhost:5080/api/planning/component-gaps?partId=part-tractor-1000&targetQty=10" -H "Authorization: Bearer $TOKEN"

# 6. Reverse the demo changes: reopen wo-003 and delete the Demo Tractor order (use its id from step 3).
curl -s -X PUT http://localhost:5080/api/work-orders/wo-003 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Wheel Assembly Batch 2","workCenterId":"wc-005","partId":"part-wheel-assembly","quantity":8,"status":"in-progress","startDate":"2025-12-01","endDate":"2026-02-10"}'
curl -s -X DELETE http://localhost:5080/api/work-orders/<demo-order-id> -H "Authorization: Bearer $TOKEN"

# 7. Confirm planning is back to baseline (allocated 24 / available 6 on wheel-assembly).
curl -s "http://localhost:5080/api/planning/component-gaps?partId=part-tractor-1000&targetQty=10" -H "Authorization: Bearer $TOKEN"
kill %1
```
Expected values per spec §5: baseline wheel `quantityOnHand 30 / quantityAllocated 24 / quantityAvailable 6`; after completing wo-003: `38 / 24 / 14`; after reversal: baseline again.

- [ ] **Step 4: Browser sanity pass** (optional but recommended): `ng serve` against the same API, log in as admin, verify — part select shows only two parts with part numbers; picking Wheel Assembly flips work center to Wheel Build Line; quantity 0 is rejected; completing an order with insufficient stock renders the shortage list in the panel; timeline tooltip shows "Wheel Assembly × 8"; planning grid shows the Allocated column.

- [ ] **Step 5: Fix anything found, then final commit if fixes were made**

```bash
git add -A
git commit -m "fix: address end-to-end verification findings"
```

Only commit if there were changes.
