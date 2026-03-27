# 🚗 MaintenanceGuard MVP

An AI-powered vehicle maintenance tracker that helps you build a confirmed service history, get evidence-based maintenance recommendations, and detect unnecessary upsells from service providers.

## ✨ Features

- **Vehicle Management** — Add and manage multiple vehicles by Year/Make/Model
- **Invoice Upload & OCR** — Upload service invoices (PDF/JPG/PNG) and auto-extract data using AI
- **Maintenance Timeline** — Visual history of all services performed
- **AI Recommendations** — Evidence-based recommendations grounded in OEM schedules:
  - ✅ Recommended Now
  - ⏰ Due Soon
  - 💡 Optional Enhancement
  - ⚠️ Not Typically Required (potential upsell)
- **Add to Service History** — Select completed services from recommendations and save them
- **Upsell Detection** — Flags services recommended earlier than OEM guidelines suggest

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Tailwind CSS, Vite |
| Backend | Python 3.11, FastAPI |
| Database | PostgreSQL 15 with pgvector |
| AI / LLM | Anthropic Claude API |
| OCR | Tesseract OCR |
| Infrastructure | Docker & Docker Compose |

---

## 🚀 Quick Start (For Developers)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop) installed and running
- [Git](https://git-scm.com/downloads) installed
- An Anthropic API key → get one at [console.anthropic.com](https://console.anthropic.com/)

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/maintenanceguard-mvp.git
cd maintenanceguard-mvp
```

### 2. Create your environment file
```bash
cp .env.example .env
```
Open `.env` and replace `your_anthropic_api_key_here` with your actual API key:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
```

### 3. Start the application
```bash
docker compose up --build -d
```
First build takes 3–5 minutes. After that:

| Service | URL |
|---------|-----|
| App (Frontend) | http://localhost:5173 or 3000 |
| API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |

### 4. Load OEM schedule data (first time only)
```bash
docker exec -i maintenanceguard-db psql -U postgres -d maintenanceguard < toyota_oem_data.sql
```

### 5. Stop the application
```bash
docker compose down
```

---

## 📁 Project Structure

```
maintenanceguard-mvp/
├── backend/
│   ├── app/
│   │   ├── api/          # Route handlers
│   │   ├── models/       # Database models & schemas
│   │   ├── services/     # LLM & OCR services
│   │   └── utils/        # Database utilities
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/        # React pages
│   │   └── services/     # API client
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── .env.example          # Copy to .env and add your API key
├── toyota_oem_data.sql   # OEM schedule seed data
└── README.md
```

---

## 🔑 Key API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/vehicles` | Create a vehicle |
| GET | `/api/vehicles` | List all vehicles |
| POST | `/api/invoices/upload` | Upload & parse an invoice |
| POST | `/api/invoices/{id}/confirm` | Confirm invoice data |
| POST | `/api/recommendations` | Generate AI recommendations |
| POST | `/api/recommendations/add-to-history` | Save selected recommendations |
| GET | `/api/timeline/{vehicle_id}` | Get maintenance timeline |

Full interactive docs at **http://localhost:8000/docs**

---

## 🔧 Useful Commands

```bash
# View live logs
docker compose logs -f backend
docker compose logs -f frontend

# Restart a service after code change
docker compose restart backend

# Full rebuild (after requirements.txt or Dockerfile changes)
docker compose up --build -d

# Access the database
docker exec -it maintenanceguard-db psql -U postgres -d maintenanceguard

# Reset everything (WARNING: deletes all data)
docker compose down -v
docker compose up --build -d
```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| Site not loading at localhost:3000 | Run `docker compose ps` — check all 3 containers are "Up" |
| "ANTHROPIC_API_KEY not set" | Make sure `.env` exists with your key, then `docker compose restart backend` |
| Vehicles not showing | Open http://localhost:8000/api/vehicles to test backend directly |
| Port already in use | Windows: `netstat -ano \| findstr :3000` to find PID, then `taskkill /PID <PID> /F` |
| Database errors | Run `docker compose down -v` then `docker compose up --build -d` |

---

## 📋 For Non-Technical Users

See **[SETUP_GUIDE.md](SETUP_GUIDE.md)** for a plain-English step-by-step setup guide.

---

## 🗺 Roadmap

- [ ] User authentication & login
- [ ] More OEM vehicle coverage
- [ ] Email/SMS maintenance reminders
- [ ] VIN decoder integration
- [ ] Cost estimation per service
- [ ] Mobile invoice camera capture

---

## 📄 License

MIT License
