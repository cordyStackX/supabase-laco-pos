# Supabase Postgres migration

This guide switches the Express backend from MySQL to Supabase Postgres and
moves product images and payment receipts from local disk to Supabase Storage.
The frontends, Express routes, staff/customer authentication, and JWT sessions
remain unchanged. Product images use a public bucket; payment receipts remain
private and are only served through the authenticated backend route.

## Prepare the project

1. Create a Supabase project and keep its database connection string private.
   Use the Supabase **Session pooler** connection string if the deployment
   environment cannot make direct IPv6 connections.
2. Stop the backend and any other process that writes to the MySQL database.
   Keep writes paused until the transfer and verification are complete.
3. Back up the MySQL database.
4. In Supabase **Storage**, create two buckets:
   - `product-images` and set it to **Public** (the storefront needs to display
     these images).
   - `payment-receipts` and keep it **Private** (receipt access stays behind
     the backend's staff authorization).
5. In the Supabase dashboard, create and copy a server-side **Secret key**
   (`sb_secret_...`). Do not use the publishable key for backend uploads.
6. Configure the server-side variables in your hosting provider's private
   environment-variable settings. Do not put the service-role key or database
   credentials in either frontend or commit them:

   ```text
   PGHOST=<Supabase database host>
   PGPORT=5432
   PGDATABASE=postgres
   PGUSER=postgres
   PGPASSWORD=<Supabase database password>
   DB_SSL=true
   DB_SSL_CA_CERT=<full PEM certificate, when required by the host>
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET_KEY=your-private-secret-key
   UPLOAD_STORAGE=supabase
   SUPABASE_PRODUCT_BUCKET=product-images
   SUPABASE_RECEIPT_BUCKET=payment-receipts
   ```

   Keep the current `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and
   `DB_PASSWORD` values available as the **MySQL source** until both data
   transfers complete.

   If the deployed backend reports `SELF_SIGNED_CERT_IN_CHAIN`, download the
   project's server root certificate from **Project Settings → Database →
   SSL Configuration** in Supabase. Set the full PEM text as the private
   deployment variable `DB_SSL_CA_CERT`:

   ```text
   DB_SSL_CA_CERT=<full PEM certificate>
   ```

   Keep `DB_SSL=true`; the backend will verify the server certificate against
   this CA. Do not disable certificate verification.

## Deploy the backend on Render

1. Push the backend and `render.yaml` to the GitHub repository connected to
   Render. In Render, choose **New → Blueprint** and select that repository.
2. Render reads `render.yaml` and creates the `pos-bookstore-api` web service.
   Enter the requested private values for `PGHOST`, `PGPORT`, `PGDATABASE`,
   `PGUSER`, `PGPASSWORD`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `JWT_SECRET`,
   `CORS_ORIGINS`, and, if needed, `DB_SSL_CA_CERT`. Set `CORS_ORIGINS` to the
   exact deployed POS and storefront origins, comma-separated, with no trailing
   slash.
3. Keep the MySQL source credentials available only to the one-time transfer
   environment. They are not needed by the deployed Render service.
4. After deployment, open the Render service URL and confirm
   `/api/health` returns a successful response. Do not route users to the new
   backend until database, Storage, frontend CORS, and login checks pass.

Render's free web service can sleep when idle. It does not provide durable local
disk, so the service is configured to use Supabase Storage for uploaded files.

## Deploy the ecommerce storefront to Vercel

The storefront is a separate Vite project in `Ecommerce_Bookstore`; deploy it
as a static Vercel project. Keep the Express API on Render (or another
long-running Node.js host), since this backend uses persistent database
connections and is not configured as a Vercel Function.

1. In Vercel, import the GitHub repository and set **Root Directory** to
   `Ecommerce_Bookstore`.
2. Use the `npm` install command `npm install`, build command `npm run build`,
   and output directory `dist`. Vercel should detect Vite automatically.
   `Ecommerce_Bookstore/vercel.json` sends client-side routes back to the
   storefront entry page.
3. Add these environment variables to the Vercel project:
   - `VITE_API_URL` — the deployed API origin followed by `/api`, for example
     `https://pos-bookstore-api.onrender.com/api`. Do not use the example
     hostname; use the URL assigned to your Render service.
   - `VITE_GCASH_PAYMENT_LINK` — optional, if checkout should show the GCash
     payment link.
4. Deploy the storefront. Add its exact public Vercel origin (scheme and
   hostname, with no trailing slash) to the backend's `CORS_ORIGINS` value on
   Render, alongside any POS origin. Save the variable and redeploy/restart the
   API. If you attach a custom domain later, add that exact origin too.
5. Redeploy the storefront after changing its environment variables. Verify
   the storefront loads, its product and category requests succeed, and
   customer registration/login and checkout reach the deployed API.

Product image URLs must point to the public Supabase `product-images` bucket;
the Vercel static site cannot serve files from the backend's local upload
directory. Payment receipts should continue to be uploaded through the API and
kept in the private `payment-receipts` bucket.

## Create the Supabase schema

In PowerShell, from `backend`:

```powershell
$env:DB_CLIENT = "postgres"
npm run migrate
Remove-Item Env:DB_CLIENT
```

This applies the new schema under `migrations/postgres/` and records it in
`schema_migrations`. It does not run the MySQL-specific migrations. Run the
command in a one-off shell/job in the host or a trusted migration environment
with the target `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and
`DB_CLIENT=postgres` configured.

## Copy current data

Keep both sets of values configured: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
and `DB_PASSWORD` for the MySQL source, and `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER`, `PGPASSWORD`, plus `DB_SSL` for the Supabase destination. Run this in
a trusted one-off environment:

```powershell
$env:DB_CLIENT = "postgres"
npm run migrate:data:postgres -- --confirm-empty-target
```

The transfer refuses to merge into non-empty tables or silently discard source
columns missing from the Postgres schema. It copies recognized application
tables in batches inside a Postgres transaction, preserves explicit IDs and
password hashes, and synchronizes identity sequences and the POS receipt
counter. The `--confirm-empty-target` flag is required; run the schema
migration first. The initialized `pos` receipt-counter row is the only
pre-existing application row allowed in the target.

The transfer is a snapshot, not ongoing replication. Keep MySQL writes stopped
for the whole copy; if it fails, the Postgres transaction is rolled back and
the source database is left untouched. Resolve any reported schema differences
before retrying.

## Transfer existing uploads

The original `backend/uploads` folder is not included in Git, so it must be
available to the one-off transfer process. Run the upload transfer from a
trusted environment that has that folder, the Supabase Storage variables above,
and the `PG*` variables pointing to the already-migrated Postgres database:

```powershell
$env:DB_CLIENT = "postgres"
npm run migrate:uploads:supabase -- --confirm-storage-migration
```

The script uploads product images to the public bucket, updates product image
URLs in Postgres, and copies referenced receipts to the private bucket while
preserving their existing backend paths. It does not delete local files.
It stops if referenced files are missing; restore those files before retrying.

If specific product images are confirmed missing and cannot be restored, pass
`--skip-missing-products` along with `--confirm-storage-migration`. The script
logs the affected product IDs and leaves those image paths unchanged; this
option does not skip missing receipts or other upload errors.

## Switch the backend and verify

Set `DB_CLIENT=postgres` in the deployed backend's private environment, keep
the `PG*` database variables, `DB_SSL`, and the Supabase Storage variables
configured, then deploy/restart. Run `npm test` in CI and verify staff login,
customer login, product/category reads, image upload and display, authenticated
receipt viewing, POS checkout and refunds, inventory updates, online
order/payment handling, and reports before reopening writes.

Keep the MySQL backup until the new deployment has been checked and accepted.
Rolling back after new writes have reached Postgres requires a separate reverse
data migration; simply pointing the application back at MySQL would lose those
new writes.
