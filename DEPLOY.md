# Put the payroll app online (Supabase + Netlify)

Once you're done, the app has its own web address (for example `https://mjg-payroll.netlify.app`) that works on any phone, tablet or computer. Staff can also install it on their home screen like an app.

You need: a computer, an email address, and about 45 minutes. All three services have free plans.

| Service | What it does |
|---|---|
| **Supabase** | Database + logins (where the payroll data lives) |
| **GitHub** | Stores the app's code so Netlify can build it |
| **Netlify** | Runs the app and gives you the web address |

---

## Part 1 — Supabase (database)

1. Go to **supabase.com** → sign up → **New project**.
   - Name: `mjg-payroll`
   - Database password: create a strong one and **save it somewhere safe**
   - Region: **Southeast Asia (Singapore)** — closest to the Philippines
2. Wait about 2 minutes until the project is ready.
3. Left menu → **SQL Editor** → **New query**.
4. On your computer, open `supabase/SETUP_ALL_IN_ONE.sql` with **Notepad** (or VS Code). Select all (Ctrl+A), copy (Ctrl+C).
5. Paste into the Supabase query box. **Line 1 must start with `--`.** Click **Run** → "Success. No rows returned".
6. Check: left menu → **Table Editor** shows `employees`, `payroll_periods`, `statutory_configurations`, …
7. Left menu → **Project Settings** → **API** (or **API Keys**). Copy two values into Notepad:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public** key (newer projects call it **publishable** key)
   - ⚠️ Never copy or share the **service_role** / **secret** key. The app does not need it.

## Part 2 — GitHub (store the code)

1. Sign up at **github.com**.
2. Easiest way to upload: install **GitHub Desktop** (desktop.github.com) → sign in.
3. Unzip `mjg-payroll.zip`. In GitHub Desktop: **File → Add local repository** → choose the `mjg-payroll` folder → if asked, **create a repository** → **Publish repository** → keep **Private** ticked → Publish.
   - The `.gitignore` already excludes `node_modules`, `.next` and `.env.local` (your keys are never uploaded).

## Part 3 — Netlify (put it online)

1. Sign up at **netlify.com** using **"Sign up with GitHub"**.
2. **Add new site → Import an existing project → GitHub** → allow access → choose `mjg-payroll`.
3. Build settings are read automatically from `netlify.toml` (build command `npm run build`, publish `.next`). Don't change them.
4. Before deploying, click **Add environment variables** (or after: **Site configuration → Environment variables**) and add:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Project URL from Part 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon / publishable key from Part 1 |

5. Click **Deploy**. The first build takes 2–4 minutes.
6. **Site configuration → Change site name** → e.g. `mjg-payroll` → your address becomes `https://mjg-payroll.netlify.app`.
   - If you add or change environment variables later: **Deploys → Trigger deploy → Deploy site** (the keys are built into the app).

## Part 4 — Connect logins to your address

Back in Supabase → **Authentication → URL Configuration**:
- **Site URL**: `https://mjg-payroll.netlify.app` (your address)
- **Redirect URLs** → Add: `https://mjg-payroll.netlify.app/**`

This makes the "confirm your email" and "forgot password" links open your app.

Optional, under **Authentication → Providers → Email** (some Supabase versions call it **Sign In / Providers**):
- **Confirm email** ON (recommended) = new users must click the email link before they can sign in.
- Supabase's built-in email sender only sends a few emails per hour. For more than a handful of staff, set up your own SMTP under **Authentication → Emails → SMTP Settings** (e.g. a Gmail/Google Workspace or Brevo account).

## Part 5 — First login and phones

1. Open your Netlify address → **Create an account** → this first account becomes **Super Admin**.
2. **Settings** → fill in company TIN, SSS / PhilHealth / Pag-IBIG employer numbers.
3. Other staff create accounts → you assign roles in **Users & Roles** (Payroll Admin, Approver, Accounting…).
   - To let an employee see only their own payslips: role **Employee**, then link their employee record.
4. **Install on a phone:**
   - **Android (Chrome):** open the address → ⋮ menu → **Install app** / **Add to Home screen**
   - **iPhone (Safari):** open the address → **Share** → **Add to Home Screen**
   - It opens full-screen with the MJG Payroll icon.

Tip: the payroll grid is easiest on a computer or tablet. On a phone, open an employee from the grid to encode their details.

## Updating the app later

Change files → GitHub Desktop → **Commit** → **Push**. Netlify rebuilds automatically in a few minutes. Database changes (new SQL files) are run in the Supabase SQL Editor.

## Backups and things to know

- **Free Supabase projects pause after a period of inactivity** (currently about a week with no activity). The data is kept; open the Supabase dashboard and click **Restore project**. If payroll is only opened twice a month, this may happen. A paid plan avoids pausing and adds automatic daily backups — check Supabase's current pricing.
- Keep your own backup every payroll: **Reports** and **Payroll register → Excel / CSV**, and keep printed or PDF registers.
- Finalized payroll is never deleted. Every change is recorded in **Audit Trail**.

## Troubleshooting

| What you see | Fix |
|---|---|
| Page says "Finish connecting the payroll system" / environment variables not set | Add both variables in Netlify (Part 3, step 4), then **Trigger deploy**. |
| "Connected to Supabase, but the payroll tables are not there yet" | Run `SETUP_ALL_IN_ONE.sql` (Part 1). |
| SQL error `syntax error at or near "{"` | You pasted the wrong file. Open the `.sql` file in Notepad and copy its contents; line 1 starts with `--`. |
| SQL error `type "app_role" already exists` | The setup already ran. Nothing to do — check Table Editor. |
| Confirmation email link opens `localhost` or shows an error | Set Site URL and Redirect URLs (Part 4), then sign up / request the link again. |
| "Email not confirmed" | Click the link in the email, or in Supabase → Authentication → Users → the user → **Confirm**. |
| Signed in but "no active role" | A Super Admin assigns the role in **Users & Roles**. |
| Netlify build failed | Open the deploy log; send the last 30 lines for help. |
