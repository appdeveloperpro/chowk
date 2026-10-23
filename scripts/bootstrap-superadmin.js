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

  const email = (await ask("New super-admin email: ")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  const name = (await ask("Full name: ")).trim();
  if (name.length < 2) throw new Error("Full name must contain at least two characters.");
  const phone = (await ask("Phone number (international format, e.g. +919876543210): ")).trim();
  if (!/^\+?[1-9][0-9]{6,14}$/.test(phone)) throw new Error("Enter a valid phone number.");
  const password = await ask("New account password (minimum 8 characters; input is masked): ", { secret: true });
  if (password.length < 8 || password.length > 72) throw new Error("Password must be between 8 and 72 characters.");

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000
  });

  try {
    await client.connect();
    const migrationPath = path.resolve(__dirname, "..", "supabase", "migrations", "0001_chowk_portal.sql");
    await client.query(fs.readFileSync(migrationPath, "utf8"));
    console.log("Chowk database schema is installed.");

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
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Super-admin setup failed: ${error.message}`);
  process.exitCode = 1;
});
