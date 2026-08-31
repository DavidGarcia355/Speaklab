# TryHabla Discord HQ runbook

## Scope

The HQ manager is restricted to a Discord guild whose normalized name is exactly `TryHabla`. An explicit `DISCORD_GUILD_ID` is still verified against that name before any channel is changed. It does not manage the founder's Discord account, direct messages, other servers, members, or roles.

## Required production configuration

- `DISCORD_BOT_TOKEN`: sensitive Vercel Production variable. Never commit or print it.
- `DISCORD_GUILD_ID`: Vercel Production variable containing the TryHabla server ID.
- `DISCORD_ALERTS_ENV=production`: optional explicit environment pin; Vercel Production is inferred safely when omitted.
- `DISCORD_WEBHOOK_URL`: existing temporary fallback. Remove it after bot delivery and production routing are verified.

The Discord bot needs only these guild permissions:

- View Channels
- Manage Channels
- Send Messages
- Embed Links
- Read Message History

Do not grant Administrator when the narrower permissions are available.

## HQ layout

- `📈 LIVE`: `#habla-pulse`, `#revenue`, `#milestones`, `#scoreboard`
- `💼 GROWTH`: `#sales-leads`, `#marketing`
- `🧠 BUILD`: `#product-ideas`, `#dev-shipping`
- `🛠 OPS`: `#incidents`, `#system-health`
- `🏢 HQ`: `#founder-chat`, `#company-log`

## Production routing

- Teacher signup, activation, first class, first assignment, first recording, first AI review, and free-allowance progress → `#habla-pulse`
- Paid subscription, renewal, failed payment, refund, and paid allowance events → `#revenue`
- School leads → `#sales-leads`
- Company and MRR milestones → `#milestones`
- Daily and weekly scoreboards → `#scoreboard`
- AI, provider, outbox, and payment incidents → `#incidents`
- Successful Vercel production releases → `#dev-shipping`

## Admin controls

`/api/admin/discord-hq` requires a signed-in TryHabla admin and same-origin requests.

- `GET`: inspect non-secret connection and layout status.
- `POST` action `rebuild`, confirmation `REBUILD_TRYHABLA_HQ`: delete existing TryHabla guild channels child-first and recreate the exact HQ layout.
- `POST` action `verify`, confirmation `VERIFY_TRYHABLA_HQ`: send one controlled verification message to every HQ channel.
- `POST` action `launch`, confirmation `LAUNCH_TRYHABLA_HQ`: send `🎮 TRYHABLA HQ ONLINE` to `#company-log`.

## Safe rollout order

1. Authorize the bot into only the TryHabla server with the narrow permissions above.
2. Store the bot token and guild ID in Vercel Production.
3. Inspect the guild connection and confirm the name is TryHabla.
4. Run the explicit rebuild.
5. Run per-channel verification and the launch message.
6. Trigger and verify representative production event routing.
7. Remove the temporary webhook variable after bot delivery is confirmed.
8. Run the clean release check and deploy the reviewed commit.
