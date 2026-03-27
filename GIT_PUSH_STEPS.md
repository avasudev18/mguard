# Pushing MaintenanceGuard to GitHub

## One-Time Setup (First Push)

### Step 1 — Create a GitHub repository
1. Go to https://github.com and log in
2. Click the **+** icon (top right) → **New repository**
3. Name it: `maintenanceguard-mvp`
4. Set to **Public** or **Private** (Private recommended for now)
5. Do NOT tick "Add README" or any other options
6. Click **Create repository**
7. Copy the URL shown — looks like: `https://github.com/rranjidh/maintenanceguard-mvp.git`

### Step 2 — Make sure .env is NOT committed (it has your secret key!)
In your project folder, check that `.gitignore` contains `.env`:
```
type .gitignore | findstr .env
```
You should see `.env` listed. If not, open `.gitignore` and add `.env` on a new line.

### Step 3 — Push your code
Open Command Prompt, navigate to your project folder and run:

```cmd
cd C:\Users\rranjidh\Documents\Renju\00_AKV\maintenanceguard-mvp

git init
git add .
git commit -m "Initial commit - MaintenanceGuard MVP with recommendations feature"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/maintenanceguard-mvp.git
git push -u origin main
```

> Replace `YOUR_USERNAME` with your actual GitHub username

You'll be asked to log in to GitHub — use your username and password (or a Personal Access Token if you have 2FA enabled).

---

## Pushing Updates After That (Every Time You Make Changes)

```cmd
cd C:\Users\rranjidh\Documents\Renju\00_AKV\maintenanceguard-mvp

git add .
git commit -m "Describe what you changed here"
git push
```

That's it — 3 commands every time.

---

## ⚠️ IMPORTANT — Never commit your .env file

Your `.env` file contains your Anthropic API key. The `.gitignore` file prevents it from being uploaded, but always double-check before pushing:

```cmd
git status
```

You should NOT see `.env` in the list. If you do, run:
```cmd
git rm --cached .env
git commit -m "Remove .env from tracking"
```

---

## Sharing with Someone Else

Once pushed, share:
1. The **GitHub repository URL**  
   e.g. `https://github.com/rranjidh/maintenanceguard-mvp`
2. Tell them to follow the **SETUP_GUIDE.md** in the repo
3. Remind them they need their **own Anthropic API key** (free to create)
