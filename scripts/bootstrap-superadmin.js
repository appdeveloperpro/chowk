require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

function ask(prompt, { secret = false } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Run this command in an interactive local terminal.");
  }

  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    let value = "";
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          process.stdout.write("\n");
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          process.stdout.write("\n");
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          process.stdout.write(secret ? "*" : character);
        }
      }
    };
    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function signupUser(url, key, account) {
  const response = await fetch(`${url}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: account.email,
      password: account.password,
      data: { full_name: account.name, phone: account.phone }
    }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function main() {
  const projectUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
  ).trim();
  if (!projectUrl || !publishableKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the local .env file.");
  }

  const project = new URL(projectUrl);
  if (project.protocol !== "https:" || !project.hostname.endsWith(".supabase.co")) {
    throw new Error("SUPABASE_URL must be your HTTPS Supabase project URL.");
  }

  console.log(`Target Supabase project: ${project.hostname}`);
  const confirmation = await ask(`Type ${project.hostname} to confirm this is the intended project: `);
  if (confirmation !== project.hostname) throw new Error("Project confirmation did not match.");

  const databaseUrl = (await ask("Supabase Postgres connection URI (input is masked): ", { secret: true })).trim();
  const database = new URL(databaseUrl);
  const projectRef = project.hostname.split(".")[0];
  const databaseUser = decodeURIComponent(database.username);
  const databaseMatchesProject =
    database.hostname === `db.${projectRef}.supabase.co` ||
    (database.hostname.endsWith(".pooler.supabase.com") && databaseUser.endsWith(`.${projectRef}`));
  if (!["postgres:", "postgresql:"].includes(database.protocol) ||
      !databaseMatchesProject ||
      /YOUR_|PASSWORD/i.test(databaseUrl)) {
    throw new Error("The Postgres connection URI must belong to the same Supabase project shown above.");
  }

  const caPath = process.env.SUPABASE_DB_SSL_CA?.trim();
  let ca;
  if (caPath) {
    try {
      ca = fs.readFileSync(path.resolve(caPath));
    } catch {
      throw new Error("Could not read SUPABASE_DB_SSL_CA. Check that it points to the downloaded Supabase CA certificate.");
    }
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    connectionTimeoutMillis: 15_000
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
    console.log("Supabase database connection verified.");

    const email = (await ask("New super-admin email: ")).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    const name = (await ask("Full name: ")).trim();
    if (name.length < 2) throw new Error("Full name must contain at least two characters.");
    const phone = (await ask("Phone number (international format, e.g. +919876543210): ")).trim();
    if (!/^\+?[1-9][0-9]{6,14}$/.test(phone)) throw new Error("Enter a valid phone number.");
    const password = await ask("New account password (minimum 8 characters; input is masked): ", { secret: true });
    if (password.length < 8 || password.length > 72) throw new Error("Password must be between 8 and 72 characters.");

    const migrationPath = path.resolve(__dirname, "..", "supabase", "migrations", "0001_chowk_portal.sql");
    await client.query(fs.readFileSync(migrationPath, "utf8"));
    console.log("Chowk database schema is installed.");

    const superAdmin = await client.query(
      `select auth_user.email
       from public.profiles profile
       join auth.users auth_user on auth_user.id = profile.id
       where profile.role = 'super_admin'
       limit 1`
    );
    if (superAdmin.rowCount && superAdmin.rows[0].email.toLowerCase() !== email) {
      throw new Error("A super-admin account already exists. The Chowk system allows only one super admin.");
    }

    const existing = await client.query(
      "select id, email_confirmed_at from auth.users where lower(email) = lower($1) limit 1",
      [email]
    );
    let user;
    if (existing.rowCount) {
      const login = await fetch(`${projectUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: publishableKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(20_000)
      });
      if (!login.ok) {
        throw new Error("This email already exists. The entered password must match its current Supabase password; otherwise use a new email or reset the existing password first.");
      }
      user = existing;
    } else {
      const signup = await signupUser(projectUrl, publishableKey, { email, password, name, phone });
      user = await client.query(
        "select id, email_confirmed_at from auth.users where lower(email) = lower($1) limit 1",
        [email]
      );
      if (!signup.response.ok || !user.rowCount) {
        const message = signup.payload.msg || signup.payload.message || signup.payload.error_description ||
          signup.payload.error || `Supabase signup failed (HTTP ${signup.response.status}).`;
        throw new Error(message);
      }
    }

    await client.query(
      `insert into public.profiles (id, full_name, phone, role)
       values ($1, $2, $3, 'subscriber')
       on conflict (id) do nothing`,
      [user.rows[0].id, name, phone]
    );
    await client.query(
      "update public.profiles set role = 'super_admin' where id = $1",
      [user.rows[0].id]
    );

    console.log(`Super-admin access is ready for ${email}.`);
    if (!user.rows[0].email_confirmed_at) {
      console.log("Email confirmation is still required before sign-in. Check the account inbox.");
    }
    console.log("Sign in at /admin. The password was not saved by this script.");
  } catch (error) {
    if (error.code === "SELF_SIGNED_CERT_IN_CHAIN" || error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
      throw new Error(
        "TLS certificate verification failed. Download the CA certificate from Supabase Project Settings → Database → SSL Configuration, set SUPABASE_DB_SSL_CA in your local .env to its file path, then retry. Certificate verification remains enabled."
      );
    }
    throw error;
  } finally {
    if (connected) await client.end();
  }
}

main().catch((error) => {
  console.error(`Super-admin setup failed: ${error.message}`);
  process.exitCode = 1;
});
