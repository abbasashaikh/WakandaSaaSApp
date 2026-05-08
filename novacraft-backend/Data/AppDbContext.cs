using Microsoft.EntityFrameworkCore;
using NovaCraft.Models;

namespace NovaCraft.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<PaymentRequest> PaymentRequests => Set<PaymentRequest>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>()
            .HasOne(u => u.Subscription)
            .WithOne(s => s.User)
            .HasForeignKey<Subscription>(s => s.UserId);

        modelBuilder.Entity<User>()
            .HasMany(u => u.PaymentRequests)
            .WithOne(p => p.User)
            .HasForeignKey(p => p.UserId);

        modelBuilder.Entity<User>()
            .HasIndex(u => u.Email)
            .IsUnique();
    }
}
