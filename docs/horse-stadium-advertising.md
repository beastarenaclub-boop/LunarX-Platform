# Stadium advertising

The horse-racing stadium has 145 physical, double-sided hoardings in every venue:
52 around the outer running rail, 56 low inner-rail panels, 18 on the grandstand
canopy fronts, two large infield billboards, six raised bend screens, ten along
the entrance roads and one beside the finish line. Metal housings, posts and
concrete footings keep the artwork inside the 3D scene. These are advertising
surfaces, with no player popups or navigation attached to them.

There are also 42 flat sponsor graphics: 24 on the paved service lane outside
the running rail, six painted onto the rear entrance roads and 12 on the infield
grass aprons. The running lanes remain clear. Broadcast and Rail-side aim higher
to include more of the spectator/advertising backdrop while following all eight
horses; Grandstand retains the complete stadium overview. All new surfaces use
the same four campaign groups, so existing sponsor configuration still applies.

The supplied **YOUR BRAND** images are sample artwork, not paid sponsorships.
The four SVGs in `artifacts/3d-game/public/assets/horse-racing/advertising/` are
original vector assets authored for this project. They can be replaced with a
real sponsor's logo/banner when the artwork is available.

## Publish a sponsor

Edit `public/assets/horse-racing/advertising/campaigns.json` inside the 3d-game
app. Copy new artwork into the same public folder and use a new filename for
each revision. Deploy the artwork and JSON to the same paths on the web server.
An existing game tab fetches the configuration every 60 seconds; no JavaScript
rebuild is needed for campaign changes.

```json
{
  "version": 1,
  "campaigns": [
    {
      "id": "sponsor-october",
      "slot": "trackside",
      "enabled": true,
      "imageUrl": "/assets/horse-racing/advertising/sponsor-october-v1.webp",
      "venues": ["royal", "marathon"],
      "startsAt": "2026-10-10T00:00:00Z",
      "endsAt": "2026-11-01T00:00:00Z"
    }
  ]
}
```

| Slot | Placement | Artwork ratio | Suggested size |
| --- | --- | --- | --- |
| `trackside` | Inner/outer rail, roadside boards and road graphics | 8:1 | 1600 x 200 |
| `infield` | Large freestanding billboards, bend screens and grass graphics | 3:1 | 1500 x 500 |
| `grandstand` | Repeated panels beneath the canopy edge | 12:1 | 1800 x 150 |
| `finish` | Raised board alongside the finish line | 6:1 | 1440 x 240 |

Use PNG, JPG, WebP or SVG under 8 MB. Artwork is fitted inside its surface;
mismatched aspect ratios receive dark green padding. Same-origin asset URLs
are preferred. HTTPS images on another host require that host to allow CORS.
Use a new URL or version query when changing image bytes at an existing path.

Omit `venues` to cover all six courses. Allowed IDs are `royal`, `dubai`,
`alpine`, `coast`, `night` and `marathon`. Omit dates to run indefinitely.
Use ISO timestamps with an explicit timezone. Start is inclusive and end is
exclusive; display scheduling uses the player's device clock and is checked
once per second. When campaigns overlap in a slot, the first eligible entry
in the JSON wins. Disable/delete the demo campaign before assigning that slot
to a real sponsor, or put the sponsor before the demo.

Missing/invalid artwork falls back to neutral WORLD RACING branding without
interrupting the race. Malformed campaigns are ignored. Configuration outages
retain the last valid campaigns and their expiry dates. A newly opened page
with no configuration uses neutral boards. Pending requests and timers are
disposed when changing venue or leaving the game.

Management currently uses this configuration file. There is no stadium-ad
upload screen, click tracking, billing or paid impression reporting. Existing
admin notification banners are separate from these 3D advertising surfaces.

## Validation

The expanded v2 layout passes TypeScript and the production build. Seven browser
scenarios passed across the main run and one focused rerun, including camera
framing with all eight horses, camera persistence, artwork updates and mobile
rendering in all six venues. One initial test timed out while waiting for the
fixture's betting controls to become ready; it passed unchanged on the rerun.
Road paint uses polygon offset to avoid distant depth flicker, and tree placement
keeps the new entrance roads clear. The v2 release verifies the entry and all
37 release files against the staged checksums.

TypeScript and the production build pass. Six scenarios across the production
preview and deployed game cover the real default configuration, campaign
validation and schedule boundaries, image replacement without a rebuild,
disabled campaigns, corrupt artwork, missing configuration, desktop rendering
and all six venues on mobile. No monetary requests are submitted. SVG artwork
uses browser image decoding after a bitmap-decoding incompatibility was found
and fixed during development. Initial loading starts after the first WebGL
frame, with bounded 15-second network deadlines. Four advertising checks pass
against the deployed game. Failed images retry at most once per minute.
The localhost release verifies its entry and 37 file checksums, including the
existing horse/stadium assets and the new advertising files.
