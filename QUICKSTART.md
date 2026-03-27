# MaintenanceGuard - Quick Start Cheat Sheet

## 🚀 5-Minute Setup

```bash
# 1. Clone & navigate
git clone https://github.com/YOUR-USERNAME/maintenanceguard-mvp.git
cd maintenanceguard-mvp

# 2. Configure
cp .env.example .env
nano .env  # Add your ANTHROPIC_API_KEY

# 3. Start everything
docker-compose up -d

# 4. Initialize database
docker-compose exec backend python -m app.utils.init_db

# 5. Open browser
# http://localhost:5173
```

## 📦 What You Get

- ✅ Full-stack app running in Docker
- ✅ Backend API at http://localhost:8000
- ✅ Frontend at http://localhost:5173
- ✅ PostgreSQL database with sample OEM data
- ✅ AI-powered invoice parsing
- ✅ Maintenance recommendations engine

## 🔑 Essential Commands

| Task | Command |
|------|---------|
| Start all services | `docker-compose up -d` |
| View logs | `docker-compose logs -f` |
| Stop everything | `docker-compose down` |
| Reset database | `docker-compose down -v && docker-compose up -d` |
| Backend shell | `docker-compose exec backend bash` |
| Run tests | `docker-compose exec backend pytest` |
| Check health | `curl http://localhost:8000/health` |

## 🧪 Test the App

### 1. Add a Test Vehicle
- Go to http://localhost:5173
- Click "Add Vehicle"
- Enter: 2020, Toyota, Camry, 45000 miles

### 2. Create Test Invoice
```bash
cat > ~/test-invoice.txt << 'EOF'
ABC Auto Shop
Date: 2024-02-01
Vehicle Mileage: 45000

Oil Change: $45
Tire Rotation: $25
Transmission Flush: $150
TOTAL: $220
EOF
```

### 3. Upload & Process
- Click "Upload Invoice"
- Select test-invoice.txt (rename to .pdf)
- Wait 15-30 seconds for AI processing
- Review & confirm extracted data

### 4. Get Recommendations
- Click "Recommendations"
- See AI-detected upsell (Transmission Flush too early!)

## 🎯 Supported Vehicles (MVP)

Sample OEM data included for:
- 2020 Toyota Camry
- 2020 Honda Accord  
- 2020 Ford F-150

To add more: edit `backend/app/utils/init_db.py`

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| Port already in use | Change ports in `docker-compose.yml` |
| "Connection refused" | Wait 15 seconds for DB to start |
| Blank frontend | `docker-compose restart frontend` |
| OCR not working | `docker-compose build backend --no-cache` |
| API key error | Check `.env` has `ANTHROPIC_API_KEY=sk-ant-...` |

## 📊 Project Structure

```
maintenanceguard-mvp/
├── backend/          # Python FastAPI
│   ├── app/
│   │   ├── api/      # API routes
│   │   ├── models/   # DB models
│   │   ├── services/ # Business logic
│   │   └── utils/    # Utilities
│   └── Dockerfile
├── frontend/         # React + Tailwind
│   ├── src/
│   │   ├── pages/    # Page components
│   │   └── services/ # API client
│   └── Dockerfile
└── docker-compose.yml
```

## 🌐 URLs

- **Frontend:** http://localhost:5173
- **API Docs:** http://localhost:8000/docs
- **API Health:** http://localhost:8000/health
- **Database:** localhost:5432

## 💰 Cost Estimate

**Development (per month):**
- Anthropic API: ~$2-5 (depends on usage)
- Local Docker: Free

**Production (per month):**
- Backend: $5-10 (Railway/DigitalOcean)
- Database: $7-15 (managed PostgreSQL)
- Anthropic API: $10-30 (100-500 requests/day)
- **Total: ~$22-55/month**

## 🎓 Next Steps

1. ✅ Get the app running (5 minutes)
2. 📚 Read `GETTING_STARTED.md` for details
3. 🎨 Customize the UI
4. 📊 Add more OEM vehicle data
5. 🚀 Deploy to production

## 🆘 Need Help?

1. Check logs: `docker-compose logs -f`
2. Read `GETTING_STARTED.md`
3. Create GitHub issue
4. Email: support@maintenanceguard.com (example)

---

**Built with:** Python • React • PostgreSQL • Claude AI • Docker

**License:** MIT

**Last Updated:** 2024-02-12
