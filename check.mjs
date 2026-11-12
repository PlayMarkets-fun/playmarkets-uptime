// BLACKJ-850: polls each PlayMarkets API host's /health and posts to
// #playmarkets-alerts when a host goes down, every hour while it stays down,
// and when it recovers. A host is down unless /health answers 200 within the
// timeout; the backend's /health returns 503 when Mongo, Redis or the chain
// RPC fails, and names the failing check.
//
// State (which hosts were down, and since when) is carried between runs in
// state.json, which the workflow saves and restores through the Actions cache.
//
//   SLACK_WEBHOOK_URL=... node check.mjs

import { readFile, writeFile } from "node:fs/promises";

const HOSTS = [
  { name: "dev", url: "https://dev-api-playmarket.rain.one/health" },
  { name: "staging", url: "https://stg-api-playmarket.rain.one/health" },
];
const TIMEOUT_MS = 10_000;
const REMIND_EVERY_MS = 60 * 60 * 1000;
const STATE_FILE = "state.json";

const loadState = async () => {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
};

const probe = async ({ url }) => {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "cache-control": "no-cache" },
    });
    if (res.ok) return { up: true };

    let reason = `HTTP ${res.status}`;
    try {
      const failed = Object.entries((await res.json())?.data?.checks ?? {})
        .filter(([, check]) => !check.ok)
        .map(([name]) => name);
      if (failed.length) reason += ` - failing: ${failed.join(", ")}`;
    } catch {
      // Not our JSON (a proxy's 502 page): the status says enough.
    }
    return { up: false, reason };
  } catch (ex) {
    const reason =
      ex.name === "TimeoutError"
        ? `no answer in ${TIMEOUT_MS / 1000}s`
        : `unreachable (${ex.cause?.code ?? ex.message})`;
    return { up: false, reason };
  }
};

const minutesSince = (iso) =>
  Math.round((Date.now() - new Date(iso).getTime()) / 60000);

const post = async (text) => {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    console.warn("SLACK_WEBHOOK_URL not set, alert not sent:", text);
    return;
  }
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) console.error(`Slack answered ${res.status}`);
};

const state = await loadState();
const now = new Date().toISOString();
const messages = [];
let anyDown = false;

for (const host of HOSTS) {
  const result = await probe(host);
  const was = state[host.name];
  console.log(`${host.name}: ${result.up ? "up" : `DOWN - ${result.reason}`}`);

  if (result.up) {
    if (was) {
      messages.push(
        `:white_check_mark: *${host.name}* API is back up after ${minutesSince(was.since)} min (${host.url})`,
      );
    }
    delete state[host.name];
    continue;
  }

  anyDown = true;
  if (!was) {
    messages.push(
      `:red_circle: *${host.name}* API is DOWN: ${result.reason} (${host.url})`,
    );
    state[host.name] = { since: now, lastAlert: now };
  } else if (Date.now() - new Date(was.lastAlert).getTime() >= REMIND_EVERY_MS) {
    messages.push(
      `:red_circle: *${host.name}* API still DOWN after ${minutesSince(was.since)} min: ${result.reason} (${host.url})`,
    );
    was.lastAlert = now;
  }
}

// A run started by hand also posts where every host stands, so switching the
// check on (or testing the webhook) shows up in the channel.
if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
  const lines = HOSTS.map((host) =>
    state[host.name] ? `:red_circle: ${host.name} down` : `:large_green_circle: ${host.name} up`,
  );
  messages.push(`Uptime check run by hand: ${lines.join(", ")}. Checking every 5 minutes.`);
}

for (const text of messages) await post(text);
await writeFile(STATE_FILE, JSON.stringify(state, null, 2));

// A failed run also emails whoever last edited the workflow, which is the
// fallback while the Slack webhook is missing.
if (anyDown) process.exitCode = 1;
