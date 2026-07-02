# Yousuf Consultancy — Backend

Express + MongoDB backend for Yousuf Consultancy.

## Quick start (local dev)

```bash
npm install
cp .env.example .env
# Edit .env: set MONGODB_URI, JWT_SECRET, etc.
npm run dev
```

Server runs on `http://localhost:5000`. Health check: `GET /api/health`

On first start, a default super-admin is created with the email/password from `.env`.

## Deploy options

The backend is a standard Express app — works on any Node hosting platform. Pick one:

### Option A: Render (recommended, free tier)

1. Push this folder to its own GitHub repo
2. Go to <https://dashboard.render.com/new/web>
3. Connect the repo
4. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Plan: Free
5. Add environment variables (Settings → Environment):
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `CORS_ORIGIN` = your frontend URL (e.g. `https://yousuf-frontend.vercel.app`)
   - `CLOUDINARY_URL` = required for image uploads
6. Click Create — Render builds + deploys
7. Copy the URL (e.g. `https://yousuf-backend.onrender.com`)
8. Use that URL as `VITE_BACKEND_URL` in your frontend

> Render free tier sleeps after 15 min of inactivity → first request after sleep takes ~30s to wake up.

### Option B: Railway ($5/month minimum)

1. Push to GitHub
2. Go to <https://railway.app/new> → Deploy from GitHub
3. Select the repo
4. Railway auto-detects Node.js
5. Add env variables (Variables tab)
6. Generate a public domain → copy URL

### Option C: Vercel (serverless)

Vercel is best for the frontend, but it CAN host this backend as a serverless function. Requires minor adapter:

1. Create a folder `api/` and inside it create `index.js`:
   ```js
   import { createApp } from '../app.js';
   export default createApp();
   ```
2. Create `vercel.json`:
   ```json
   {
     "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index" }]
   }
   ```
3. Push to GitHub, import on Vercel
4. Add env vars in Project Settings

> Vercel filesystem is ephemeral — Cloudinary is mandatory.

### Option D: Fly.io (free tier)

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. `fly launch` in the project folder
3. Set secrets: `fly secrets set MONGODB_URI=... JWT_SECRET=...`
4. `fly deploy`

## MongoDB Atlas setup

1. Create cluster at <https://cloud.mongodb.com>
2. Network Access → Add IP → **0.0.0.0/0** (allow all)
   - Cloud platforms have dynamic IPs; this is the standard approach
3. Database Access → Add user with password
4. Connect → Drivers → copy connection string into `MONGODB_URI`

## Cloudinary setup (for image uploads)

Render/Vercel/Fly filesystems are ephemeral. Without Cloudinary, uploaded images disappear on every deploy.

1. Sign up at <https://cloudinary.com> (free)
2. Dashboard → Account Details → copy "API Environment variable"
3. Format: `cloudinary://API_KEY:API_SECRET@CLOUD_NAME`
4. Set as `CLOUDINARY_URL` env var

Without Cloudinary, the backend falls back to base64 storage in MongoDB documents (works but inefficient — fine for testing).

## API reference

All endpoints under `/api`:

```
POST   /auth/login                        email + password → JWT
GET    /auth/me                           current user (requires token)

PUT    /admin/profile                     update name/email/phone
POST   /admin/avatar                      multipart avatar upload
POST   /admin/change-password

GET    /admins                            super-admin only
POST   /admins                            create sub-admin
PUT    /admins/:id                        update permissions
DELETE /admins/:id                        delete sub-admin

GET    /team                              public
POST   /team       (perm: team)           multipart
PUT    /team/:id   (perm: team)           multipart
DELETE /team/:id   (perm: team)

# Same CRUD pattern for: /umrah, /blog, /services, /gallery
# GET public; mutations require matching permission

POST   /applications                      public (contact form)
GET    /applications  (perm: applications)
PUT    /applications/:id/status
DELETE /applications/:id

GET    /dashboard/stats                   any authenticated admin
GET    /analytics      (perm: analytics)
GET    /health                            no auth
```

## Permissions

```
team, services, blog, umrah, gallery, applications, analytics, website
```

Super-admin (`role: "admin"`) has all permissions automatically.
Sub-admins (`role: "sub_admin"`) only see what they're granted.

## Structure

```
.
├── server.js           # entry — calls app.listen()
├── app.js              # Express app, all routes, models, middleware
├── package.json
├── .env                # local dev config (gitignored)
├── .env.example
├── uploads/            # local dev image storage (gitignored)
└── README.md
```

## Troubleshooting

**"Cannot connect to MongoDB" on hosted backend**
→ MongoDB Atlas → Network Access → allow `0.0.0.0/0`

**Images uploaded but URLs return 404**
→ `CLOUDINARY_URL` not set, so backend stored as base64. Either set Cloudinary OR re-upload after setting it.

**CORS error from frontend**
→ Add frontend URL to `CORS_ORIGIN` env var. Multiple URLs comma-separated.

**Login returns 401 even with correct password**
→ Default admin is created on first start using `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars. If you changed them, the old admin still has the old password. Either use old credentials or delete the user from DB and restart.
