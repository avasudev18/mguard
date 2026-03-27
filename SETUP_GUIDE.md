# 📖 MaintenanceGuard — Setup Guide for Non-Technical Users

Welcome! This guide will walk you through running MaintenanceGuard on your computer step by step. No technical experience needed — just follow each step in order.

**Total setup time: about 15–20 minutes (most of it is waiting for downloads)**

---

## 📋 What You'll Need

Before you start, make sure you have:

1. A computer running **Windows 10/11** or **Mac**
2. A stable internet connection
3. An **Anthropic API Key** (instructions below on how to get one)

---

## STEP 1 — Get Your Anthropic API Key

This app uses AI (Claude) to read your invoices and give recommendations. You need a key to use it.

1. Go to **https://console.anthropic.com/**
2. Click **Sign Up** and create a free account
3. Once logged in, click **API Keys** in the left menu
4. Click **Create Key**, give it a name like "MaintenanceGuard"
5. **Copy the key** — it looks like `sk-ant-api03-xxxxxxxx...`
6. Save it somewhere safe (like Notepad) — you'll need it in Step 4

> ⚠️ **Important:** Keep this key private. Don't share it with anyone or post it online.

---

## STEP 2 — Install Docker Desktop

Docker is a free program that runs the app on your computer without needing to install lots of separate software.

### On Windows:
1. Go to **https://www.docker.com/products/docker-desktop/**
2. Click **Download for Windows**
3. Open the downloaded file and follow the installer
4. When it asks about WSL 2, click **OK** and let it install
5. Restart your computer when prompted
6. After restart, open **Docker Desktop** from your Start menu
7. Wait until you see a green **"Engine running"** status at the bottom left

### On Mac:
1. Go to **https://www.docker.com/products/docker-desktop/**
2. Click **Download for Mac** (choose Apple Chip if you have an M1/M2/M3 Mac, otherwise Intel)
3. Open the downloaded `.dmg` file and drag Docker to Applications
4. Open Docker from your Applications folder
5. Wait until you see a green **"Engine running"** status

> ✅ You'll know Docker is ready when you see a small whale icon in your taskbar/menu bar

---

## STEP 3 — Install Git

Git lets you download the app code from GitHub.

### On Windows:
1. Go to **https://git-scm.com/download/win**
2. The download starts automatically — open and run the installer
3. Click **Next** through all the options (defaults are fine)
4. Click **Install**, then **Finish**

### On Mac:
1. Open **Terminal** (search for it in Spotlight with Cmd+Space)
2. Type `git --version` and press Enter
3. If not installed, a popup will appear — click **Install** and follow the steps

---

## STEP 4 — Download the App

Now you'll download the MaintenanceGuard code to your computer.

### On Windows:
1. Click the **Start menu** and search for **"Command Prompt"** — open it
2. Type these commands one at a time, pressing **Enter** after each:

```
cd Desktop
git clone https://github.com/YOUR_USERNAME/maintenanceguard-mvp.git
cd maintenanceguard-mvp
```

> 📝 Replace `YOUR_USERNAME` with the actual GitHub username shared with you

### On Mac:
1. Open **Terminal** (Cmd+Space, type "Terminal")
2. Type these commands one at a time, pressing **Enter** after each:

```
cd Desktop
git clone https://github.com/YOUR_USERNAME/maintenanceguard-mvp.git
cd maintenanceguard-mvp
```

---

## STEP 5 — Add Your API Key

1. In the same Command Prompt / Terminal window, type:

**On Windows:**
```
copy .env.example .env
notepad .env
```

**On Mac:**
```
cp .env.example .env
open -e .env
```

2. A text file will open. Find this line:
```
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

3. Replace `your_anthropic_api_key_here` with the key you copied in Step 1. It should look like:
```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxx
```

4. **Save the file** (Ctrl+S on Windows, Cmd+S on Mac) and close it

---

## STEP 6 — Start the App

Make sure **Docker Desktop is running** (you should see the whale icon), then in your Command Prompt / Terminal type:

```
docker compose up --build -d
```

Press Enter and wait. You'll see lots of text scrolling — this is normal! It's downloading and setting everything up.

**The first time this takes about 5–10 minutes.** After that it starts in under 30 seconds.

When you see the cursor return and no more text is scrolling, it's ready.

---

## STEP 7 — Load Vehicle Data

This loads the Toyota maintenance schedule data into the app. Type this command:

**On Windows:**
```
docker exec -i maintenanceguard-db psql -U postgres -d maintenanceguard < toyota_oem_data.sql
```

**On Mac:**
```
docker exec -i maintenanceguard-db psql -U postgres -d maintenanceguard < toyota_oem_data.sql
```

Press Enter. It should complete quickly with no errors.

---

## STEP 8 — Open the App 🎉

Open your web browser (Chrome, Edge, Firefox) and go to:

## 👉 http://localhost:3000

You should see the MaintenanceGuard dashboard!

---

## 🖥 How to Use the App

### Add Your Vehicle
1. Click **"+ Add Vehicle"**
2. Enter your car's Year, Make, Model (e.g., 2020, Toyota, Camry)
3. Add a nickname if you want (e.g., "My Car")
4. Enter current mileage
5. Click **"Add Vehicle"**

### Get Recommendations
1. Click **"Recommendations"** on your vehicle card
2. Enter your current mileage
3. Click **"Get Recommendations"**
4. Wait about 10–15 seconds for AI to analyze
5. Review the categorized recommendations:
   - ✅ **Recommended Now** — Do these soon
   - ⏰ **Due Soon** — Coming up in the next 1,000 miles
   - 💡 **Optional** — Not required but could help
   - ⚠️ **Not Typically Required** — Question these if a shop recommends them

### Mark Services as Done
1. Click the checkbox next to any service you've completed
2. Click **"Add to Service History"**
3. Confirm the date and shop name
4. Click **"Confirm & Save"**
5. Recommendations will automatically refresh!

### Upload an Invoice
1. Click **"Upload Invoice"** on your vehicle card
2. Choose a PDF or photo of your service invoice
3. Wait for the AI to read it (about 10 seconds)
4. Review the extracted information
5. Correct anything that looks wrong
6. Click **"Confirm"** to save it to your history

---

## ⏹ How to Stop the App

When you're done using it, in Command Prompt / Terminal type:
```
docker compose down
```

Your data is saved and will be there next time.

---

## ▶️ How to Start the App Again Next Time

1. Open **Docker Desktop** and wait for it to show "Engine running"
2. Open Command Prompt / Terminal
3. Navigate to the app folder:

**Windows:**
```
cd Desktop\maintenanceguard-mvp
```
**Mac:**
```
cd Desktop/maintenanceguard-mvp
```

4. Start the app:
```
docker compose up -d
```

5. Go to **http://localhost:3000** in your browser

---

## ❓ Common Problems & Solutions

### "Site can't be reached" or blank page
- Make sure Docker Desktop is open and shows "Engine running"
- Try running: `docker compose up -d`
- Wait 30 seconds and refresh the browser

### "This site can't be reached" at localhost:3000
- Check if containers are running: `docker compose ps`
- All three should show "Up" status
- If not, run: `docker compose up -d`

### App loads but shows no vehicles after you added them
- Open http://localhost:8000/api/vehicles in your browser
- If you see your vehicles listed there, try refreshing the main page
- If blank, run: `docker compose restart backend`

### Recommendations show "Failed to generate"
- Your API key might be wrong — double check your `.env` file
- Make sure there are no spaces around the `=` sign in the key

### Port already in use error
**Windows** — Open Command Prompt and run:
```
netstat -ano | findstr :3000
taskkill /PID <the number shown> /F
```
Then try `docker compose up -d` again

### Need to start completely fresh (deletes all your data)
```
docker compose down -v
docker compose up --build -d
```

---

## 📞 Getting Help

If you're stuck, take a screenshot of the error and share it along with:
1. What step you were on
2. What you typed
3. The exact error message shown

---

## ✅ Quick Reference Card

| What you want to do | Command |
|---------------------|---------|
| Start the app | `docker compose up -d` |
| Stop the app | `docker compose down` |
| Restart after a problem | `docker compose restart` |
| See error logs | `docker compose logs -f backend` |
| Rebuild after code update | `docker compose up --build -d` |

**App URL:** http://localhost:3000  
**API Docs:** http://localhost:8000/docs
