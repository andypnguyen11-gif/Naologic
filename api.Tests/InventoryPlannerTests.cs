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
