# playmarkets-uptime

Uptime check for the PlayMarkets API hosts (BLACKJ-850). Every 5 minutes a GitHub
Actions run calls each host's `/health` and posts to Slack `#playmarkets-alerts`
when a host stops answering 200, every hour while it stays down, and when it recovers.

| Host | URL |
|---|---|
| dev | https://dev-api-playmarket.rain.one/health |
| staging | https://stg-api-playmarket.rain.one/health |

The backend's `/health` answers 503 when Mongo, Redis or the chain RPC fails, and the
alert names which one. It lives in its own public repository because scheduled runs
on the org's private repositories would use up the free Actions minutes.

- Secret: `SLACK_WEBHOOK_URL` (repository Actions secret, from Matan).
- Run it by hand from the Actions tab ("Run workflow"): that run also posts where every
  host stands, which is a quick way to test the webhook.
- Locally: `SLACK_WEBHOOK_URL=... node check.mjs` (Node 22).
- What to do when it fires: `docs/incident-runbook.md` in rain-playmarket-be.
