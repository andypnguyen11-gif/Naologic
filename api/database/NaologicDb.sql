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
