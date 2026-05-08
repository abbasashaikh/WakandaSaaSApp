namespace NovaCraft.Models;

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Subscription? Subscription { get; set; }
    public List<PaymentRequest> PaymentRequests { get; set; } = new();
}

public class Subscription
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public bool HasAccess { get; set; } = false;
    public string PlanName { get; set; } = "";
    public int CreditsRemaining { get; set; } = 0;
    public DateTime? PlanExpiry { get; set; }
    public DateTime? ApprovedAt { get; set; }
}

public class PaymentRequest
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public string PlanName { get; set; } = "";
    public int Amount { get; set; }
    public string ScreenshotPath { get; set; } = "";
    public string TransactionId { get; set; } = "";
    public string Status { get; set; } = "pending"; // pending | approved | rejected
    public string? RejectionReason { get; set; }
    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReviewedAt { get; set; }
}
