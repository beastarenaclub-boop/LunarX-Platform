# Master panels and customer playing websites

The customer playing domain is `play.lunarx.live`. Every master has a shareable
landing page at `https://play.lunarx.live/branch/<master-id>/`. These are branch
paths on the existing playing domain; they do not require separate domains or
DNS records. Master and agent login remains at `panel.lunarx.live`.

The master panel shows **Customer Playing Website** with the playing domain,
branch name, and an Open button. **Website links** provides the customer website
and customer login URL, with Open and Copy actions. Agents receive their parent
master's playing website. Admin's Business network shows a Website action on
each branch and a directory of master playing links. Links are derived from
the existing master ID, so new masters get them automatically.

Customers can browse the branch lobby without signing in. Game links and the
login return path retain `/branch/<master-id>`. The branch name appears in the
lobby and login screen. Invalid or inactive master links display an unavailable
page. The public metadata endpoint returns only display information and URLs;
it does not expose email addresses, users, balances or commission settings.

Branch links identify the storefront. Account membership remains determined by
the agent who created the customer; visiting another branch URL never changes
that membership. Existing wallet, commission, role and channel restrictions
continue to apply on the server.

Master/agent navigation has refreshable routes for overview, downline, agents,
users, profit and loss (`ledger`), wallet transactions (`transactions`),
settlements and website links (`website`). Masters manage their own agents;
agents manage their own customers. Company settlements remain admin-controlled.

Validation covers the isolated PostgreSQL network suite, master panel browser
flows, and guest browsing/login at mobile and desktop sizes. The API and web
gateway both require deployment. Branding/custom-domain settings and weekly
collection use migration 0051. See [master branding and weekly collection](master-branding-weekly.md)
for configuration, payment confirmation and Monday grace rules. Links use
`PLAY_HOST`, falling back to the first `B2B_HOSTS` hostname for local installations.
