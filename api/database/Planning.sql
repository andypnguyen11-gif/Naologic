USE NaologicDb;
GO

CREATE TABLE Parts (
    PartId NVARCHAR(50) NOT NULL PRIMARY KEY,
    PartNumber NVARCHAR(50) NOT NULL,
    Name NVARCHAR(200) NOT NULL,
    PartType NVARCHAR(30) NOT NULL,
    DefaultWorkCenterId NVARCHAR(50) NULL,
    StandardBuildDays INT NOT NULL DEFAULT 0,
    StandardLeadDays INT NOT NULL DEFAULT 0,
    UnitCost DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT FK_Parts_WorkCenters
        FOREIGN KEY (DefaultWorkCenterId) REFERENCES WorkCenters(WorkCenterId),
    CONSTRAINT CK_Parts_PartType
        CHECK (PartType IN ('finished-good', 'assembly', 'manufactured', 'purchased'))
);
GO

CREATE TABLE BillOfMaterials (
    BomId NVARCHAR(50) NOT NULL PRIMARY KEY,
    ParentPartId NVARCHAR(50) NOT NULL,
    ComponentPartId NVARCHAR(50) NOT NULL,
    QuantityPer DECIMAL(12,2) NOT NULL,
    CONSTRAINT FK_BOM_ParentPart
        FOREIGN KEY (ParentPartId) REFERENCES Parts(PartId),
    CONSTRAINT FK_BOM_ComponentPart
        FOREIGN KEY (ComponentPartId) REFERENCES Parts(PartId),
    CONSTRAINT CK_BOM_QuantityPer
        CHECK (QuantityPer > 0)
);
GO

CREATE TABLE Inventory (
    InventoryId NVARCHAR(50) NOT NULL PRIMARY KEY,
    PartId NVARCHAR(50) NOT NULL,
    QuantityOnHand DECIMAL(12,2) NOT NULL DEFAULT 0,
    QuantityAllocated DECIMAL(12,2) NOT NULL DEFAULT 0,
    QuantityOnOrder DECIMAL(12,2) NOT NULL DEFAULT 0,
    SafetyStock DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT FK_Inventory_Parts
        FOREIGN KEY (PartId) REFERENCES Parts(PartId)
);
GO

CREATE TABLE ProductionDemand (
    DemandId NVARCHAR(50) NOT NULL PRIMARY KEY,
    ProductPartId NVARCHAR(50) NOT NULL,
    DemandMonth DATE NOT NULL,
    QuantityRequired INT NOT NULL,
    CONSTRAINT FK_ProductionDemand_Parts
        FOREIGN KEY (ProductPartId) REFERENCES Parts(PartId),
    CONSTRAINT CK_ProductionDemand_Quantity
        CHECK (QuantityRequired > 0)
);
GO

INSERT INTO Parts (PartId, PartNumber, Name, PartType, DefaultWorkCenterId, StandardBuildDays, StandardLeadDays, UnitCost)
VALUES
('part-tractor-1000', 'FG-1000', 'Tractor Model 1000', 'finished-good', 'wc-003', 2, 0, 48000.00),
('part-frame-assembly', 'ASM-110', 'Frame Assembly', 'assembly', 'wc-003', 5, 0, 4200.00),
('part-engine-diesel', 'PUR-210', 'Diesel Engine', 'purchased', NULL, 0, 14, 9200.00),
('part-wheel-assembly', 'ASM-310', 'Wheel Assembly', 'assembly', 'wc-005', 3, 0, 850.00),
('part-seat-cab', 'PUR-410', 'Seat Cab', 'purchased', NULL, 0, 7, 650.00),
('part-hydraulic-kit', 'PUR-510', 'Hydraulic Kit', 'purchased', NULL, 0, 10, 1500.00),
('part-control-panel', 'MFG-610', 'Control Panel', 'manufactured', 'wc-002', 4, 0, 1200.00),
('part-tire-26', 'PUR-311', '26in Tractor Tire', 'purchased', NULL, 0, 6, 210.00),
('part-rim-26', 'MFG-312', '26in Wheel Rim', 'manufactured', 'wc-002', 2, 0, 140.00);
GO

INSERT INTO BillOfMaterials (BomId, ParentPartId, ComponentPartId, QuantityPer)
VALUES
('bom-001', 'part-tractor-1000', 'part-frame-assembly', 1),
('bom-002', 'part-tractor-1000', 'part-engine-diesel', 1),
('bom-003', 'part-tractor-1000', 'part-wheel-assembly', 4),
('bom-004', 'part-tractor-1000', 'part-seat-cab', 1),
('bom-005', 'part-tractor-1000', 'part-hydraulic-kit', 1),
('bom-006', 'part-tractor-1000', 'part-control-panel', 1),
('bom-007', 'part-wheel-assembly', 'part-tire-26', 1),
('bom-008', 'part-wheel-assembly', 'part-rim-26', 1);
GO

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

INSERT INTO ProductionDemand (DemandId, ProductPartId, DemandMonth, QuantityRequired)
VALUES
('dem-001', 'part-tractor-1000', '2026-04-01', 10);
GO
