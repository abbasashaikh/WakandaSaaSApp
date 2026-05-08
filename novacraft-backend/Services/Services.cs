using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using Microsoft.IdentityModel.Tokens;
using NovaCraft.Models;

namespace NovaCraft.Services;

// ── JWT Service ───────────────────────────────────────────────────────────────
public class JwtService
{
    private readonly IConfiguration _config;
    public JwtService(IConfiguration config) => _config = config;

    public string GenerateToken(int userId, string email, bool isAdmin = false)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Email, email),
            new Claim("isAdmin", isAdmin.ToString()),
        };
        var token = new JwtSecurityToken(
            issuer:   _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims:   claims,
            expires:  DateTime.UtcNow.AddMinutes(double.Parse(_config["Jwt:ExpiryMinutes"]!)),
            signingCredentials: creds
        );
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

// ── Email Service ─────────────────────────────────────────────────────────────
public class EmailService
{
    private readonly IConfiguration _config;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IConfiguration config, ILogger<EmailService> logger)
    {
        _config = config;
        _logger = logger;
    }

    private async Task SendAsync(string toEmail, string toName, string subject, string htmlBody)
    {
        try
        {
            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(_config["Email:SenderName"], _config["Email:SenderEmail"]));
            message.To.Add(new MailboxAddress(toName, toEmail));
            message.Subject = subject;
            message.Body = new TextPart("html") { Text = htmlBody };

            using var client = new SmtpClient();
            await client.ConnectAsync(_config["Email:SmtpHost"], int.Parse(_config["Email:SmtpPort"]!), SecureSocketOptions.StartTls);
            await client.AuthenticateAsync(_config["Email:SenderEmail"], _config["Email:AppPassword"]);
            await client.SendAsync(message);
            await client.DisconnectAsync(true);
        }
        catch (Exception ex)
        {
            _logger.LogError("Email failed to {Email}: {Error}", toEmail, ex.Message);
        }
    }

    public async Task SendPaymentSubmittedAsync(string userEmail, string userName, string planName)
    {
        var html = $@"
        <div style='font-family:sans-serif;max-width:600px;margin:auto;background:#0A0B1A;color:#fff;padding:40px;border-radius:12px;'>
          <h1 style='color:#FF2A6D;'>NovaCraft</h1>
          <h2>Payment Request Received</h2>
          <p>Hi {userName},</p>
          <p>We received your payment request for <strong style='color:#FF2A6D;'>{planName}</strong>.</p>
          <p>Our team will review your screenshot and approve your access within 24 hours.</p>
          <p style='color:#888;margin-top:32px;'>— NovaCraft Team</p>
        </div>";
        await SendAsync(userEmail, userName, "Payment Request Received – NovaCraft", html);
    }

    public async Task SendApprovalAsync(string userEmail, string userName, string planName, DateTime expiry)
    {
        var html = $@"
        <div style='font-family:sans-serif;max-width:600px;margin:auto;background:#0A0B1A;color:#fff;padding:40px;border-radius:12px;'>
          <h1 style='color:#FF2A6D;'>NovaCraft</h1>
          <h2 style='color:#00ff88;'>✅ Plan Activated!</h2>
          <p>Hi {userName},</p>
          <p>Your <strong style='color:#FF2A6D;'>{planName}</strong> plan is now active!</p>
          <p>Valid until: <strong>{expiry:MMMM dd, yyyy}</strong></p>
          <p>Download the app and log in with your credentials to start creating.</p>
          <p style='color:#888;margin-top:32px;'>— NovaCraft Team</p>
        </div>";
        await SendAsync(userEmail, userName, "🎉 Your NovaCraft Plan is Active!", html);
    }

    public async Task SendRejectionAsync(string userEmail, string userName, string reason)
    {
        var html = $@"
        <div style='font-family:sans-serif;max-width:600px;margin:auto;background:#0A0B1A;color:#fff;padding:40px;border-radius:12px;'>
          <h1 style='color:#FF2A6D;'>NovaCraft</h1>
          <h2 style='color:#ff4444;'>Payment Request Rejected</h2>
          <p>Hi {userName},</p>
          <p>Unfortunately your payment request was rejected.</p>
          <p>Reason: <strong>{reason}</strong></p>
          <p>Please resubmit with a valid payment screenshot.</p>
          <p style='color:#888;margin-top:32px;'>— NovaCraft Team</p>
        </div>";
        await SendAsync(userEmail, userName, "Payment Request Update – NovaCraft", html);
    }

    public async Task SendAdminNotificationAsync(string userName, string userEmail, string planName)
    {
        var adminEmail = "shaikhabbas81@gmail.com";
        var html = $@"
        <div style='font-family:sans-serif;max-width:600px;margin:auto;background:#0A0B1A;color:#fff;padding:40px;border-radius:12px;'>
          <h1 style='color:#FF2A6D;'>NovaCraft Admin</h1>
          <h2>New Payment Request</h2>
          <p><strong>User:</strong> {userName} ({userEmail})</p>
          <p><strong>Plan:</strong> {planName}</p>
          <p>Login to admin panel to review.</p>
        </div>";
        await SendAsync(adminEmail, "Admin", "New Payment Request – NovaCraft", html);
    }
}
