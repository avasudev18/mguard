# MaintenanceGuard MVP - Getting Started Guide

This guide will walk you through setting up and running the MaintenanceGuard application from scratch.

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

1. **Docker Desktop**
   - Download from: https://www.docker.com/products/docker-desktop
   - Install and start Docker Desktop
   - Verify: `docker --version` and `docker-compose --version`

2. **Git**
   - Download from: https://git-scm.com/downloads
   - Verify: `git --version`

3. **Anthropic API Key**
   - Sign up at: https://console.anthropic.com/
   - Create an API key (you'll need this later)
   - Free tier includes $5 credit

## 🚀 Step-by-Step Setup

### Step 1: Get the Code

First, you'll need to push this code to GitHub and clone it:

```bash
# If you haven't initialized git yet:
cd maintenanceguard-mvp
git init
git add .
git commit -m "Initial commit"

# Create a GitHub repository and push:
git remote add origin https://github.com/YOUR-USERNAME/maintenanceguard-mvp.git
git branch -M main
git push -u origin main

# Now clone it somewhere fresh:
cd ~
git clone https://github.com/YOUR-USERNAME/maintenanceguard-mvp.git
cd maintenanceguard-mvp
```

### Step 2: Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file with your favorite editor
nano .env
# or
code .env
```

**Update the following in `.env`:**

```bash
# Replace this with your actual Anthropic API key
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx

# Leave these as-is for local development
DATABASE_URL=postgresql://postgres:postgres@db:5432/maintenanceguard
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=maintenanceguard
ENVIRONMENT=development
DEBUG=true
VITE_API_URL=http://localhost:8000
```

⚠️ **Important:** Never commit the `.env` file to Git! It's already in `.gitignore`.

### Step 3: Start the Application

```bash
# Build and start all services (first time)
docker-compose up --build

# This will:
# - Download Docker images
# - Build the backend (Python + FastAPI)
# - Build the frontend (React + Vite)
# - Start PostgreSQL database
# - Take 3-5 minutes on first run
```

**You should see logs like:**
```
maintenanceguard-db      | database system is ready to accept connections
maintenanceguard-backend | INFO: Uvicorn running on http://0.0.0.0:8000
maintenanceguard-frontend| VITE v5.0.11 ready in 423 ms
```

### Step 4: Initialize the Database

**Open a NEW terminal window** (keep the first one running) and run:

```bash
# Initialize database with sample OEM schedules
docker-compose exec backend python -m app.utils.init_db
```

**Expected output:**
```
Initializing database...
✓ Tables created
Loading sample OEM schedules...
✓ Loaded 13 OEM schedule entries

✓ Database initialization complete!
  - Vehicles supported: Toyota Camry, Honda Accord, Ford F-150 (2020)
  - OEM schedule entries: 13
```

### Step 5: Access the Application

Open your web browser and navigate to:

- **Frontend:** http://localhost:5173
- **Backend API Docs:** http://localhost:8000/docs

You should see the MaintenanceGuard dashboard!

## 🎯 First Steps - Testing the Application

### 1. Add a Vehicle

1. Click "Add Vehicle" button
2. Fill in the form:
   - **Year:** 2020
   - **Make:** Toyota
   - **Model:** Camry
   - **Current Mileage:** 45000
3. Click "Add Vehicle"

### 2. Upload a Test Invoice

For testing, you can create a simple test invoice:

```bash
# Create a test invoice text file
cat > test-invoice.txt << 'EOF'
Joe's Auto Shop
123 Main Street, Denver CO 80202
(555) 123-4567

Date: 2024-02-01
Vehicle: 2020 Toyota Camry
Mileage: 45,000

SERVICES:
Oil Change - $45.00
Tire Rotation - $25.00
Air Filter Replacement - $35.00
Transmission Flush - $150.00

TOTAL: $255.00
EOF

# Convert to PDF (if you have a PDF tool)
# Or just upload the text file renamed as .pdf
```

1. Click "Upload Invoice" on your vehicle card
2. Select the test invoice file
3. Wait for OCR + AI processing (15-30 seconds)
4. Review extracted data
5. Click "Confirm"

### 3. Get Recommendations

1. Click "Recommendations" on your vehicle card
2. View AI-generated maintenance recommendations
3. Look for:
   - ✅ **Recommended Now** (due services)
   - ⏰ **Due Soon** (upcoming)
   - ⚠️ **Not Typically Required** (potential upsells)

## 🔧 Common Commands

### Starting and Stopping

```bash
# Start in background (detached mode)
docker-compose up -d

# Stop all services
docker-compose down

# Stop and remove all data (fresh start)
docker-compose down -v

# Restart specific service
docker-compose restart backend
docker-compose restart frontend
```

### Viewing Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f db

# Last 50 lines
docker-compose logs --tail=50 backend
```

### Accessing Containers

```bash
# Backend shell
docker-compose exec backend bash

# Frontend shell
docker-compose exec frontend sh

# Database CLI
docker-compose exec db psql -U postgres -d maintenanceguard
```

### Database Operations

```bash
# Reset database
docker-compose down -v
docker-compose up -d db
# Wait 10 seconds
docker-compose up -d
docker-compose exec backend python -m app.utils.init_db

# Run SQL query
docker-compose exec db psql -U postgres -d maintenanceguard -c "SELECT * FROM vehicles;"

# Backup database
docker-compose exec db pg_dump -U postgres maintenanceguard > backup.sql

# Restore database
docker-compose exec -T db psql -U postgres maintenanceguard < backup.sql
```

## 🐛 Troubleshooting

### Problem: "Port already in use"

**Error:** `Bind for 0.0.0.0:5173 failed: port is already allocated`

**Solution:**
```bash
# Check what's using the port
lsof -i :5173
# or on Windows
netstat -ano | findstr :5173

# Either kill that process or change the port in docker-compose.yml
```

### Problem: "Connection refused" to database

**Solution:**
```bash
# Wait 10-15 seconds after starting for DB to initialize
# Check if DB is ready
docker-compose exec db pg_isready -U postgres

# If still failing, restart everything
docker-compose down -v
docker-compose up -d
```

### Problem: OCR not working

**Solution:**
```bash
# Rebuild backend with Tesseract
docker-compose build backend --no-cache
docker-compose up -d backend
```

### Problem: "ANTHROPIC_API_KEY not set"

**Solution:**
```bash
# Make sure .env file exists and has your API key
cat .env | grep ANTHROPIC_API_KEY

# If missing, add it:
echo "ANTHROPIC_API_KEY=sk-ant-api03-xxxxx" >> .env

# Restart backend
docker-compose restart backend
```

### Problem: Frontend shows blank page

**Solution:**
```bash
# Check frontend logs
docker-compose logs -f frontend

# Rebuild frontend
docker-compose build frontend --no-cache
docker-compose up -d frontend
```

### Problem: API calls failing with CORS errors

**Solution:**
Check that `VITE_API_URL` in `.env` matches your backend URL:
```bash
VITE_API_URL=http://localhost:8000
```

Then rebuild frontend:
```bash
docker-compose down
docker-compose up --build
```

## 📊 Checking if Everything Works

Run these health checks:

```bash
# 1. Check all services are running
docker-compose ps
# All should show "Up"

# 2. Check backend health
curl http://localhost:8000/health
# Should return: {"status":"healthy"}

# 3. Check database connection
docker-compose exec backend python -c "from app.utils.database import engine; engine.connect(); print('DB connected!')"

# 4. Check API docs
# Open: http://localhost:8000/docs
# You should see interactive API documentation

# 5. Check frontend
# Open: http://localhost:5173
# You should see the MaintenanceGuard dashboard
```

## 🔐 Using Claude Code

If you want to use Claude Code (Anthropic's AI coding assistant) with this project:

### Option 1: Via NPM (Recommended)

```bash
# Install Claude Code globally
npm install -g @anthropic-ai/claude-code

# Navigate to project
cd maintenanceguard-mvp

# Start Claude Code
claude-code

# Example commands:
> "Add a feature to export maintenance history as PDF"
> "Create a unit test for the invoice parser"
> "Fix any ESLint warnings in the frontend"
```

### Option 2: Via Docker

```bash
# Run Claude Code in a container
docker run -it --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  anthropic/claude-code
```

## 🎓 Next Steps

Now that you have the MVP running:

1. **Explore the Code**
   - Backend: `backend/app/`
   - Frontend: `frontend/src/`
   - API routes: `backend/app/api/`

2. **Add More OEM Data**
   - Edit: `backend/app/utils/init_db.py`
   - Add schedules for your specific vehicles

3. **Customize the UI**
   - Edit: `frontend/src/pages/Dashboard.jsx`
   - Tailwind CSS documentation: https://tailwindcss.com/docs

4. **Add Features**
   - Email notifications
   - Service cost estimation
   - Multi-user support
   - VIN decoder integration

5. **Deploy to Production**
   - See: `docs/DEPLOYMENT.md` (coming soon)
   - Options: Railway, DigitalOcean, AWS

## 💡 Pro Tips

1. **Use Docker logs to debug:** `docker-compose logs -f` is your friend
2. **Database changes:** After modifying models, recreate DB: `docker-compose down -v && docker-compose up`
3. **Frontend hot reload:** Changes to React files auto-reload in browser
4. **Backend hot reload:** Changes to Python files auto-reload (via `--reload` flag)
5. **Test API endpoints:** Use the interactive docs at `http://localhost:8000/docs`

## 📚 Additional Resources

- **FastAPI Tutorial:** https://fastapi.tiangolo.com/tutorial/
- **React Docs:** https://react.dev/
- **Tailwind CSS:** https://tailwindcss.com/
- **Anthropic API:** https://docs.anthropic.com/
- **Docker Compose:** https://docs.docker.com/compose/

## 🆘 Getting Help

If you encounter issues:

1. Check the logs: `docker-compose logs -f`
2. Review this troubleshooting guide
3. Check the GitHub Issues
4. Create a new issue with:
   - Error message
   - Steps to reproduce
   - Output of `docker-compose ps`
   - Output of relevant logs

---

**Happy Building! 🚗💨**
