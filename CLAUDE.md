# Madeira timetables – notes for developers and assistants

## Stops without coordinates

`npm run build:data` writes `data/missing-stops.json` (script `scripts/audit-stops.mjs`, also `npm run audit:stops`):
stops without any coordinates (`missing`) and stops whose position is only an estimate (`estimated`), with the lines that serve them.

**Whenever a developer or an assistant adds coordinates for a previously unknown stop (e.g. in `data/stop-overrides.json`), the stop must leave the `missing` list of `data/missing-stops.json`, and `npm run build:data` must be run.** The list is regenerated from the built data, so after the build the stop must no longer be in it; check that, and commit the updated `data/missing-stops.json` together with the override.
Hand-entered or estimated positions are labelled as such (`locationPrecision`), never presented as official.
