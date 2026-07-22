namespace Naologic_API.Services;

// Pure inventory math for work-order lifecycle transitions. No SQL here — the
// executor loads state, calls PlanTransition, and applies the returned deltas
// inside one transaction. Every transition is modeled as: reverse the old
// order's effect, apply the new order's effect, then validate the result.

public sealed record OrderState(string PartId, decimal Quantity, string Status);

public sealed record BomLine(string ComponentPartId, decimal QuantityPer);

public sealed record InventoryQuantities(decimal OnHand, decimal Allocated)
{
    public static readonly InventoryQuantities Zero = new(0, 0);
}

public sealed record InventoryDelta(decimal OnHand, decimal Allocated);

public sealed record ShortageDetail(
    string PartId, string PartName, decimal RequiredQty, decimal OnHand, decimal ShortBy);

public sealed record PlanError(string Message, IReadOnlyList<ShortageDetail>? Shortages = null);

public sealed record PlanResult(IReadOnlyDictionary<string, InventoryDelta>? Deltas, PlanError? Error)
{
    public static PlanResult Success(IReadOnlyDictionary<string, InventoryDelta> deltas) => new(deltas, null);
    public static PlanResult Failure(PlanError error) => new(null, error);
}

public static class InventoryPlanner
{
    private const string CompleteStatus = "complete";

    public static PlanResult PlanTransition(
        OrderState? oldState,
        OrderState? newState,
        IReadOnlyDictionary<string, IReadOnlyList<BomLine>> bomByParent,
        IReadOnlyDictionary<string, InventoryQuantities> inventory,
        IReadOnlyDictionary<string, string> partNames)
    {
        var deltas = new Dictionary<string, (decimal OnHand, decimal Allocated)>();

        void Accumulate(string partId, decimal onHand, decimal allocated)
        {
            var current = deltas.GetValueOrDefault(partId);
            deltas[partId] = (current.OnHand + onHand, current.Allocated + allocated);
        }

        // sign = +1 applies an order's effect, -1 reverses it.
        void ApplyEffect(OrderState state, int sign)
        {
            var components = bomByParent.GetValueOrDefault(state.PartId, []);
            if (state.Status == CompleteStatus)
            {
                foreach (var line in components)
                {
                    Accumulate(line.ComponentPartId, -line.QuantityPer * state.Quantity * sign, 0);
                }
                Accumulate(state.PartId, state.Quantity * sign, 0);
            }
            else
            {
                foreach (var line in components)
                {
                    Accumulate(line.ComponentPartId, 0, line.QuantityPer * state.Quantity * sign);
                }
            }
        }

        if (oldState is not null)
        {
            ApplyEffect(oldState, -1);
        }
        if (newState is not null)
        {
            ApplyEffect(newState, 1);
        }

        decimal FinalOnHand(string partId) =>
            inventory.GetValueOrDefault(partId, InventoryQuantities.Zero).OnHand
            + deltas.GetValueOrDefault(partId).OnHand;

        string NameOf(string partId) => partNames.GetValueOrDefault(partId, partId);

        // Completion shortage gets a specific, actionable payload. The check is
        // against OnHand, not Available: the old state's reversal (including the
        // order's own allocation release) is already inside the deltas.
        if (newState?.Status == CompleteStatus)
        {
            var shortages = new List<ShortageDetail>();
            foreach (var line in bomByParent.GetValueOrDefault(newState.PartId, []))
            {
                var required = line.QuantityPer * newState.Quantity;
                var finalOnHand = FinalOnHand(line.ComponentPartId);
                if (finalOnHand < 0)
                {
                    // Report on-hand as the stock the completion actually draws
                    // from: current stock with the old order's effect reversed.
                    shortages.Add(new ShortageDetail(
                        line.ComponentPartId,
                        NameOf(line.ComponentPartId),
                        required,
                        finalOnHand + required,
                        -finalOnHand));
                }
            }

            if (shortages.Count > 0)
            {
                return PlanResult.Failure(new PlanError(
                    "Cannot complete: insufficient component inventory.", shortages));
            }
        }

        // Generic guard: no transition may drive OnHand or Allocated negative.
        // Reject loudly instead of clamping — a negative here means the data is
        // inconsistent and silent repair would hide it.
        foreach (var (partId, delta) in deltas)
        {
            var current = inventory.GetValueOrDefault(partId, InventoryQuantities.Zero);
            if (current.OnHand + delta.OnHand < 0)
            {
                return PlanResult.Failure(new PlanError(
                    $"Operation would drive on-hand inventory negative for {NameOf(partId)}."));
            }
            if (current.Allocated + delta.Allocated < 0)
            {
                return PlanResult.Failure(new PlanError(
                    $"Operation would drive allocated inventory negative for {NameOf(partId)}."));
            }
        }

        var materialized = deltas
            .Where(entry => entry.Value.OnHand != 0 || entry.Value.Allocated != 0)
            .ToDictionary(
                entry => entry.Key,
                entry => new InventoryDelta(entry.Value.OnHand, entry.Value.Allocated));
        return PlanResult.Success(materialized);
    }
}
