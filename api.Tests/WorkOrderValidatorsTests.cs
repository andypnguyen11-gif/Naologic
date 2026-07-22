using Naologic_API.Models.WorkOrders;
using Naologic_API.Validation;

namespace Naologic_API.Tests;

public class WorkOrderValidatorsTests
{
    private static CreateWorkOrderRequest Request(decimal quantity) => new(
        "Order 1", "wc-005", "open", "2026-08-01", "2026-08-05",
        "part-wheel-assembly", quantity);

    [Fact]
    public void ValidRequest_ReturnsNoErrors()
    {
        Assert.Null(WorkOrderValidators.ValidateWorkOrderRequest(Request(1)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    public void QuantityZeroOrNegative_IsRejected(int quantity)
    {
        var errors = WorkOrderValidators.ValidateWorkOrderRequest(Request(quantity));

        Assert.NotNull(errors);
        var message = Assert.Single(errors!["quantity"]);
        Assert.Equal("Quantity must be greater than zero.", message);
    }

    [Fact]
    public void MissingPart_IsRejected()
    {
        var request = new CreateWorkOrderRequest(
            "Order 1", "wc-005", "open", "2026-08-01", "2026-08-05", "", 1);

        var errors = WorkOrderValidators.ValidateWorkOrderRequest(request);

        Assert.NotNull(errors);
        Assert.Contains("partId", errors!.Keys);
    }
}
