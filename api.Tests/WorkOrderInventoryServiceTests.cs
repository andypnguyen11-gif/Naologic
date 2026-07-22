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
