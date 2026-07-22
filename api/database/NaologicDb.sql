IF DB_ID('NaologicDb') IS NULL
BEGIN
    CREATE DATABASE NaologicDb;
END;
GO

USE NaologicDb;
GO

-- Re-run guard: drop demo tables in FK-dependency order so the seed scripts
-- can be replayed without manually dropping the database. Users is left
-- untouched on purpose — re-seeding demo data must not delete accounts.
DROP TABLE IF EXISTS WorkOrders;
DROP TABLE IF EXISTS ProductionDemand;
DROP TABLE IF EXISTS Inventory;
DROP TABLE IF EXISTS BillOfMaterials;
DROP TABLE IF EXISTS Parts;
DROP TABLE IF EXISTS WorkCenters;
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
