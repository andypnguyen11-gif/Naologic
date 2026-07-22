USE NaologicDb;
GO

-- Re-run guard: unlike the demo-data scripts, Users is created only if
-- missing — replaying the seed sequence must never delete accounts.
IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE Users (
        UserId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        Email NVARCHAR(255) NOT NULL,
        PasswordHash NVARCHAR(500) NOT NULL,
        FirstName NVARCHAR(100) NOT NULL,
        LastName NVARCHAR(100) NOT NULL,
        Role NVARCHAR(50) NOT NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_Email' AND object_id = OBJECT_ID('dbo.Users'))
BEGIN
    CREATE UNIQUE INDEX UX_Users_Email ON Users (Email);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Users_Role')
BEGIN
    ALTER TABLE Users
    ADD CONSTRAINT CK_Users_Role
    CHECK (Role IN ('Admin', 'Planner', 'Viewer'));
END;
GO
