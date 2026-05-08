# NovaCraft Website — Setup Guide

## Stack
- **Frontend:** React + Vite → http://localhost:3151
- **Backend:** .NET Core 8 Web API → http://localhost:5000
- **Database:** SQLite (novacraft.db — auto-created)
- **Email:** Gmail SMTP (add credentials in appsettings.json)

---

## Prerequisites
1. [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
2. [Node.js 18+](https://nodejs.org)
3. Git

---

## Backend Setup (novacraft-backend)

### Step 1 — Install .NET dependencies
```powershell
cd novacraft-backend
dotnet restore
```

### Step 2 — Configure appsettings.json
Open `appsettings.json` and fill in:
```json
{
  "Jwt": {
    "Key": "REPLACE_WITH_32+_RANDOM_CHARS_SECRET_KEY_HERE"
  },
  "Email": {
    "SenderEmail": "your.gmail@gmail.com",
    "AppPassword":  "xxxx xxxx xxxx xxxx"
  },
  "Admin": {
    "Email":    "shaikhabbas81@gmail.com",
    "Password": "Admin@NovaCraft2026"
  }
}
```

**How to get Gmail App Password:**
1. Go to myaccount.google.com → Security
2. Enable 2-Step Verification
3. Search "App passwords" → Create → Copy 16-digit code

### Step 3 — Run backend
```powershell
dotnet run
```
API available at: http://localhost:5000
SQLite DB created automatically as novacraft.db

---

## Frontend Setup (novacraft-frontend)

### Step 1 — Install dependencies
```powershell
cd novacraft-frontend
npm install
```

### Step 2 — Create .env file
```
VITE_API_URL=http://localhost:5000/api
```

### Step 3 — Run frontend
```powershell
npm run dev
```
Website at: http://localhost:3151

---

## Admin Login
- URL: http://localhost:3151/admin
- Email: shaikhabbas81@gmail.com
- Password: Admin@NovaCraft2026 (set in appsettings.json)

---

## How APK/EXE should check access

Add this to your existing app on login:

```javascript
// After login, call:
GET /api/subscription/status
Headers: { Authorization: "Bearer <jwt_token>" }

// Response:
{
  "has_access": true,
  "plan_name": "Starter Ember",
  "credits_remaining": 29500,
  "plan_expiry": "2026-06-04"
}

// If has_access = false → show "Buy a plan at novacraft.azurewebsites.net"
```

---

## Production (Azure)

### Frontend (Netlify/Vercel — free)
```powershell
cd novacraft-frontend
npm run build
# Deploy dist/ folder to Netlify
```

### Backend (Azure App Service)
```powershell
cd novacraft-backend
dotnet publish -c Release
# Deploy to Azure App Service
# Set ASPNETCORE_URLS=http://+:80 in Azure env vars
```

Update `VITE_API_URL=https://novacraft.azurewebsites.net/api` before frontend build.

---

## File Structure
```
novacraft-backend/
  Controllers/   ← Auth, Payment, Admin, Subscription
  Models/        ← User, Subscription, PaymentRequest
  Services/      ← JwtService, EmailService
  Data/          ← AppDbContext (SQLite)
  uploads/       ← Payment screenshots stored here
  novacraft.db   ← Auto-created SQLite database

novacraft-frontend/
  src/pages/
    LandingPage.jsx        ← Public homepage
    LoginPage.jsx          ← User login
    RegisterPage.jsx       ← User registration
    DashboardPage.jsx      ← User dashboard + plan status
    PlansPage.jsx          ← Plan selection
    PaymentUploadPage.jsx  ← Upload payment screenshot
    admin/
      AdminLoginPage.jsx    ← Admin login (/admin)
      AdminDashboardPage.jsx ← Approve/reject payments
```
