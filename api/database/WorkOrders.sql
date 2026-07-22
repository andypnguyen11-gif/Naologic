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
