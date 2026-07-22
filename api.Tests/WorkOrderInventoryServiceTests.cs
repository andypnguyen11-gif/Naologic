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

    private static async Task ExecuteAsync(string sql)
    {
        await using var connection = new SqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<int> CountOrdersNamedAsync(string name)
    {
        await using var connection = new SqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new SqlCommand(
            "SELECT COUNT(1) FROM WorkOrders WHERE Name = @name;", connection);
        command.Parameters.AddWithValue("@name", name);
        return (int)await command.ExecuteScalarAsync();
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
        var cleanupOrderId = created.Document!.DocId;
        try
        {
            var tireDuring = await GetInventoryAsync("part-tire-26");
            Assert.Equal(tireBefore.Allocated + 2, tireDuring.Allocated);
            Assert.Equal(tireBefore.OnHand, tireDuring.OnHand);

            var deleted = await service.DeleteAsync(cleanupOrderId, CancellationToken.None);
            cleanupOrderId = null;
            Assert.Null(deleted.Error);
            Assert.Equal(tireBefore, await GetInventoryAsync("part-tire-26"));
        }
        finally
        {
            // A mid-test assertion failure must not leave mutated seed rows behind.
            if (cleanupOrderId is not null)
            {
                await service.DeleteAsync(cleanupOrderId, CancellationToken.None);
            }
        }
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
        var cleanupOrderId = created.Document!.DocId;
        try
        {
            Assert.Equal(tireBefore.OnHand - 1, (await GetInventoryAsync("part-tire-26")).OnHand);
            Assert.Equal(wheelBefore.OnHand + 1, (await GetInventoryAsync("part-wheel-assembly")).OnHand);

            var deleted = await service.DeleteAsync(cleanupOrderId, CancellationToken.None);
            cleanupOrderId = null;
            Assert.Null(deleted.Error);
            Assert.Equal(tireBefore, await GetInventoryAsync("part-tire-26"));
            Assert.Equal(wheelBefore, await GetInventoryAsync("part-wheel-assembly"));
        }
        finally
        {
            if (cleanupOrderId is not null)
            {
                await service.DeleteAsync(cleanupOrderId, CancellationToken.None);
            }
        }
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
        Assert.Equal(0, await CountOrdersNamedAsync("Doomed Tractor"));
    }

    [Fact]
    public async Task Create_PartWithoutBom_IsRejected()
    {
        if (ConnectionString is null) return;
        var service = CreateService();
        var tireBefore = await GetInventoryAsync("part-tire-26");

        // part-tire-26 is a purchased component with no BOM of its own.
        var request = new CreateWorkOrderRequest(
            "No BOM Order", "wc-005", "open", "2026-08-01", "2026-08-05",
            "part-tire-26", 1);
        var result = await service.CreateAsync(request, CancellationToken.None);

        Assert.NotNull(result.Error);
        Assert.Contains("bill of materials", result.Error!.Message);
        Assert.Equal(tireBefore, await GetInventoryAsync("part-tire-26"));
        Assert.Equal(0, await CountOrdersNamedAsync("No BOM Order"));
    }

    [Fact]
    public async Task Complete_ProducedPartWithoutInventoryRow_InsertsRowOnDemand()
    {
        if (ConnectionString is null) return;
        var service = CreateService();
        string? cleanupOrderId = null;

        // Remove the finished good's inventory row so the receipt has nothing
        // to UPDATE and must take the row-on-demand INSERT branch.
        await ExecuteAsync("DELETE FROM Inventory WHERE PartId = 'part-tractor-1000';");
        try
        {
            var request = new CreateWorkOrderRequest(
                "Row On Demand Tractor", "wc-003", "complete", "2026-08-01", "2026-08-05",
                "part-tractor-1000", 1);
            var created = await service.CreateAsync(request, CancellationToken.None);
            Assert.Null(created.Error);
            cleanupOrderId = created.Document!.DocId;

            var tractor = await GetInventoryAsync("part-tractor-1000");
            Assert.Equal(1m, tractor.OnHand);
            Assert.Equal(0m, tractor.Allocated);
        }
        finally
        {
            if (cleanupOrderId is not null)
            {
                await service.DeleteAsync(cleanupOrderId, CancellationToken.None);
            }
            // Restore the seed row exactly (Planning.sql inv-009).
            await ExecuteAsync("DELETE FROM Inventory WHERE PartId = 'part-tractor-1000';");
            await ExecuteAsync("""
                INSERT INTO Inventory (InventoryId, PartId, QuantityOnHand, QuantityAllocated, QuantityOnOrder, SafetyStock)
                VALUES ('inv-009', 'part-tractor-1000', 2, 0, 0, 0);
                """);
        }
    }

    [Fact]
    public async Task Update_ReversesOldStateThenAppliesNew()
    {
        if (ConnectionString is null) return;
        var service = CreateService();
        var tireBefore = await GetInventoryAsync("part-tire-26");

        var created = await service.CreateAsync(WheelOrder(2, "open"), CancellationToken.None);
        Assert.Null(created.Error);
        var cleanupOrderId = created.Document!.DocId;
        try
        {
            var update = new UpdateWorkOrderRequest(
                "Integration Test Order", "wc-005", "open", "2026-08-01", "2026-08-05",
                "part-wheel-assembly", 5);
            var updated = await service.UpdateAsync(cleanupOrderId, update, CancellationToken.None);
            Assert.Null(updated.Error);
            Assert.Equal(tireBefore.Allocated + 5, (await GetInventoryAsync("part-tire-26")).Allocated);

            await service.DeleteAsync(cleanupOrderId, CancellationToken.None);
            cleanupOrderId = null;
            Assert.Equal(tireBefore, await GetInventoryAsync("part-tire-26"));
        }
        finally
        {
            if (cleanupOrderId is not null)
            {
                await service.DeleteAsync(cleanupOrderId, CancellationToken.None);
            }
        }
    }
}
