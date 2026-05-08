using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NovaCraft.Data;
using NovaCraft.Services;
using System.Security.Claims;

namespace NovaCraft.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize]
public class AdminController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly EmailService _email;

    private static readonly Dictionary<string, int> PlanCredits = new()
    {
        ["Starter Ember"] = 30000,
        ["Pro Inferno"]   = 60000,
    };

    public AdminController(AppDbContext db, EmailService email)
    {
        _db = db; _email = email;
    }

    private bool IsAdmin() => User.FindFirst("isAdmin")?.Value == "True";

    // ── Pending requests ────────────────────────────────────────────────────
    [HttpGet("pending")]
    public async Task<IActionResult> Pending()
    {
        if (!IsAdmin()) return Forbid();
        var requests = await _db.PaymentRequests
            .Include(p => p.User)
            .Where(p => p.Status == "pending")
            .OrderByDescending(p => p.SubmittedAt)
            .Select(p => new {
                p.Id, p.PlanName, p.Amount, p.TransactionId,
                p.Status, p.ScreenshotPath, p.SubmittedAt,
                user = new { p.User!.Name, p.User.Email }
            })
            .ToListAsync();
        return Ok(requests);
    }

    // ── All users ───────────────────────────────────────────────────────────
    [HttpGet("users")]
    public async Task<IActionResult> Users()
    {
        if (!IsAdmin()) return Forbid();
        var users = await _db.Users
            .Include(u => u.Subscription)
            .OrderByDescending(u => u.CreatedAt)
            .Select(u => new {
                u.Id, u.Name, u.Email, u.CreatedAt,
                subscription = u.Subscription == null ? null : new {
                    u.Subscription.HasAccess,
                    u.Subscription.PlanName,
                    u.Subscription.CreditsRemaining,
                    u.Subscription.PlanExpiry,
                }
            })
            .ToListAsync();
        return Ok(users);
    }

    // ── Approve request ─────────────────────────────────────────────────────
    [HttpPost("approve/{requestId}")]
    public async Task<IActionResult> Approve(int requestId)
    {
        if (!IsAdmin()) return Forbid();
        var request = await _db.PaymentRequests
            .Include(p => p.User)
            .FirstOrDefaultAsync(p => p.Id == requestId);
        if (request == null) return NotFound();

        request.Status     = "approved";
        request.ReviewedAt = DateTime.UtcNow;

        var sub = await _db.Subscriptions.FirstOrDefaultAsync(s => s.UserId == request.UserId);
        if (sub == null) { sub = new() { UserId = request.UserId }; _db.Subscriptions.Add(sub); }

        sub.HasAccess        = true;
        sub.PlanName         = request.PlanName;
        sub.CreditsRemaining = PlanCredits.GetValueOrDefault(request.PlanName, 30000);
        sub.PlanExpiry       = DateTime.UtcNow.AddDays(30);
        sub.ApprovedAt       = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        await _email.SendApprovalAsync(request.User!.Email, request.User.Name, request.PlanName, sub.PlanExpiry.Value);

        return Ok(new { message = "Approved successfully." });
    }

    // ── Reject request ──────────────────────────────────────────────────────
    [HttpPost("reject/{requestId}")]
    public async Task<IActionResult> Reject(int requestId, [FromBody] RejectDto dto)
    {
        if (!IsAdmin()) return Forbid();
        var request = await _db.PaymentRequests
            .Include(p => p.User)
            .FirstOrDefaultAsync(p => p.Id == requestId);
        if (request == null) return NotFound();

        request.Status          = "rejected";
        request.RejectionReason = dto.Reason;
        request.ReviewedAt      = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await _email.SendRejectionAsync(request.User!.Email, request.User.Name, dto.Reason);

        return Ok(new { message = "Rejected." });
    }

    // ── Adjust credits ──────────────────────────────────────────────────────
    [HttpPost("credits/{userId}")]
    public async Task<IActionResult> AdjustCredits(int userId, [FromBody] CreditsDto dto)
    {
        if (!IsAdmin()) return Forbid();
        var sub = await _db.Subscriptions.FirstOrDefaultAsync(s => s.UserId == userId);
        if (sub == null) return NotFound();
        sub.CreditsRemaining = Math.Max(0, sub.CreditsRemaining + dto.Delta);
        await _db.SaveChangesAsync();
        return Ok(new { creditsRemaining = sub.CreditsRemaining });
    }

    // ── Revoke access ───────────────────────────────────────────────────────
    [HttpPost("revoke/{userId}")]
    public async Task<IActionResult> Revoke(int userId)
    {
        if (!IsAdmin()) return Forbid();
        var sub = await _db.Subscriptions.FirstOrDefaultAsync(s => s.UserId == userId);
        if (sub == null) return NotFound();
        sub.HasAccess = false;
        await _db.SaveChangesAsync();
        return Ok(new { message = "Access revoked." });
    }
}

public record RejectDto(string Reason);
public record CreditsDto(int Delta);
