# Shortlist – Mini Applicant Tracking System

Manage candidates through hiring stages (Applied → Screening → Interview → Offer → Hired / Rejected), search and filter them, and see pipeline metrics on a dashboard.

**Stack:** HTML, CSS, vanilla JavaScript · Node.js, Express · MongoDB (Mongoose) · JWT auth (bcrypt-hashed passwords)

## Features
- Register / sign in with JWT (7-day token); every candidate is private to its owner
- Candidate CRUD (name, email, phone, role, skills, experience, notes, stage)
- Change stage inline from the table
- Search by name, email, role or skill; filter by stage; pagination
- Dashboard: total, in progress, added this week, hire rate, busiest roles, per-stage counts (the pipeline cards double as stage filters)

## Run locally
```bash
npm install
cp .env.example .env     # set MONGODB_URI and JWT_SECRET
npm start                # http://localhost:3000
```

## API
| Method | Route | Purpose |
|---|---|---|
| POST | /api/auth/register, /api/auth/login | Get a JWT |
| GET | /api/candidates?search=&stage=&page= | List with search, filter, paging |
| POST | /api/candidates | Create |
| PUT | /api/candidates/:id | Update |
| PATCH | /api/candidates/:id/stage | Move stage |
| DELETE | /api/candidates/:id | Delete |
| GET | /api/dashboard | Metrics |

All `/api/candidates` and `/api/dashboard` routes need `Authorization: Bearer <token>`.

## Deploy (Render + MongoDB Atlas)
1. Create a free cluster on MongoDB Atlas, add a database user, allow network access `0.0.0.0/0`, copy the connection string.
2. Push this repo to GitHub.
3. On Render: New → Web Service → connect the repo. Build command `npm install`, start command `npm start`.
4. Add environment variables `MONGODB_URI` and `JWT_SECRET`. Deploy and open the URL.
