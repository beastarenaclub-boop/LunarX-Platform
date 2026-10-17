import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const ROLES = ["admin", "agent", "shop", "user"];
const prefixes = { admin: "ADM", agent: "AGT", shop: "SHP", user: "USR" };
export const SERIES = Array.from({ length: 10 }, (_, i) => `JP${10 + i}`);
export const SERIES_PRICES = Object.fromEntries(
  SERIES.map((series, i) => [
    series,
    [100, 200, 500, 1000, 2000, 3000, 4000, 5000, 7500, 10000][i],
  ]),
);
const seriesPrice = (config, series) =>
  config.seriesPrices?.[series] ?? config.unitPrice;
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export class Fault extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const assert = (condition, message, status = 400) => {
  if (!condition) throw new Fault(message, status);
};
const integer = (value, min, max, label) => {
  assert(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `${label} must be ${min}–${max}.`,
  );
  return value;
};
const clean = (value, max = 100) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function passwordMatches(password, stored) {
  const [salt, digest] = stored.split(":");
  return timingSafeEqual(
    Buffer.from(digest, "hex"),
    scryptSync(password, salt, 64),
  );
}
const publicAccount = (account) => {
  if (!account) return null;
  const { password, ...safe } = account;
  return safe;
};

// Rejection sampling avoids modulo bias. The published seed can reproduce every result.
export function drawResults(seed) {
  const result = {};
  for (const series of SERIES) {
    result[series] = {};
    for (const [game, count, digits] of [
      ["2D", 100, 2],
      ["3D", 1000, 3],
      ["Titli", 10, 1],
    ]) {
      let attempt = 0,
        sample;
      do {
        sample = createHmac("sha256", seed)
          .update(`${series}:${game}:${attempt++}`)
          .digest()
          .readUInt32BE();
      } while (sample >= Math.floor(4294967296 / count) * count);
      result[series][game] = String(sample % count).padStart(digits, "0");
    }
  }
  return result;
}

export function createStore(
  filename,
  { demo = true, now = () => Date.now(), adminPassword } = {},
) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, parent_id TEXT REFERENCES accounts(id), balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0), commission INTEGER NOT NULL DEFAULT 500, active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS draws (id TEXT PRIMARY KEY, closes INTEGER NOT NULL, ends INTEGER NOT NULL, status TEXT NOT NULL, seed TEXT NOT NULL, commitment TEXT NOT NULL, results TEXT, settings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES accounts(id), agent_id TEXT REFERENCES accounts(id), draw_id TEXT NOT NULL REFERENCES draws(id), game TEXT NOT NULL, lines TEXT NOT NULL, total INTEGER NOT NULL, payout INTEGER NOT NULL DEFAULT 0, commission INTEGER NOT NULL, status TEXT NOT NULL, customer TEXT NOT NULL, created INTEGER NOT NULL, claimed INTEGER, print_count INTEGER NOT NULL DEFAULT 0, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, UNIQUE(seller_id, request_key));
    CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL, amount INTEGER NOT NULL, balance INTEGER NOT NULL, reference TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS complaints (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), subject TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS operations (actor_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor_id,request_key));
    CREATE INDEX IF NOT EXISTS ticket_seller ON tickets(seller_id, created);
    CREATE INDEX IF NOT EXISTS ticket_draw ON tickets(draw_id, status);
    CREATE INDEX IF NOT EXISTS ledger_account ON ledger(account_id, created);
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const audit = (actor, action, detail) =>
    run(
      "INSERT INTO audit VALUES(?,?,?,?,?)",
      randomUUID(),
      actor,
      action,
      JSON.stringify(detail),
      now(),
    );
  const settings = () =>
    JSON.parse(get("SELECT value FROM settings WHERE id=1").value);
  const account = (id) => get("SELECT * FROM accounts WHERE id=?", id);
  const visibleIds = (actor) =>
    actor.role === "admin"
      ? all("SELECT id FROM accounts").map((a) => a.id)
      : actor.role === "agent"
        ? [
            actor.id,
            ...all("SELECT id FROM accounts WHERE parent_id=?", actor.id).map(
              (a) => a.id,
            ),
          ]
        : [actor.id];
  const visibleTickets = (actor) => {
    const ids = visibleIds(actor);
    return all(
      `SELECT t.*, a.name AS seller_name FROM tickets t JOIN accounts a ON a.id=t.seller_id WHERE t.seller_id IN (${ids.map(() => "?").join(",")}) ORDER BY t.created DESC`,
      ...ids,
    ).map(parseTicket);
  };
  const allowed = (actor, roles) =>
    assert(
      actor && roles.includes(actor.role),
      "This action is not available for your role.",
      403,
    );
  function move(accountId, amount, kind, reference) {
    const target = account(accountId);
    assert(
      target &&
        Number.isSafeInteger(amount) &&
        Number.isSafeInteger(target.balance + amount) &&
        target.balance + amount >= 0,
      "Insufficient wallet balance.",
    );
    run("UPDATE accounts SET balance=balance+? WHERE id=?", amount, accountId);
    run(
      "INSERT INTO ledger VALUES(?,?,?,?,?,?,?)",
      randomUUID(),
      accountId,
      kind,
      amount,
      target.balance + amount,
      reference,
      now(),
    );
  }
  function parseTicket(t) {
    const lines = JSON.parse(t.lines);
    const config = lines.some((line) => line.unitPrice === undefined)
      ? JSON.parse(
          get("SELECT settings FROM draws WHERE id=?", t.draw_id).settings,
        )
      : null;
    return {
      ...t,
      lines: lines.map((line) => ({
        ...line,
        unitPrice: line.unitPrice ?? seriesPrice(config, line.series),
      })),
    };
  }
  function requireTicket(actor, id) {
    const ticket = get("SELECT * FROM tickets WHERE id=?", id);
    assert(
      ticket && visibleIds(actor).includes(ticket.seller_id),
      "Ticket not found.",
      404,
    );
    return parseTicket(ticket);
  }
  function once(actor, key, body, fn) {
    assert(
      typeof key === "string" && key.length >= 8 && key.length <= 100,
      "A valid request key is required.",
    );
    const hash = sha(JSON.stringify(body));
    const prior = get(
      "SELECT * FROM operations WHERE actor_id=? AND request_key=?",
      actor.id,
      key,
    );
    if (prior) {
      assert(
        prior.request_hash === hash,
        "Request key already used for a different action.",
        409,
      );
      return JSON.parse(prior.result);
    }
    const result = fn();
    run(
      "INSERT INTO operations VALUES(?,?,?,?)",
      actor.id,
      key,
      hash,
      JSON.stringify(result),
    );
    return result;
  }
  if (!get("SELECT id FROM settings WHERE id=1"))
    run(
      "INSERT INTO settings VALUES(1,?)",
      JSON.stringify({
        brand: "Irland Lotto",
        interval: 15,
        unitPrice: 1,
        seriesPrices: SERIES_PRICES,
        currency: "INR",
        payouts: { "2D": 80, "3D": 800, Titli: 8 },
        maxTicket: 20000,
        salesEnabled: true,
        timezone: "Asia/Dubai",
      }),
    );
  if (!get("SELECT id FROM accounts WHERE role='admin'")) {
    assert(
      demo || (adminPassword && adminPassword.length >= 12),
      "Set LOTTERY_ADMIN_PASSWORD (at least 12 characters) for non-demo startup.",
    );
    transaction(() => {
      const seedAccount = (id, role, name, parent, balance) => {
        run(
          "INSERT INTO accounts(id,role,name,password,parent_id,balance,created) VALUES(?,?,?,?,?,0,?)",
          id,
          role,
          name,
          hashPassword(
            role === "admin" && adminPassword ? adminPassword : "Lottery@123",
          ),
          parent,
          now(),
        );
        if (balance) move(id, balance, "opening_credit", "LOCAL-DEMO");
      };
      seedAccount("ADM-1001", "admin", "Alex Morgan", null, 0);
      if (demo) {
        seedAccount("AGT-2001", "agent", "Metro Distribution", null, 100000);
        seedAccount(
          "SHP-3001",
          "shop",
          "Central Lottery Shop",
          "AGT-2001",
          25000,
        );
        seedAccount("USR-4001", "user", "Jordan Lee", null, 5000);
        const config = settings(),
          step = config.interval * 60000;
        for (let i = 6; i >= 1; i--) {
          const ends = Math.floor(now() / step) * step - (i - 1) * step;
          const seed = randomBytes(32).toString("hex");
          run(
            "INSERT INTO draws VALUES(?,?,?,?,?,?,?,?)",
            `LD-${ends}`,
            ends - 10000,
            ends,
            "settled",
            seed,
            sha(seed),
            JSON.stringify(drawResults(seed)),
            JSON.stringify(config),
          );
        }
        audit("system", "demo_draw_history_seeded", { count: 6 });
      }
      audit("system", "workspace_created", { demo });
    });
  }

  // One-time INR pricing update. Sold draws keep their original price and payouts.
  transaction(() => {
    const name = "2026-10-inr-one-rupee";
    if (get("SELECT name FROM migrations WHERE name=?", name)) return;
    const previous = settings();
    run(
      "UPDATE settings SET value=? WHERE id=1",
      JSON.stringify({ ...previous, unitPrice: 1, currency: "INR" }),
    );
    const untouched = all(
      "SELECT * FROM draws d WHERE d.status='open' AND d.closes>? AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.draw_id=d.id)",
      now(),
    );
    for (const draw of untouched) {
      const config = JSON.parse(draw.settings);
      run(
        "UPDATE draws SET settings=? WHERE id=?",
        JSON.stringify({ ...config, unitPrice: 1, currency: "INR" }),
        draw.id,
      );
    }
    run("INSERT INTO migrations VALUES(?,?)", name, now());
    audit("system", "inr_unit_price_applied", {
      previousPrice: previous.unitPrice,
      unitPrice: 1,
      updatedDraws: untouched.map((d) => d.id),
    });
  });

  // A rate change must never reprice an issued ticket or an already sold draw.
  transaction(() => {
    const name = "2026-10-nice-series-prices";
    if (get("SELECT name FROM migrations WHERE name=?", name)) return;
    const current = settings();
    run(
      "UPDATE settings SET value=? WHERE id=1",
      JSON.stringify({ ...current, seriesPrices: SERIES_PRICES }),
    );
    const untouched = all(
      "SELECT * FROM draws d WHERE d.status='open' AND d.closes>? AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.draw_id=d.id)",
      now(),
    );
    for (const draw of untouched) {
      run(
        "UPDATE draws SET settings=? WHERE id=?",
        JSON.stringify({
          ...JSON.parse(draw.settings),
          seriesPrices: SERIES_PRICES,
        }),
        draw.id,
      );
    }
    run("INSERT INTO migrations VALUES(?,?)", name, now());
    audit("system", "series_prices_applied", {
      seriesPrices: SERIES_PRICES,
      updatedDraws: untouched.map((d) => d.id),
    });
  });

  // Rebrand existing workspaces without changing pricing or issued ticket IDs.
  transaction(() => {
    const name = "2026-10-irland-lotto-brand";
    if (get("SELECT name FROM migrations WHERE name=?", name)) return;
    const previous = settings();
    run("UPDATE settings SET value=? WHERE id=1",
      JSON.stringify({ ...previous, brand: "Irland Lotto" }));
    for (const draw of all("SELECT id, settings FROM draws")) {
      run("UPDATE draws SET settings=? WHERE id=?",
        JSON.stringify({ ...JSON.parse(draw.settings), brand: "Irland Lotto" }), draw.id);
    }
    run("INSERT INTO migrations VALUES(?,?)", name, now());
    audit("system", "brand_updated", { before: previous.brand, after: "Irland Lotto" });
  });

  function schedule() {
    const config = settings(),
      step = config.interval * 60000,
      current = Math.floor(now() / step) * step + step;
    const latest = get(
      "SELECT MAX(ends) AS ends FROM draws WHERE status='open'",
    ).ends;
    // Keep already sold/scheduled draws unchanged when the interval is edited.
    let end = latest ? latest + step : current;
    const count = get(
      "SELECT COUNT(*) AS count FROM draws WHERE status='open' AND ends>?",
      now(),
    ).count;
    for (let i = count; i < 8; i++, end += step) {
      if (end <= now()) end = current;
      const id = `LD-${end}`,
        seed = randomBytes(32).toString("hex");
      run(
        "INSERT OR IGNORE INTO draws VALUES(?,?,?,?,?,?,?,?)",
        id,
        end - 10000,
        end,
        "open",
        seed,
        sha(seed),
        null,
        JSON.stringify(config),
      );
    }
  }
  function tick() {
    transaction(() => {
      for (const draw of all(
        "SELECT * FROM draws WHERE status='open' AND ends<=? ORDER BY ends",
        now(),
      )) {
        const results = drawResults(draw.seed),
          config = JSON.parse(draw.settings);
        run(
          "UPDATE draws SET status='settled', results=? WHERE id=?",
          JSON.stringify(results),
          draw.id,
        );
        for (const ticket of all(
          "SELECT * FROM tickets WHERE draw_id=? AND status='pending'",
          draw.id,
        )) {
          const seller = account(ticket.seller_id);
          const payout = JSON.parse(ticket.lines).reduce(
            (sum, line) =>
              sum +
              (results[line.series][ticket.game] === line.number
                ? line.quantity *
                  (line.unitPrice ?? seriesPrice(config, line.series)) *
                  config.payouts[ticket.game]
                : 0),
            0,
          );
          const autoClaim = seller.role === "user" && payout > 0;
          run(
            "UPDATE tickets SET payout=?,status=?,claimed=? WHERE id=?",
            payout,
            payout > 0 ? (autoClaim ? "claimed" : "won") : "lost",
            autoClaim ? now() : null,
            ticket.id,
          );
          if (autoClaim) move(seller.id, payout, "prize", ticket.id);
          if (ticket.agent_id && ticket.commission > 0)
            move(ticket.agent_id, ticket.commission, "commission", ticket.id);
        }
        audit("system", "draw_settled", {
          drawId: draw.id,
          commitment: draw.commitment,
        });
      }
      schedule();
      run("DELETE FROM sessions WHERE expires<?", now());
    });
  }
  tick();

  return {
    db,
    tick,
    close: () => db.close(),
    login(role, id, password) {
      assert(
        ROLES.includes(role) &&
          typeof password === "string" &&
          password.length <= 128,
        "Invalid login.",
        401,
      );
      const row = account(clean(id, 32).toUpperCase());
      // Run the expensive hash for unknown IDs too, limiting account enumeration.
      const valid = passwordMatches(
        password,
        row?.password ?? "00000000000000000000000000000000:" + "00".repeat(64),
      );
      assert(
        row && row.role === role && row.active && valid,
        "ID or password is incorrect for this portal.",
        401,
      );
      const token = randomBytes(32).toString("hex");
      run(
        "INSERT INTO sessions VALUES(?,?,?)",
        sha(token),
        row.id,
        now() + 8 * 3600000,
      );
      audit(row.id, "signed_in", { role });
      return { token, account: publicAccount(row) };
    },
    authenticate(token, role) {
      if (!token || !ROLES.includes(role)) return null;
      const row = get(
        "SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token=? AND s.expires>? AND a.active=1 AND a.role=?",
        sha(token),
        now(),
        role,
      );
      return publicAccount(row);
    },
    logout(token) {
      if (token) run("DELETE FROM sessions WHERE token=?", sha(token));
    },
    bootstrap(actor) {
      tick();
      const tickets = visibleTickets(actor),
        ids = visibleIds(actor),
        today = new Intl.DateTimeFormat("en-CA", {
          timeZone: settings().timezone,
        }).format(now());
      const todays = tickets.filter(
        (t) =>
          new Intl.DateTimeFormat("en-CA", {
            timeZone: settings().timezone,
          }).format(t.created) === today,
      );
      const valid = todays.filter((t) => t.status !== "cancelled");
      const ledger = all(
        `SELECT l.*, a.name AS account_name FROM ledger l JOIN accounts a ON a.id=l.account_id WHERE account_id IN (${ids.map(() => "?").join(",")}) ORDER BY created DESC LIMIT 500`,
        ...ids,
      );
      const draws = all("SELECT * FROM draws ORDER BY ends DESC LIMIT 100")
        .map(({ seed, settings: saved, ...d }) => ({
          ...d,
          seed: d.status === "settled" ? seed : undefined,
          results: d.results ? JSON.parse(d.results) : null,
          config: JSON.parse(saved),
        }))
        .sort((a, b) => a.ends - b.ends);
      const accounts =
        actor.role === "admin"
          ? all("SELECT * FROM accounts")
          : actor.role === "agent"
            ? all("SELECT * FROM accounts WHERE parent_id=?", actor.id)
            : [];
      const complaints =
        actor.role === "admin"
          ? all("SELECT * FROM complaints ORDER BY created DESC LIMIT 200")
          : all(
              "SELECT * FROM complaints WHERE account_id=? ORDER BY created DESC LIMIT 200",
              actor.id,
            );
      return {
        account: publicAccount(account(actor.id)),
        mode: demo ? "demo" : "local",
        serverTime: now(),
        settings: settings(),
        draws,
        tickets,
        accounts: accounts.map(publicAccount),
        ledger,
        complaints,
        audit:
          actor.role === "admin"
            ? all("SELECT * FROM audit ORDER BY created DESC LIMIT 150")
            : [],
        stats: {
          sales: valid.reduce((s, t) => s + t.total, 0),
          tickets: valid.length,
          prizes: valid.reduce((s, t) => s + t.payout, 0),
          commission: valid
            .filter((t) => t.status !== "pending")
            .reduce((s, t) => s + t.commission, 0),
          pendingClaims: tickets.filter((t) => t.status === "won").length,
          cancelled: todays.filter((t) => t.status === "cancelled").length,
        },
      };
    },
    sell(actor, body, requestKey) {
      allowed(actor, ["shop", "user"]);
      return transaction(() =>
        once(actor, requestKey, { ...body, action: "sell" }, () => {
          const { drawId, game } = body,
            config = settings();
          assert(config.salesEnabled, "Ticket sales are paused.");
          const draw = get("SELECT * FROM draws WHERE id=?", drawId);
          assert(
            draw && draw.status === "open" && now() < draw.closes,
            "Sales for this draw are closed. Choose the next draw.",
          );
          assert(["2D", "3D", "Titli"].includes(game), "Choose a valid game.");
          assert(
            Array.isArray(body.lines) &&
              body.lines.length > 0 &&
              body.lines.length <= 1000,
            "Choose between 1 and 1,000 selections.",
          );
          const digits = game === "3D" ? 3 : game === "2D" ? 2 : 1,
            keys = new Set();
          const locked = JSON.parse(draw.settings);
          const lines = body.lines.map((line) => {
            assert(
              SERIES.includes(line.series) &&
                typeof line.number === "string" &&
                new RegExp(`^[0-9]{${digits}}$`).test(line.number),
              "Invalid series or number.",
            );
            const key = `${line.series}:${line.number}`;
            assert(
              !keys.has(key),
              "Duplicate number selections are not allowed.",
            );
            keys.add(key);
            return {
              series: line.series,
              number: line.number,
              quantity: integer(line.quantity, 1, 500, "Quantity"),
              unitPrice: seriesPrice(locked, line.series),
            };
          });
          const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
          assert(
            total <= locked.maxTicket,
            `Ticket limit is ₹${locked.maxTicket.toLocaleString("en-IN")}.`,
          );
          const seller = account(actor.id),
            agent = seller.parent_id ? account(seller.parent_id) : null;
          assert(
            seller.active && (!agent || agent.active),
            "This account or its agent is suspended.",
            403,
          );
          const commission = agent
            ? Math.floor((total * agent.commission) / 10000)
            : 0;
          const id = `TK-${randomBytes(6).toString("hex").toUpperCase()}`;
          move(actor.id, -total, "ticket_sale", id);
          run(
            "INSERT INTO tickets(id,seller_id,agent_id,draw_id,game,lines,total,commission,status,customer,created,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            id,
            actor.id,
            agent?.id ?? null,
            drawId,
            game,
            JSON.stringify(lines),
            total,
            commission,
            "pending",
            clean(body.customer, 60) ||
              (actor.role === "shop" ? "Walk-in customer" : actor.name),
            now(),
            requestKey,
            sha(JSON.stringify(body)),
          );
          audit(actor.id, "ticket_sold", { ticketId: id, total });
          return parseTicket(get("SELECT * FROM tickets WHERE id=?", id));
        }),
      );
    },
    cancel(actor, id) {
      allowed(actor, ["shop", "user"]);
      return transaction(() => {
        const ticket = requireTicket(actor, id),
          draw = get("SELECT * FROM draws WHERE id=?", ticket.draw_id);
        if (ticket.status === "cancelled") return ticket;
        assert(
          ticket.status === "pending" && now() < draw.closes,
          "Only tickets for an open draw can be cancelled.",
        );
        run("UPDATE tickets SET status='cancelled' WHERE id=?", id);
        move(ticket.seller_id, ticket.total, "ticket_refund", id);
        audit(actor.id, "ticket_cancelled", { ticketId: id });
        return { ...ticket, status: "cancelled" };
      });
    },
    claim(actor, id) {
      allowed(actor, ["shop"]);
      return transaction(() => {
        const ticket = requireTicket(actor, id);
        assert(
          ticket.status === "won",
          ticket.status === "claimed"
            ? "This ticket was already claimed."
            : "This ticket has no claimable prize.",
          409,
        );
        run(
          "UPDATE tickets SET status='claimed',claimed=? WHERE id=?",
          now(),
          id,
        );
        move(actor.id, ticket.payout, "prize", id);
        audit(actor.id, "prize_claimed", {
          ticketId: id,
          payout: ticket.payout,
        });
        return { ...ticket, status: "claimed", claimed: now() };
      });
    },
    receipt(actor, id) {
      allowed(actor, ["shop"]);
      return transaction(() => {
        const ticket = requireTicket(actor, id);
        assert(
          ticket.status !== "cancelled",
          "Cancelled tickets cannot be printed.",
        );
        run("UPDATE tickets SET print_count=print_count+1 WHERE id=?", id);
        audit(
          actor.id,
          ticket.print_count ? "ticket_reprinted" : "ticket_printed",
          { ticketId: id },
        );
        return {
          ...ticket,
          print_count: ticket.print_count + 1,
          shop: actor.name,
          draw: get(
            "SELECT id,ends,closes FROM draws WHERE id=?",
            ticket.draw_id,
          ),
          brand: settings().brand,
          demo,
        };
      });
    },
    createAccount(actor, body) {
      allowed(actor, ["admin", "agent"]);
      assert(
        actor.role === "admin"
          ? ["agent", "shop", "user"].includes(body.role)
          : body.role === "shop",
        "You cannot create this role.",
        403,
      );
      const name = clean(body.name, 60),
        password = body.password;
      assert(
        name.length >= 2 &&
          typeof password === "string" &&
          password.length >= 10 &&
          password.length <= 128,
        "Name and a password of 10–128 characters are required.",
      );
      const parent =
        body.role === "shop"
          ? actor.role === "agent"
            ? actor.id
            : clean(body.parentId, 32)
          : null;
      if (body.role === "shop")
        assert(
          account(parent)?.role === "agent" && account(parent).active,
          "Select an active parent agent.",
        );
      const commission =
        body.role === "agent"
          ? integer(
              body.commission ?? 500,
              0,
              2000,
              "Commission (basis points)",
            )
          : 0;
      const id = `${prefixes[body.role]}-${randomBytes(3).toString("hex").toUpperCase()}`;
      return transaction(() => {
        run(
          "INSERT INTO accounts(id,role,name,password,parent_id,commission,created) VALUES(?,?,?,?,?,?,?)",
          id,
          body.role,
          name,
          hashPassword(password),
          parent,
          commission,
          now(),
        );
        audit(actor.id, "account_created", { id, role: body.role, parent });
        return publicAccount(account(id));
      });
    },
    setActive(actor, id, active) {
      allowed(actor, ["admin"]);
      assert(
        id !== actor.id && typeof active === "boolean",
        "Invalid account update.",
      );
      assert(account(id), "Account not found.", 404);
      return transaction(() => {
        run("UPDATE accounts SET active=? WHERE id=?", active ? 1 : 0, id);
        if (!active) run("DELETE FROM sessions WHERE account_id=?", id);
        audit(actor.id, "account_status", { id, active });
        return publicAccount(account(id));
      });
    },
    transfer(actor, body, key) {
      allowed(actor, ["admin", "agent"]);
      return transaction(() =>
        once(actor, key, { ...body, action: "transfer" }, () => {
          const target = account(body.targetId),
            amount = integer(body.amount, 1, 10000000, "Credits");
          assert(
            target &&
              target.active &&
              target.id !== actor.id &&
              target.role !== "admin",
            "Choose an active destination account.",
          );
          assert(
            actor.role === "admin" ||
              (target.role === "shop" && target.parent_id === actor.id),
            "You can only fund your own shops.",
            403,
          );
          const note = clean(body.note, 160);
          assert(note.length >= 3, "A transfer reference is required.");
          const ref = `TR-${randomBytes(6).toString("hex").toUpperCase()}`;
          if (actor.role === "agent")
            move(actor.id, -amount, "transfer_out", ref);
          move(
            target.id,
            amount,
            actor.role === "admin" ? "admin_credit" : "transfer_in",
            ref,
          );
          audit(actor.id, "credit_transfer", {
            target: target.id,
            amount,
            note,
            reference: ref,
          });
          return { reference: ref, amount, targetId: target.id };
        }),
      );
    },
    updateSettings(actor, body) {
      allowed(actor, ["admin"]);
      const current = settings();
      const proposedPrices = body.seriesPrices ?? current.seriesPrices;
      assert(
        proposedPrices &&
          typeof proposedPrices === "object" &&
          !Array.isArray(proposedPrices),
        "Enter a price for every Irland Lotto series.",
      );
      const seriesPrices = Object.fromEntries(
        SERIES.map((series) => [
          series,
          integer(
            proposedPrices[series],
            100,
            10000,
            `${series.replace("JP", "Irland Lotto ")} price`,
          ),
        ]),
      );
      const value = {
        ...current,
        brand: clean(body.brand, 30) || current.brand,
        interval: integer(body.interval, 1, 120, "Draw interval"),
        unitPrice: integer(
          body.unitPrice ?? current.unitPrice,
          1,
          1000,
          "Legacy ticket price",
        ),
        seriesPrices,
        maxTicket: integer(body.maxTicket, 10, 1000000, "Ticket limit"),
        payouts: {
          "2D": integer(body.payouts?.["2D"], 1, 10000, "2D payout"),
          "3D": integer(body.payouts?.["3D"], 1, 100000, "3D payout"),
          Titli: integer(body.payouts?.Titli, 1, 1000, "Titli payout"),
        },
        salesEnabled: body.salesEnabled === true,
      };
      return transaction(() => {
        run("UPDATE settings SET value=? WHERE id=1", JSON.stringify(value));
        audit(actor.id, "settings_updated", value);
        return value;
      });
    },
    complaint(actor, body) {
      const subject = clean(body.subject, 100),
        message = clean(body.message, 2000);
      assert(
        subject.length >= 3 && message.length >= 10,
        "Enter a subject and at least 10 characters of detail.",
      );
      const id = `CS-${randomBytes(4).toString("hex").toUpperCase()}`;
      run(
        "INSERT INTO complaints(id,account_id,subject,message,status,created) VALUES(?,?,?,?,?,?)",
        id,
        actor.id,
        subject,
        message,
        "open",
        now(),
      );
      audit(actor.id, "support_opened", { id });
      return { id };
    },
    resolveComplaint(actor, id, reply) {
      allowed(actor, ["admin"]);
      const message = clean(reply, 2000);
      assert(message.length >= 3, "Enter a reply.");
      assert(
        get("SELECT id FROM complaints WHERE id=?", id),
        "Support request not found.",
        404,
      );
      run(
        "UPDATE complaints SET status='resolved',reply=? WHERE id=?",
        message,
        id,
      );
      audit(actor.id, "support_resolved", { id });
      return { id };
    },
    changePassword(actor, body) {
      assert(
        typeof body.current === "string" &&
          body.current.length <= 128 &&
          passwordMatches(body.current, account(actor.id).password),
        "Current password is incorrect.",
      );
      assert(
        typeof body.password === "string" &&
          body.password.length >= 10 &&
          body.password.length <= 128,
        "Use 10–128 characters.",
      );
      transaction(() => {
        run(
          "UPDATE accounts SET password=? WHERE id=?",
          hashPassword(body.password),
          actor.id,
        );
        run("DELETE FROM sessions WHERE account_id=?", actor.id);
        audit(actor.id, "password_changed", {});
      });
      return { ok: true };
    },
  };
}
