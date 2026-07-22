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
-- WARNING: this discards ALL existing WorkOrders rows, including any
-- user-created ones, not just the original seed data. Pre-migration orders
-- have no PartId/Quantity, and there is no honest way to backfill those
-- values, so every row is intentionally dropped and replaced with the
-- fixed production-order seed set below.
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

-- 6. Unique-index hardening (idempotent, safe to re-run even though the
--    rest of this script is not): closes the row-on-demand Inventory
--    insert race and stops duplicate BOM lines from double-counting
--    required quantity in the shortage/planning math.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Inventory_PartId' AND object_id = OBJECT_ID('Inventory'))
    CREATE UNIQUE INDEX UX_Inventory_PartId ON Inventory (PartId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_BOM_Parent_Component' AND object_id = OBJECT_ID('BillOfMaterials'))
    CREATE UNIQUE INDEX UX_BOM_Parent_Component ON BillOfMaterials (ParentPartId, ComponentPartId);
GO
