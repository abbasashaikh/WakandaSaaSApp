using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NovaCraft.Data;
using NovaCraft.Models;
using NovaCraft.Services;
using System.Security.Claims;

namespace NovaCraft.Controllers;

[ApiController]
[Route("api/payment")]
[Authorize]
public class PaymentController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly EmailService _email;
    private readonly IWebHostEnvironment _env;

    private static readonly Dictionary<string, (int price, int credits)> Plans = new()
    {
        ["Starter Ember"] = (899,  30000),
        ["Pro Inferno"]   = (1299, 60000),
    };

    public PaymentController(AppDbContext db, EmailService email, IWebHostEnvironment env)
    {
        _db = db; _email = email; _env = env;
    }

    // ── Submit payment request ─────────────────────────────────────────────
    [HttpPost("submit")]
    public async Task<IActionResult> Submit([FromForm] PaymentSubmitDto dto)
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var user   = await _db.Users.FindAsync(userId);
        if (user == null) return NotFound();

        if (!Plans.ContainsKey(dto.PlanName))
            return BadRequest(new { message = "Invalid plan." });

        // Rate limit: max 3 pending per user
        var pendingCount = await _db.PaymentRequests
            .CountAsync(p => p.UserId == userId && p.Status == "pending");
        if (pendingCount >= 3)
            return BadRequest(new { message = "You have too many pending requests. Please wait for review." });

        // Save screenshot
        var uploads = Path.Combine(_env.ContentRootPath, "uploads");
        Directory.CreateDirectory(uploads);
        var fileName = $"{userId}_{DateTime.UtcNow.Ticks}{Path.GetExtension(dto.Screenshot.FileName)}";
        var filePath = Path.Combine(uploads, fileName);
        using var stream = System.IO.File.Create(filePath);
        await dto.Screenshot.CopyToAsync(stream);

        var request = new PaymentRequest
        {
            UserId        = userId,
            PlanName      = dto.PlanName,
            Amount        = Plans[dto.PlanName].price,
            ScreenshotPath = fileName,
            TransactionId = dto.TransactionId,
            Status        = "pending",
        };
        _db.PaymentRequests.Add(request);
        await _db.SaveChangesAsync();

        // Emails
        await _email.SendPaymentSubmittedAsync(user.Email, user.Name, dto.PlanName);
        await _email.SendAdminNotificationAsync(user.Name, user.Email, dto.PlanName);

        return Ok(new { message = "Payment request submitted. You'll be notified once approved.", requestId = request.Id });
    }

    // ── Get user's payment history ──────────────────────────────────────────
    [HttpGet("history")]
    public async Task<IActionResult> History()
    {
        var userId = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var requests = await _db.PaymentRequests
            .Where(p => p.UserId == userId)
            .OrderByDescending(p => p.SubmittedAt)
            .Select(p => new {
                p.Id, p.PlanName, p.Amount, p.TransactionId,
                p.Status, p.RejectionReason, p.SubmittedAt, p.ReviewedAt
            })
            .ToListAsync();
        return Ok(requests);
    }

    // ── Serve screenshot (user own or admin) ────────────────────────────────
    [HttpGet("screenshot/{fileName}")]
    public async Task<IActionResult> Screenshot(string fileName)
    {
        var userId  = int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
        var isAdmin = User.FindFirst("isAdmin")?.Value == "True";

        var request = await _db.PaymentRequests
            .FirstOrDefaultAsync(p => p.ScreenshotPath == fileName);

        if (request == null) return NotFound();
        if (!isAdmin && request.UserId != userId) return Forbid();

        var path = Path.Combine(_env.ContentRootPath, "uploads", fileName);
        if (!System.IO.File.Exists(path)) return NotFound();

        var ext = Path.GetExtension(fileName).ToLower();
        var mime = ext == ".png" ? "image/png" : "image/jpeg";
        return PhysicalFile(path, mime);
    }
}

public record PaymentSubmitDto(string PlanName, string TransactionId, IFormFile Screenshot);
