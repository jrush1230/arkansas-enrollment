// Shared constants and helpers for all views (statewide line, map, ranked
// list/table, drill-down). Keep view-specific rendering code out of this file.

// ---------------------------------------------------------------------------
// Era boundaries
// ---------------------------------------------------------------------------
// Mirrors classify_typology.py / 12_build_districts_json.py in the
// upstream pipeline (BASELINE_END_FALL_YEAR / COVID_FALL_YEARS /
// EFA_START_FALL_YEAR) -- do not change without changing them together.
export const BASELINE_END = 2019;      // last baseline fall year ("2019-20")
export const COVID_YEARS = [2020, 2021]; // "2020-21", "2021-22"
export const EFA_START = 2022;         // first EFA fall year ("2022-23")

export function eraOf(year) {
  if (year <= BASELINE_END) return "baseline";
  if (COVID_YEARS.includes(year)) return "covid";
  return "efa";
}

export function eraLabel(era) {
  return { baseline: "Baseline", covid: "COVID shock", efa: "EFA era" }[era];
}

export function schoolYearLabel(year) {
  const endYY = String((year + 1) % 100).padStart(2, "0");
  return `${year}-${endYY}`;
}

// A district's most recent series point ({ year, enrollment }) --
// client-side derived directly from district.series, same pattern
// efaYearOverYear() below already uses, no new districts.json field or
// rebuild required. Not map-specific despite being added for the map's
// district tooltip -- any future view wanting "current enrollment" can
// reuse this instead of re-deriving it. Confirmed directly against
// districts.json (2026-07-13): all 235 districts have a real 2025 series
// point, including all 7 boundary-change districts (2025-26 is well
// after every one of those mergers completed, so there's no
// current-boundary-vs-predecessor ambiguity left by that year -- the
// series' own current_boundary_since filtering already handles it
// upstream, nothing extra needed here). Returns null for a district with
// an empty series (defensive; no real district hits this today).
export function latestEnrollment(district) {
  const points = district.series
    .map((p) => ({ year: parseInt(p.year, 10), enrollment: p.enrollment }))
    .sort((a, b) => a.year - b.year);
  return points.length ? points[points.length - 1] : null;
}

// Display text for latestEnrollment() -- same wording/style
// charterPointEnrollmentText() below uses for charter points ("Enrollment:
// X (2025-26)"), for visual/tonal consistency between the map's two point
// types, even though the underlying data source differs (a district's own
// series here vs. a charter_points.json entry's precomputed fields there).
// Deliberately NO year-over-year clause, unlike the charter version --
// pct_change_efa_era already covers change for districts and is already
// shown separately in the same tooltip/aria-label, so repeating a change
// figure here would duplicate it. Shared by buildDistrictTooltip() and
// districtAriaLabel() (map.js and this file, respectively) so both surface
// identical wording rather than two independently-typed versions. Returns
// "" for a district with no series data at all (defensive; no real
// district hits this today) so callers can append it unconditionally.
export function districtEnrollmentText(district) {
  const latest = latestEnrollment(district);
  if (!latest) return "";
  return `Enrollment: ${latest.enrollment.toLocaleString("en-US")} (${schoolYearLabel(latest.year)}).`;
}

// Year-over-year EFA-era enrollment change, one entry per consecutive
// pair of EFA-era fall years found in a district's own series (2022->2023,
// 2023->2024, 2024->2025 as of this dataset) -- client-side computed
// directly from district.series, not a separate stored field. Confirmed
// directly against districts.json (2026-07-13): all 235 districts have
// exactly 4 EFA-era years / 3 consecutive pairs, zero exceptions. `pct`
// is still null (not 0 or skipped) for a pair this can't compute --
// kept defensive even though today's data never hits that branch, since
// a future data refresh isn't guaranteed to preserve the universal
// 4-year coverage. Returns [] for a district with fewer than 2 EFA-era
// points.
export function efaYearOverYear(district) {
  const efaPoints = district.series
    .map((p) => ({ year: parseInt(p.year, 10), enrollment: p.enrollment }))
    .filter((p) => p.year >= EFA_START)
    .sort((a, b) => a.year - b.year);

  const pairs = [];
  for (let i = 1; i < efaPoints.length; i++) {
    const prev = efaPoints[i - 1], curr = efaPoints[i];
    const pct = prev.enrollment > 0 ? (curr.enrollment - prev.enrollment) / prev.enrollment : null;
    pairs.push({ fromYear: prev.year, toYear: curr.year, pct });
  }
  return pairs;
}

// Cumulative simple percent change across the full EFA era, from an
// entity's own FIRST available EFA-era series point to its LATEST --
// deliberately ADAPTIVE, not a fixed 2022-23 anchor the way
// districts.json's own pct_change_efa_era field is (a stored value,
// uniform across all 235 districts, since EFA coverage there is
// universal -- confirmed elsewhere in this project). Built for
// charter-schools.js, whose entries don't share that universal coverage:
// 4 of 22 charters opened in 2024-25 have only 2 EFA-era years, so
// "first available" for THEM is 2024, not 2022 -- this function follows
// whatever each entity's own data actually starts at, rather than
// assuming 2022-23 the way a fixed-anchor field would (which would
// either be wrong or require awkward null-handling for those 4).
// Structurally the EFA-era counterpart to baselineEraChange() above (a
// simple first-vs-last percentage, not efaYearOverYear()'s adjacent-pair
// windowing), but without that function's district-specific
// current_boundary_since merger-boundary fallback logic, which has no
// charter equivalent -- charters don't merge the way districts do.
// Returns null for an entity with fewer than 2 EFA-era points
// (defensive; no real charter or district hits this today).
export function efaEraChange(entity) {
  const efaPoints = entity.series
    .map((p) => ({ year: parseInt(p.year, 10), enrollment: p.enrollment }))
    .filter((p) => p.year >= EFA_START)
    .sort((a, b) => a.year - b.year);
  if (efaPoints.length < 2) return null;
  const start = efaPoints[0].enrollment;
  const end = efaPoints[efaPoints.length - 1].enrollment;
  return start > 0 ? (end - start) / start : null;
}

// Simple total percentage change over the baseline era (first available
// baseline-year enrollment vs. last), the baseline-era counterpart to
// pct_change_efa_era -- which is also a simple (end-start)/start change,
// NOT baseline_cagr/efa_cagr's annualized rate (see
// 12_build_districts_json.py). Not a stored field in districts.json;
// derived client-side from district.series, same approach
// efaYearOverYear() above already uses for the EFA era.
//
// Windowing mirrors classify_typology_v3.py's cagr(baseline) exactly:
// filtered to series years >= current_boundary_since (dropping pre-merger
// context rows) AND <= BASELINE_END. That filter is a no-op for the 228
// districts whose current_boundary_since is already 2013 (the dataset's
// first year). For 6 of the 7 boundary-change exception districts
// (Nevada/Magnolia/Camden Fairview/Smackover Norphlet/Hackett/West
// Memphis), current_boundary_since falls within the baseline era
// (2014-2015), so this correctly excludes their pre-merger years,
// matching baseline_cagr's own windowing for these 6.
//
// Pine Bluff is a deliberate, asymmetric exception in the pipeline (see
// classify_typology_v3.py's docstring): its current_boundary_since is
// 2021, PAST the baseline era entirely, so filtering by
// current_boundary_since alone would leave zero baseline points even
// though Pine Bluff DOES have a real baseline_cagr -- computed from its
// full, unfiltered 2013-2019 pre-merger history, because Pine Bluff has
// ZERO boundary-consistent baseline years without those rows, unlike the
// other 6, which already have sufficient boundary-consistent baseline
// data on their own. Rather than hardcoding Pine Bluff's leaid, this
// falls back to the district's FULL series (ignoring
// current_boundary_since) whenever the boundary-respecting filter leaves
// fewer than 2 baseline points to compute a change from -- the same
// "zero vs. sufficient" condition that actually distinguishes Pine Bluff
// from the other 6 in the pipeline, expressed generically instead of as
// a special-cased ID list. Verified against districts.json (2026-07-13):
// this fallback triggers for Pine Bluff alone among all 235 districts,
// and reproduces baseline_cagr's own implied start/end years exactly for
// all 7 boundary-change districts (hand-checked against raw series
// values, not just plausible-looking).
export function baselineEraChange(district) {
  const points = district.series
    .map((p) => ({ year: parseInt(p.year, 10), enrollment: p.enrollment }))
    .sort((a, b) => a.year - b.year);

  const boundaryRespecting = points.filter(
    (p) => p.year >= district.current_boundary_since && p.year <= BASELINE_END
  );
  const baselinePoints = boundaryRespecting.length >= 2
    ? boundaryRespecting
    : points.filter((p) => p.year <= BASELINE_END);

  if (baselinePoints.length < 2) return null;
  const start = baselinePoints[0].enrollment;
  const end = baselinePoints[baselinePoints.length - 1].enrollment;
  return start > 0 ? (end - start) / start : null;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
// Resolved relative to this module file (not the page that imports it), so
// every view can import loadDistricts() regardless of its own path.
const DISTRICTS_URL = new URL("./data/districts.json", import.meta.url);
const FULL_STATEWIDE_TOTAL_URL = new URL("./data/full_statewide_total_by_year.json", import.meta.url);
const CHARTER_POINTS_URL = new URL("./data/charter_points.json", import.meta.url);

let _districtsCache = null;
export async function loadDistricts() {
  if (_districtsCache) return _districtsCache;
  const res = await fetch(DISTRICTS_URL);
  if (!res.ok) throw new Error(`Failed to load districts.json: ${res.status}`);
  _districtsCache = await res.json();
  return _districtsCache;
}

// Per-year statewide totals re-derived directly from the raw SIS file
// (scripts/build_full_statewide_totals.py), NOT from districts.json's
// series data -- districts.json deliberately excludes pre-merger SIS rows
// for the 7 crosswalk-exception districts (correct for the constant-panel
// view), which would undercount a series meant to match ADE's published
// statewide totals. Each entry: { year, full_235_equivalent (235
// current-boundary districts, predecessor districts' rows included for
// pre-merger years), full_all_entities (all SIS entities: regular
// districts + charters + DYS + ASDB), n_matched, ade_confirmed }.
let _fullStatewideTotalCache = null;
export async function loadFullStatewideTotals() {
  if (_fullStatewideTotalCache) return _fullStatewideTotalCache;
  const res = await fetch(FULL_STATEWIDE_TOTAL_URL);
  if (!res.ok) throw new Error(`Failed to load full_statewide_total_by_year.json: ${res.status}`);
  _fullStatewideTotalCache = await res.json();
  return _fullStatewideTotalCache;
}

// Charter schools with no district-boundary polygon -- see the map
// point-marker section below for why. All 23 SIS charter LEAs are here:
// 19 from NCES EDGE's Public School Locations file, 4 (Garfield Scholars',
// Academies of Math and Science, Institute for the Creative Arts, School
// for Advanced Studies-NW Ark -- all opened 2024-25) address-geocoded
// instead, since that file's SY2022-23 vintage predates them. Each entry:
// { id, name, lat, lon, source, note }.
//
// STANDING RULE, load-bearing enough to restate here since charter_points.json
// itself is plain JSON and can't hold a comment: join NCES EDGE records to a
// charter LEA via data/processed/external/crosswalk_lea_nces.csv's LEAID
// (state_leaid -> leaid), never by matching on the charter/authorizer name.
// NCES's school-level NAME field routinely has nothing in common with the
// authorizer name (e.g. "Academics Plus" -> schools named "Maumelle Charter
// ___"; "Graduate Arkansas Charter" -> "SIATECH High Charter"; "Scholarmade"
// -> "Ivy Hill Academy of Scholarship") and in one case carries an outright
// typo ("FURTURE School of Fort Smith"). A name search across all 23 charters
// found only 16 correctly and produced one false positive (an unrelated
// "Garfield Elementary School" in a different district); rejoining the same
// 23 via LEAID found all 19 that actually exist in NCES's file. Every
// NCES-sourced entry's own `note` repeats this pointer inline as well.
//
// Additive: adding more entries (or a future year's newly-opened charters)
// is the only change needed to put them on the map -- the loader,
// CHARTER_POINT_STYLE, and charterPointAriaLabel() below are all generic
// over the list, none of it entry-specific.
let _charterPointsCache = null;
export async function loadCharterPoints() {
  if (_charterPointsCache) return _charterPointsCache;
  const res = await fetch(CHARTER_POINTS_URL);
  if (!res.ok) throw new Error(`Failed to load charter_points.json: ${res.status}`);
  _charterPointsCache = await res.json();
  return _charterPointsCache;
}

// ---------------------------------------------------------------------------
// Panel-composition coverage (the "235 districts isn't a constant panel
// before 2020-21" problem -- 7 districts' current boundaries postdate 2013,
// see METHODOLOGY.md). One function per question, shared by every view that
// needs to flag incomplete coverage rather than each deciding independently.
// ---------------------------------------------------------------------------

// Statewide: how many of the 235 districts have a data point in `year`.
export function yearCoverage(districts, year) {
  const total = districts.length;
  const n = districts.reduce(
    (count, d) => count + (d.series.some((pt) => parseInt(pt.year, 10) === year) ? 1 : 0),
    0
  );
  return { year, n, total, isComplete: n === total };
}

// Statewide, all years present in the dataset -- used for chart footnotes.
export function allYearsCoverage(districts) {
  const years = new Set();
  for (const d of districts) {
    for (const pt of d.series) years.add(parseInt(pt.year, 10));
  }
  return [...years].sort((a, b) => a - b).map((y) => yearCoverage(districts, y));
}

// Per-district: does this one district have a data point in `year`.
export function districtHasYear(district, year) {
  return district.series.some((pt) => parseInt(pt.year, 10) === year);
}

// Per-district: does this district's history start after the dataset's
// first year (2013), i.e. is it one of the current-boundary exceptions or
// Jacksonville North Pulaski's later-creation case? Map/drill-down use this
// to flag a district consistently rather than re-deriving it from
// current_boundary_since + baseline_years_thin independently.
export function hasShortHistory(district) {
  const firstYear = Math.min(...district.series.map((pt) => parseInt(pt.year, 10)));
  return firstYear > 2013 || district.data_status !== "ok";
}

// ---------------------------------------------------------------------------
// Typology categories, labels, and color scale
// ---------------------------------------------------------------------------
// The 10 categories are a 3x3 (baseline_state x efa_state) matrix -- growing
// / flat / declining in each era -- with the "declining both eras" cell split
// into sustained_decline / accelerating_decline by whether EFA-era decline is
// steeper. See the upstream classify_typology.py's STATE_MATRIX
// for the authoritative mapping.
//
// Color is a diverging blue (growth) <-> gray (stable) <-> red (decline)
// ramp, ordered within each arm by how "new" vs "sustained" the signal is
// (mildest tint = the category whose current era just went flat; boldest =
// growth/decline sustained across both eras or, on the red arm, accelerating
// decline as the one category with no blue-side analog). This lets a single
// legend read as one continuous strongest-growth -> stable -> worst-decline
// scale instead of 10 unrelated hues.
//
// Blue-arm light steps are pulled directly from the design system's
// documented blue sequential ramp (see dataviz skill references/palette.md).
// No equivalent red or dark-mode ramp is documented there, so those steps
// are hand-mixed (surface/base-hue interpolation) following the same
// light->dark(light mode) / dark->bright(dark mode) method, with the
// mildest step in each ramp checked against the palette's own ordinal
// light-end contrast floor (~2:1).
//
// Every adjacent pair (plus the explicit matrix-sibling pairs, e.g.
// accelerating_decline/sustained_decline and growth_stalled/emerging_growth)
// was checked for CVD separation using the Machado-2009 protan/deutan
// simulation from the dataviz skill's validate_palette.js (ported to Python
// since node isn't available here -- same math, same >=12 target / >=8
// floor). One pair remains in the 8-12 floor band in dark mode
// (emerging_decline vs decline_stabilized, worst=10.0) -- legal per the
// skill's own rule only with secondary encoding, which every view here
// provides (typologyLabel() text alongside every swatch). Everything else
// clears the 12.0 target. `stable` uses the app's existing muted-ink token
// (#898781, identical in both modes) rather than a bespoke gray -- a
// lighter gray was tried first and sat too close to insufficient_history's
// swatch under simulation (deltaE ~11 light / ~5.5 dark, i.e. failing);
// #898781 clears both by >=32.
export const TYPOLOGY_ORDER = [
  "growth_throughout",
  "reversal_upward",
  "emerging_growth",
  "growth_stalled",
  "stable",
  "decline_stabilized",
  "emerging_decline",
  "reversal_downward",
  "sustained_decline",
  "accelerating_decline",
];

export const TYPOLOGY_LABELS = {
  growth_throughout: "Growth throughout",
  reversal_upward: "Upward reversal",
  emerging_growth: "Emerging growth",
  growth_stalled: "Growth stalled",
  stable: "Stable",
  decline_stabilized: "Decline stabilized",
  emerging_decline: "Emerging decline",
  reversal_downward: "Downward reversal",
  sustained_decline: "Sustained decline",
  accelerating_decline: "Accelerating decline",
};

// insufficient_history / null typology (currently just Pine Bluff) is not
// part of the diverging scale -- it means "no classification," not "stable."
export const NO_DATA_LABEL = "Insufficient history";

export const TYPOLOGY_COLORS = {
  growth_throughout:    { light: "#184f95", dark: "#70a9ef" },
  reversal_upward:      { light: "#2a78d6", dark: "#3987e5" },
  emerging_growth:      { light: "#5598e7", dark: "#3066a8" },
  growth_stalled:       { light: "#86b6ef", dark: "#294e7b" },
  stable:                { light: "#898781", dark: "#898781" },
  decline_stabilized:   { light: "#ee9a99", dark: "#804040" },
  emerging_decline:     { light: "#e8706f", dark: "#ad5151" },
  reversal_downward:    { light: "#e34948", dark: "#e66767" },
  sustained_decline:    { light: "#a63131", dark: "#ef8c8c" },
  accelerating_decline: { light: "#5c1414", dark: "#fab6b6" },
  insufficient_history: { light: "#e1e0d9", dark: "#2c2c2a" },
};

export function typologyLabel(typology) {
  return typology ? TYPOLOGY_LABELS[typology] : NO_DATA_LABEL;
}

export function typologyColor(typology, mode = "light") {
  const key = typology || "insufficient_history";
  return TYPOLOGY_COLORS[key][mode];
}

// ---------------------------------------------------------------------------
// Trajectory sparkline (2013-2025 enrollment line)
// ---------------------------------------------------------------------------
// Originally built for the data table's Trajectory column, moved here
// verbatim (not reimplemented) once the ranked list needed the same
// visual -- both views import sparklineSvg() from here rather than each
// keeping its own copy, so there's exactly one place that knows what the
// line looks like, what window it covers, and how it handles the 7
// boundary-change districts.
//
// svgEl()/SVG_NS here are a local copy, not exported -- every view file
// that builds raw SVG (map.js, drill-down.js, statewide-line.js,
// school-districts.js) already keeps its own tiny copy of this exact helper
// rather than importing one; this follows that existing convention
// rather than being the one file that breaks it.
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

const SPARK_W = 72, SPARK_H = 20;
const SPARK_YEAR_MIN = 2013, SPARK_YEAR_MAX = 2025;

function sparklinePoints(district) {
  return district.series
    .map((p) => ({ year: parseInt(p.year, 10), enrollment: p.enrollment }))
    .filter((p) => p.year >= SPARK_YEAR_MIN && p.year <= SPARK_YEAR_MAX)
    .sort((a, b) => a.year - b.year);
}

// Boundary-change handling -- checked empirically before deciding, not
// picked blind: drill-down's full convention (dashed pre-merger segment +
// solid post-merger + vertical seam line + text label) was tried first.
// The text label and vertical seam line don't fit at all at 72x20px and
// were dropped immediately. The dashed segment alone was tested against
// real per-district year spans -- most of the 7 boundary-change districts
// have only 1-2 pre-merger years in view (Nevada/Magnolia/Camden
// Fairview/Smackover Norphlet: 2013->2014; Hackett/West Memphis:
// 2013->2015), so that segment is only ~5-9px wide at this scale, too
// short for a dash pattern to read as anything but a slightly fuzzy solid
// line. Pine Bluff (2013->2021, most of the width) was the one case
// where dashing read as intentional. Landed on: the sparkline starts at
// current_boundary_since for all 7 (pre-merger years omitted from the
// drawn line, not just de-emphasized), with the omission stated in the
// accessible label instead of attempted visually -- consistent, not a
// per-district judgment call at render time. See sparklineBoundaryNote()
// below for that accessible-label sentence, shared the same way this
// function is.
// `strokeColor`, if given, overrides the typologyColor()-derived stroke --
// added for charter-schools.js, whose rows have no `typology` field at all
// (charters aren't classified the way districts are; see that file's own
// notes on why). Optional and defaulted to preserve every existing
// caller's exact behavior (district-rankings.js, school-districts.js pass only
// district/mode, unchanged) -- a resolved hex string, not a {light,dark}
// pair, so this function still doesn't need to know which mode produced
// it. `district` itself is really "anything with a `.series` array" --
// charter-schools.js passes a charter_points.json entry, which has
// `.series` (added when per-charter enrollment was built) but no
// `.boundary_change_within_series`/`.current_boundary_since`/`.typology`;
// all three are simply undefined/falsy for a charter, which correctly
// skips the boundary-change filtering branch (charters have no such
// concept) and, combined with an explicit strokeColor, never touches
// typologyColor() at all for a charter row.
// `opts.eraBands` -- CANDIDATE (Part B, appearance-improvement round, not
// yet used by any committed caller): draws the same COVID/EFA background
// bands (var(--band-covid)/var(--band-efa), the real statewide/drill-down
// charts' own tokens; baseline stays unshaded, matching those charts) BEHIND
// the line, using this same x() mapping so the bands land on the exact
// years they cover. Opt-in and defaulted to false so every existing caller
// (district-rankings.js, school-districts.js, charter-schools.js,
// index.js's own trajectory/data-table previews) is byte-for-byte
// unaffected -- only index.js's Statewide Trend preview candidate passes
// this true. classed "spark-band-covid"/"spark-band-efa" (index.html
// defines the fill), not inline styles, same convention every other mark in
// this function already follows.
export function sparklineSvg(district, mode, strokeColor, opts = {}) {
  const allPoints = sparklinePoints(district);
  const points = district.boundary_change_within_series
    ? allPoints.filter((p) => p.year >= district.current_boundary_since)
    : allPoints;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, width: SPARK_W, height: SPARK_H, class: "spark-svg",
  });
  if (points.length < 2) return svg; // defensive -- no real district hits this today; a 2-year charter does NOT (2 points still draws a real line)

  const values = points.map((p) => p.enrollment);
  const yMin = Math.min(...values), yMax = Math.max(...values);
  const pad = 2;
  const xStart = points[0].year, xEnd = points[points.length - 1].year;
  const x = (year) => ((year - xStart) / (xEnd - xStart || 1)) * SPARK_W;
  const y = (val) => yMax === yMin
    ? SPARK_H / 2
    : pad + (SPARK_H - pad * 2) * (1 - (val - yMin) / (yMax - yMin));

  if (opts.eraBands) {
    const halfStep = (x(xStart + 1) - x(xStart)) / 2;
    const bands = [
      { from: COVID_YEARS[0], to: COVID_YEARS[COVID_YEARS.length - 1], cls: "spark-band-covid" },
      { from: EFA_START, to: xEnd, cls: "spark-band-efa" },
    ];
    for (const b of bands) {
      if (b.from > b.to) continue;
      const x0 = Math.max(0, x(b.from) - halfStep);
      const x1 = Math.min(SPARK_W, x(b.to) + halfStep);
      svg.appendChild(svgEl("rect", {
        x: x0.toFixed(1), y: "0", width: (x1 - x0).toFixed(1), height: SPARK_H, class: b.cls,
      }));
    }
  }

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year).toFixed(1)} ${y(p.enrollment).toFixed(1)}`).join(" ");
  svg.appendChild(svgEl("path", {
    class: "spark-line", d: pathD, stroke: strokeColor ?? typologyColor(district.typology, mode),
  }));
  return svg;
}

// Accessible-label sentence for the sparkline's boundary-change omission
// -- a boundary-change district's sparkline starts at current_boundary_since,
// not 2013 like every other district's, so a screen reader user reading a
// label built around this sparkline needs to be told that explicitly
// rather than assuming full 2013-2025 coverage. Shared (not hand-typed
// separately in the data table's cell label and the ranked list's row
// tooltip) so both views describe the exact same visual the exact same
// way. Returns "" for a district with no boundary change, so callers can
// append it unconditionally.
export function sparklineBoundaryNote(district) {
  return district.boundary_change_within_series
    ? ` Sparkline starts at the district's current boundary (${district.current_boundary_since}); years before that aren't shown.`
    : "";
}

// ---------------------------------------------------------------------------
// Caveat mark icons (thin baseline / boundary changed / reversal magnitude)
// ---------------------------------------------------------------------------
// Originally built for the data table's Notes column, moved here verbatim
// (not reimplemented) once the ranked list needed the same icons -- same
// reason the sparkline moved here above. Both views import these three
// icon builders plus makeCaveatsMark() rather than each keeping its own
// copy.
//
// Thin baseline and Boundary changed used to both render as the exact
// same plain filled CSS dot -- a real duplication, distinguishable only
// by hover text. Reversal magnitude used to be a bordered S/M/L letter
// badge. All three are now real vector glyphs, sharing one visual family
// (14x14 viewBox, svgEl()-built like the sparkline above, colored via
// currentColor so they track var(--text-primary) automatically in both
// themes) but with maximally distinct SILHOUETTES so no two can be
// mistaken for each other: a broken/dashed line (linear), a filled
// diamond (4-sided polygon), and a double-headed arrow (a stroked path,
// scaled by length). A single filled triangle was tried first for
// Reversal and rejected because (a) it falsely implied one-directional
// "growth" when a reversal is, definitionally, non-directional, and (b)
// the three magnitudes only differed by triangle AREA, too subtle a
// visual variable at 14px. The double-headed arrow fixes both: symmetric
// chevrons at both ends read as "moved both ways," and magnitude is
// encoded by shaft LENGTH -- one of the most reliably perceived visual
// variables (Cleveland & McGill), and a far more legible S/M/L
// distinction than area ever was.
const MARK_ICON_SIZE = 14;

export function thinBaselineIcon() {
  const svg = svgEl("svg", { viewBox: "0 0 14 14", width: MARK_ICON_SIZE, height: MARK_ICON_SIZE, class: "mark-icon" });
  const g = svgEl("g", { fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round" });
  g.appendChild(svgEl("line", { x1: "1.5", y1: "7", x2: "5", y2: "7" }));
  g.appendChild(svgEl("line", { x1: "9", y1: "7", x2: "12.5", y2: "7" }));
  svg.appendChild(g);
  return svg;
}

export function boundaryChangedIcon() {
  const svg = svgEl("svg", { viewBox: "0 0 14 14", width: MARK_ICON_SIZE, height: MARK_ICON_SIZE, class: "mark-icon" });
  svg.appendChild(svgEl("polygon", { points: "7,2 12,7 7,12 2,7", fill: "currentColor" }));
  return svg;
}

// Exact coordinates per magnitude (not a formula) -- these were built and
// reviewed as a live side-by-side mockup before being wired in, so
// they're reproduced verbatim rather than re-derived, to guarantee the
// shipped icon matches what was actually approved.
const REVERSAL_GEOMETRY = {
  small: { top: "5.5", bottom: "8.5", topChevron: "5.3,6.8 7,5.5 8.7,6.8", bottomChevron: "5.3,7.2 7,8.5 8.7,7.2" },
  moderate: { top: "4", bottom: "10", topChevron: "5.3,5.3 7,4 8.7,5.3", bottomChevron: "5.3,8.7 7,10 8.7,8.7" },
  large: { top: "2.2", bottom: "11.8", topChevron: "5,3.7 7,2.2 9,3.7", bottomChevron: "5,10.3 7,11.8 9,10.3" },
};
export function reversalIcon(magnitude) {
  const geo = REVERSAL_GEOMETRY[magnitude] ?? REVERSAL_GEOMETRY.moderate;
  const svg = svgEl("svg", { viewBox: "0 0 14 14", width: MARK_ICON_SIZE, height: MARK_ICON_SIZE, class: "mark-icon" });
  const g = svgEl("g", {
    fill: "none", stroke: "currentColor", "stroke-width": "2.2",
    "stroke-linecap": "round", "stroke-linejoin": "round",
  });
  g.appendChild(svgEl("line", { x1: "7", y1: geo.top, x2: "7", y2: geo.bottom }));
  g.appendChild(svgEl("polyline", { points: geo.topChevron }));
  g.appendChild(svgEl("polyline", { points: geo.bottomChevron }));
  svg.appendChild(g);
  return svg;
}

// Multi-campus mark -- originally built LOCAL to charter-schools.js (that
// file's own comment explained the design: three filled, slightly-rounded
// squares in an asymmetric triangular cluster, deliberately not
// collinear/single-shape/chevroned so it can't be mistaken for
// thinBaselineIcon()/boundaryChangedIcon()/reversalIcon() above). Promoted
// here now that the Charter Schools preview candidate (index.js) is a
// SECOND view needing the exact same glyph -- this project's own
// established rule for exactly when a locally-built mark gets promoted
// (see this file's own comment on how the other three icons got here).
// charter-schools.js now imports this instead of keeping its own copy.
export function multiCampusIcon() {
  const svg = svgEl("svg", { viewBox: "0 0 14 14", width: MARK_ICON_SIZE, height: MARK_ICON_SIZE, class: "mark-icon" });
  const g = svgEl("g", { fill: "currentColor" });
  g.appendChild(svgEl("rect", { x: "1", y: "1.5", width: "3.8", height: "3.8", rx: "0.6" }));
  g.appendChild(svgEl("rect", { x: "8.5", y: "0.8", width: "3.2", height: "3.2", rx: "0.6" }));
  g.appendChild(svgEl("rect", { x: "5.5", y: "6.5", width: "5", height: "5", rx: "0.6" }));
  svg.appendChild(g);
  return svg;
}

// Each mark is wrapped in a "hit" span that carries the title/aria-hidden
// (not the icon svg itself) -- fixing a real bug where per-mark tooltips
// were correctly coded (title on the right element, no
// pointer-events/aria-hidden interference, elementFromPoint resolved
// exactly to the mark) but PRACTICALLY unreachable: the visual marks are
// only 8-14px, so a real mouse aiming "at" one very often lands a pixel
// or two off, and without this wrapper that near-miss falls through to
// whatever ancestor title exists (a cell's or row's combined label)
// instead of the mark's own. The hit span's own horizontal padding
// (`.mark-hit` CSS, defined per-view since each view's icon spacing
// differs slightly) expands each mark's actual hoverable footprint to
// meet its neighbor's, so the gap between any two marks is split between
// their two tooltips with no untitled no-man's-land in between. Marks
// stay out of the accessible tree either way (aria-hidden on the wrapper
// cascades to its child); each view's own cell-level/row-level combined
// label remains the sole accessible-tree content for screen readers.
export function makeCaveatsMark(iconSvg, title) {
  const hit = document.createElement("span");
  hit.className = "mark-hit";
  hit.title = title;
  hit.setAttribute("aria-hidden", "true");
  hit.appendChild(iconSvg);
  return hit;
}

// ---------------------------------------------------------------------------
// Continuous diverging fill: pct_change_efa_era -> color
// ---------------------------------------------------------------------------
// Shared by the map (polygon fill) and the ranked list (row swatch dot) --
// both now encode the same channel (magnitude of EFA-era change) the same
// way, rather than the map's continuous scale and the list's dot drifting
// out of sync as two independent implementations. Drill-down and the
// ranked list's category chips/table typology column keep typologyColor()'s
// 10-step categorical treatment (shape of the trajectory) unchanged -- this
// is a second, different color channel that these two views use instead.
//
// PCT_CLIP = 0.15 (+-15%), chosen from the real distribution (computed
// 2026-07-12 across all 235 districts): min -38.2%, p10 -13.0%, median
// -5.0%, p90 +3.9%, p95 +6.8%, max +15.8%. The distribution is skewed
// negative (Arkansas-wide decline), so a *symmetric* clip necessarily
// saturates asymmetrically: at +-15%, only 1 district saturates high
// (Poyen, +15.8%, barely over) while 18 saturate low (7.7% of 235) --
// the genuine long decline tail, not an arbitrary cutoff. Checked +-12
// through +-25 before settling here; +-15 was the cleanest round number
// that keeps saturation to a small, clearly-outlier minority on both
// ends while still giving the bulk of the distribution (roughly p2
// through p98) a meaningfully distinguishable position on the ramp.
//
// Anchors: green (growth) / yellow (near zero) / red (decline). None of
// these existed in TYPOLOGY_COLORS (blue/gray/red only) or survived
// reuse from the design system's own categorical green+yellow slots
// (references/palette.md: green #008300 both modes, yellow #eda100/
// #c98500) -- checked first, per this project's "reuse before inventing"
// convention, but that pairing failed CVD badly once actually measured
// (see below), so these are hand-derived instead, following the same
// light->dark(light mode) / dark->bright(dark mode) mixing method
// documented for TYPOLOGY_COLORS' own accelerating_decline red.
//
// Red reuses TYPOLOGY_COLORS.accelerating_decline verbatim (still a
// vetted, unmodified token) -- only green and yellow are new.
export const PCT_CLIP = 0.15;

// Red-green diverging scales are a known-hard case for red-green color
// vision deficiency -- confirmed here, not assumed: the design system's
// literal green+yellow categorical tokens (#008300/#eda100 light,
// #008300/#c98500 dark) scored delta-E as low as 1.5 (dark mode protan,
// +10% vs the saturated +15% endpoint) on the same validate_palette.py
// --pairs all check the blue-red version used, WELL below the 8.0 floor
// -- a real, not marginal, failure. A PCT_GAMMA-style power curve
// (the blue-red version's dark-mode fix) made it WORSE at several
// settings, not better -- the problem here is hue collision, not
// saturation pacing, so a different fix was needed: shifting green's
// hue toward teal (away from the pure-green wavelengths a red-green
// deficiency confuses most) while keeping it unambiguously "green," not
// just tuning lightness/gamma on the original hue. Swept a dozen green
// candidates x seven gamma values per mode before landing here -- power
// curve genuinely not needed once the hue itself moved (both modes best
// at power=1.0, i.e. plain linear lerp).
//
// Final result, all 7 sample points (-20% through +16%, clip boundary
// included) x both CVD types, worst non-trivial pair (duplicate-color
// clamped pairs excluded, since e.g. -20% and -15% are the same pixel
// by design and comparing a color to itself isn't a real check):
//   light: worst protan 21.2, worst deutan 15.7 -- clears the 12.0
//     target outright on both.
//   dark:  worst protan 16.8, worst deutan 18.0 -- also clears 12.0
//     outright on both -- stronger than the blue-red version's dark
//     mode, which only reached the 8-12 floor band.
export const GRADIENT_ANCHORS = {
  light: { green: "#0f8a52", yellow: "#eda100", red: TYPOLOGY_COLORS.accelerating_decline.light },
  dark:  { green: "#159060", yellow: "#c98500", red: TYPOLOGY_COLORS.accelerating_decline.dark },
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex(a.map((c, i) => c + (b[i] - c) * t));
}

// t in [-1, 1]: sign gives the arm (decline/growth), |t| the fraction of
// the way to full saturation along that arm. No gamma curve -- see the
// anchor comment above, plain linear lerp already clears the CVD target.
export function pctChangeColor(pct, mode = "light") {
  const t = Math.max(-1, Math.min(1, (pct ?? 0) / PCT_CLIP));
  const { green, yellow, red } = GRADIENT_ANCHORS[mode];
  if (t >= 0) return lerpColor(yellow, green, t);
  return lerpColor(yellow, red, -t);
}

// ---------------------------------------------------------------------------
// Map polygon stroke
// ---------------------------------------------------------------------------
// Every district polygon gets a visible stroke, regardless of fill -- not a
// special case for insufficient_history's low-contrast swatch, but general
// good practice for small/irregularly-shaped districts sharing borders with
// similarly-colored neighbors (two adjacent "stable" or two adjacent
// "decline_stabilized" districts need a visible seam between them even
// though their fills don't contrast with each other at all). Translucent
// ink over the fill rather than a flat hex, so one stroke definition works
// across the whole diverging range instead of picking a color that only
// contrasts with some fills: checked at alpha 0.45 against the ramp's
// extremes -- lands at ~1.6-2.7:1 edge-vs-fill contrast for the pale/mid
// fills (where two similar neighbors are most likely) and ~1.2-1.3:1 for
// the most saturated fills (accelerating_decline, growth_throughout),
// which is the weakest case numerically but the lowest-risk one in
// practice: those fills already contrast strongly against nearly every
// other color in the palette, so the polygon boundary reads from the fill
// discontinuity itself even where the stroke alone is faint.
export const MAP_STROKE = {
  width: 1,
  opacity: 0.45,
  color: { light: "#0b0b0b", dark: "#ffffff" }, // --text-primary ink, not a new token
  dasharray: null,
};

// insufficient_history (currently just Pine Bluff) is not a weaker color on
// the same scale -- it means "no classification available," a different
// kind of thing entirely. Giving it only the universal stroke would read as
// "same category, fainter," which is the wrong message. Dashed stroke is
// the standard cartographic "no data" convention and doesn't require
// picking a new identity color (which would need its own CVD pass). Heavier
// width/opacity than the universal stroke since a dashed line at hairline
// weight tends to disappear at small map scale.
export const NO_DATA_STROKE = {
  width: 1.5,
  opacity: 0.6,
  color: { light: "#0b0b0b", dark: "#ffffff" },
  dasharray: "4 2",
};

// Single lookup so the map (and any future view drawing typology polygons)
// reads the stroke decision from here instead of special-casing null
// typology itself.
export function mapStrokeFor(typology) {
  return typology ? MAP_STROKE : NO_DATA_STROKE;
}

// ---------------------------------------------------------------------------
// Charter point markers (districts with no boundary polygon)
// ---------------------------------------------------------------------------
// A handful of charter LEAs (Imboden today, more later -- see
// loadCharterPoints() above) have real SIS enrollment but no district
// boundary in NCES's EDGE file, so they can't be drawn as typology-colored
// polygons at all. Rendered instead as a plain circle marker at the
// school's lat/lon.
//
// Deliberately NOT a color from TYPOLOGY_COLORS: charters have no
// baseline/EFA-era classification (districts.json's typology field doesn't
// exist for them), so tinting a charter marker blue or red would visually
// claim a growth/decline classification that was never computed. Reuses
// the app's existing charter identity color instead (--series-charter in
// statewide.html / statewide-line.js's charter enrollment line) -- a neutral
// choice with respect to the typology ramp (orange sits outside the
// blue-gray-red diverging scale entirely) that also means a user who
// learns "orange = charter" from the statewide chart carries that reading
// straight onto the map.
export const CHARTER_POINT_COLOR = { light: "#eb6834", dark: "#d95926" }; // --series-charter, not a new token

// Halo stroke in the page background color (mirrors end-dot/hover-dot's
// `stroke: var(--surface-1)` in statewide-line.js) so the marker reads as
// a distinct point against whatever typology fill color it happens to sit
// on, rather than blending into a similarly-colored polygon underneath.
export const CHARTER_POINT_STYLE = {
  radius: 5,
  color: CHARTER_POINT_COLOR,
  strokeColor: { light: "#fcfcfb", dark: "#1a1a19" }, // --surface-1
  strokeWidth: 2,
};

// Not "no data" -- the district-boundary map's NO_DATA_STROKE/label means
// "insufficient history to classify," which doesn't apply here: a charter
// point has real, current enrollment (districts.json id 0500061 for
// Imboden), just no polygon to draw it on. The tooltip/label says so
// explicitly instead of reusing insufficient_history's language.
// point.map_caveat is short, user-facing text (multi-campus network /
// geocoding-precision disclosures) -- distinct from point.note, which is
// internal data-provenance detail (join methodology, source audit trail)
// that must never reach this label or any visual tooltip built on it.
// Appended, not substituted, so it reaches keyboard/screen-reader users
// the same way it'd reach a sighted tooltip reader, not as a visual-only
// addition.
// Shared by charterPointAriaLabel() (below) and map.js's own visual
// tooltip -- one wording for both the hover and keyboard/screen-reader
// paths, same reason sparklineBoundaryNote() above is centralized here
// rather than hand-typed per caller. A simple year-over-year percent
// change, not an annualized CAGR -- consistent with pct_change_efa_era's
// own treatment elsewhere in this project (the map's district fill, the
// ranked list's row swatch), chosen for exactly the same "meant to be
// read at a glance" reason. See build_charter_points_enrollment.py for
// where series/latest_enrollment/latest_year/pct_change_yoy come from --
// reuses that script's own SIS-row charter classification, not a fresh
// enrollment source. Returns "" for a point with no enrollment data at
// all (defensive; no real entry hits this today -- confirmed all 23
// charter points have at least 2 years of data) so callers can append it
// unconditionally. A point with exactly one year of data (a brand-new
// charter -- possible in a future data refresh even though none exists
// today) gets an enrollment figure with no percent-change clause, rather
// than a misleading "0% change" or a crash on a nonexistent prior year.
export function charterPointEnrollmentText(point) {
  if (point.latest_enrollment == null) return "";
  const enrollment = point.latest_enrollment.toLocaleString("en-US");
  const yearLabel = schoolYearLabel(point.latest_year);
  if (point.pct_change_yoy == null) {
    return `Enrollment: ${enrollment} (${yearLabel}, first year of data).`;
  }
  return `Enrollment: ${enrollment} (${yearLabel}), ${formatSignedPct(point.pct_change_yoy)}% from the prior year.`;
}

export function charterPointAriaLabel(point) {
  const base = `${point.name}: charter school, no district boundary available, shown at its school location.`;
  const enrollmentText = charterPointEnrollmentText(point);
  return [base, enrollmentText, point.map_caveat].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Accessible label for a district mark (map polygon, list row, etc.)
// ---------------------------------------------------------------------------
// One district-color pair sits in the CVD floor band rather than clearing
// the 12.0 target (emerging_decline vs decline_stabilized, dark mode --
// see the color-scale review). That's only acceptable because color is
// never the only channel: every mark carrying a typology color must also
// expose this text, reachable via keyboard focus (tabindex=0 + aria-label),
// not just mouse hover -- same pattern as the statewide line's focusable
// data points in statewide-line.js. A view that renders typology-colored
// marks without wiring this up has not met that condition.
// ---------------------------------------------------------------------------
// Plain-language shape sentence
// ---------------------------------------------------------------------------
// One clause per typology describing SHAPE only (grew/declined/reversed/
// leveled off, and when) -- never cause -- same convention as every other
// view's language (typology labels, footnotes, tooltips). Originally
// drill-down-only; now the primary shape description everywhere a mark's
// typology would otherwise appear as a raw category name (ranked list and
// map tooltips/aria-labels, plus drill-down's own summary paragraph) -- a
// reader shouldn't need to already know what "growth_stalled" means to
// understand what happened. The raw category name/color still appears in
// the identity swatch+label, category chips, and the "view as table"
// typology column, where precise technical terminology is the point.
const SHAPE_SENTENCES = {
  growth_throughout: "grew throughout both eras — steady growth in the baseline years continued into the EFA era",
  reversal_upward: "declined through the baseline era, then reversed course and began growing in the EFA era",
  emerging_growth: "held roughly steady through the baseline era, then began growing in the EFA era",
  growth_stalled: "grew through the baseline era, then leveled off in the EFA era",
  stable: "held roughly steady across both the baseline and EFA eras",
  decline_stabilized: "declined through the baseline era, then leveled off in the EFA era",
  emerging_decline: "held roughly steady through the baseline era, then began declining in the EFA era",
  reversal_downward: "grew through the baseline era, then reversed course and began declining in the EFA era",
  sustained_decline: "declined through the baseline era, and continued declining at a similar pace in the EFA era",
  accelerating_decline: "declined through the baseline era, and declined even faster in the EFA era",
};

// Composable clause -- lowercase, no name, no trailing period. For callers
// that put it after a subject/colon that already supplies the name
// (drill-down's own "<name> <clause>." sentence below, districtAriaLabel's
// "<name>: <clause>..." further down) so it continues naturally. Callers
// with no such lead-in should use districtShapeSentence() instead of
// capitalizing this by hand.
export function districtShapeClause(district) {
  if (!district.typology) {
    return "doesn't have enough baseline-era history to classify a trajectory shape";
  }
  return SHAPE_SENTENCES[district.typology];
}

// Standalone form -- capitalized, period-terminated -- for contexts with no
// name/colon already leading into it: the ranked list and map tooltips,
// where the district's name is already shown as its own separate line/
// column rather than needing to be repeated inside this sentence.
export function districtShapeSentence(district) {
  const clause = districtShapeClause(district);
  return clause.charAt(0).toUpperCase() + clause.slice(1) + ".";
}

// ---------------------------------------------------------------------------
// Era-CAGR numeric detail
// ---------------------------------------------------------------------------
// districtShapeSentence()/districtShapeClause() above already say the SHAPE
// of baseline_cagr -> efa_cagr in words (growing / flat / declining in each
// era, flat = within +-0.5%/yr -- see classify_typology.py's
// GROWTH_THRESHOLD/DECLINE_THRESHOLD, mirrored there not here). This section
// is just the raw numbers behind that sentence -- eraCagrClause() used to
// also print its own qualitative word per era (e.g. "(flat, within
// ±0.5%/yr)"), but every context that shows this numeric detail now shows
// the shape sentence right alongside it, so restating growing/flat/
// declining a second time was redundant with what the sentence already
// says in words. Worth restating why a "flat" CAGR can still show a
// nonzero pct_change_efa_era, since that's still true and not obvious from
// the numbers alone: a "flat" CAGR of e.g. -0.4%/yr compounds to a small
// negative pct_change_efa_era over the era's several years even though the
// era itself is flat, not declining -- so growth_stalled can show a
// negative number and decline_stabilized a positive one. This is correct,
// not a bug.

// Exported: the drill-down view's key-stats block reuses this for
// baseline_cagr/efa_cagr rather than re-deriving its own formatter.
export function formatCagr(cagr) {
  const pct = (cagr * 100).toFixed(1);
  return `${cagr >= 0 ? "+" : ""}${pct}%/yr`;
}

// Signed percentage with no unit suffix, e.g. "+2.6" or "-12.9" -- the
// building block for pct_change_efa_era/covid_drop_pct display (which
// aren't annualized rates, so formatCagr's "/yr" doesn't apply).
export function formatSignedPct(v, decimals = 1) {
  const pct = (v * 100).toFixed(decimals);
  return `${v >= 0 ? "+" : ""}${pct}`;
}

// One era's clause, e.g. "Baseline: +1.0%/yr" or "EFA era: -0.4%/yr".
function eraCagrClause(eraLabelText, cagr) {
  return `${eraLabelText}: ${formatCagr(cagr)}`;
}

// Full "why this shape" sentence for a district -- baseline era clause,
// then EFA era clause. Used both by the ranked list's hover/focus tooltip
// and folded into districtAriaLabel() below, so keyboard/screen-reader users
// get identical information to the visual tooltip.
export function districtCagrDetail(district) {
  if (typeof district.baseline_cagr !== "number" || typeof district.efa_cagr !== "number") {
    return "";
  }
  return `${eraCagrClause("Baseline", district.baseline_cagr)}; ${eraCagrClause("EFA era", district.efa_cagr)}.`;
}

export function districtAriaLabel(district) {
  const shape = districtShapeClause(district);
  const pct = district.pct_change_efa_era;
  const pctText = typeof pct === "number"
    ? `, ${(pct * 100).toFixed(1)}% change in the EFA era`
    : "";
  const detail = districtCagrDetail(district);
  const detailText = detail ? ` ${detail}` : "";
  return `${district.name}: ${shape}${pctText}.${detailText}`;
}

// Standalone form of the shape+pct+CAGR-detail block districtAriaLabel()
// above bakes into a fixed "NAME: shape clause, pct. detail" order --
// this version uses districtShapeSentence()'s capitalized,
// period-terminated form instead of districtShapeClause()'s lowercase,
// no-period continuation form (the one districtAriaLabel() uses, meant
// to directly follow "NAME:"), so it reads correctly as its own sentence
// no matter what precedes it. Built for map.js's district aria-label,
// which needs to insert an enrollment figure between the name and this
// block -- see that file's own aria-label construction -- without
// reimplementing the underlying shape/pct/CAGR-detail composition a
// second time. districtAriaLabel() itself is untouched by this addition
// (still used as-is by the ranked list and drill-down), so this is
// purely additive, not a refactor of existing callers' output.
export function districtTrajectoryText(district) {
  const pct = district.pct_change_efa_era;
  const pctText = typeof pct === "number"
    ? ` ${(pct * 100).toFixed(1)}% change in the EFA era.`
    : "";
  const detail = districtCagrDetail(district);
  const detailText = detail ? ` ${detail}` : "";
  return `${districtShapeSentence(district)}${pctText}${detailText}`;
}

// ---------------------------------------------------------------------------
// Glossary: plain-language definitions for technical metric/field labels
// (CAGR, COVID drop, etc.) -- NOT typology category names, which already
// have a different, deliberately-chosen solution (districtShapeSentence()
// above uses plain-language shape sentences instead of raw category
// names, and that's the right fix for THAT problem; this glossary is for
// the numeric/categorical fields sitting alongside them). One definition
// per term, defined once here and applied everywhere that term's label
// appears via glossaryAriaLabel()/attachGlossaryNote() below, so a reader
// gets identical wording in every view rather than 5 independently-typed
// versions that could drift the way labels themselves already have once
// (see school-districts.js's "EFA-era change" -> "EFA change" rename, or the
// drill-down stat-row reconciliation that followed it).
//
// Each view's persistent (always-visible) note text is hand-copied from
// this same wording at the point it's written, not templated from here
// at runtime -- matching this project's existing convention that
// persistent notes (table-note/methodology-note) are static prose in
// each view's own HTML, not JS-rendered. Every persistent note that
// copies from a term here carries an inline comment saying so, and this
// list is the map of where each copy lives, so an edit to either side
// doesn't silently drift out of sync with the other:
//   cagr           -- district-rankings.html .methodology-note,
//                      school-districts.html .table-note,
//                      drill-down.html .stat-note
//   efaChange      -- school-districts.html .table-note, drill-down.html .stat-note
//   covidDrop      -- school-districts.html .table-note, drill-down.html .stat-note
//   covidRecovery  -- drill-down.html .stat-note
//   other          -- statewide.html .table-note (already covered before this
//                      glossary existed; wording matches, not rewritten)
//   predecessor    -- statewide.html .table-note (same as other, above)
//   charterEfaEraChange -- charter-schools.html .table-note
export const GLOSSARY = {
  cagr: "The average yearly rate of change, accounting for compounding, not the same as a simple total percentage change.",
  efaChange: "The simple total percentage change in enrollment from the start of the EFA era (2022-23) to the most recent year, not an annualized rate like CAGR.",
  covidDrop: "Percent change from the district's 2019-20 enrollment (the last year before the pandemic) to its lowest point during the COVID shock (2020-21, 2021-22). Usually negative, but not always: a district whose COVID-year low never actually dropped below its own 2019-20 enrollment still shows a positive value here.",
  covidRecovery: "Whether enrollment climbed back to within 2% of its 2019-20 level (the last year before the pandemic) at any point during the COVID shock or by the first EFA year (2020-21 through 2022-23).",
  other: "The Division of Youth Services School System and the Arkansas School for the Deaf and Blind, state-run schools that are neither a regular district nor a charter.",
  predecessor: "A real school district later merged into a current district (e.g. Dollarway, absorbed into Pine Bluff in 2021), counted only for its own years before that merger.",
  // charter-schools.html's own cumulative sort column -- explicitly NOT
  // the same anchor as districts' efaChange above. That field is fixed at
  // 2022-23 for every district uniformly, since all 235 have complete
  // EFA-era coverage. Charters don't share that uniformity -- 4 of 22
  // opened in 2024-25, so "the start of the EFA era" for THEM is 2024-25,
  // not 2022-23. A reader comparing a charter's EFA-era change figure
  // against a district's could easily assume the two numbers are anchored
  // the same way; they aren't, and the definition says so explicitly
  // rather than leaving that to be discovered by surprise. Also distinct
  // from the three year-over-year columns beside it, each of which covers
  // just one adjacent pair of years, not the full cumulative span.
  charterEfaEraChange: "The cumulative simple percent change from a charter's own first available EFA-era year (2022-23 for most, but as late as 2024-25 for one that opened then) to its most recent year: NOT the same anchor as districts' EFA change, which is fixed at 2022-23 for every district uniformly, and not the same as the year-over-year columns beside it, each of which covers only one adjacent pair of years.",
};

// aria-label text combining a base label (e.g. "Sort by Baseline CAGR")
// with its glossary definition -- for elements whose accessible name is
// an EXPLICIT aria-label, which overrides the element's text content
// entirely for accessible-name computation. An appended visually-hidden
// child span (attachGlossaryNote() below) would be silently ignored by
// assistive tech on an element like this -- confirmed against the ARIA
// accessible-name spec, not assumed -- so the definition has to be baked
// into the aria-label string itself instead. Used by the data table's
// and ranked list's sortable/interactive headers, both of which already
// set an explicit aria-label for their sort behavior and re-render it
// fresh on every sort-direction change; this always recomputes from
// `baseLabel` rather than reading back a previous aria-label, so calling
// it again on re-render can't double up the appended text. Falls back to
// the plain base label if `term` has no glossary entry, so callers can
// use this unconditionally.
export function glossaryAriaLabel(baseLabel, term) {
  const def = GLOSSARY[term];
  return def ? `${baseLabel} — ${def}` : baseLabel;
}

// Sets `title` (mouse hover) and appends a `.visually-hidden` child span
// carrying the same definition (keyboard/screen-reader reachable, read as
// part of the element's own accessible name since it's real text content,
// not an aria-label) -- for a NON-interactive element like a <dt> or a
// plain <th> with no aria-label of its own to fight with (see
// glossaryAriaLabel() above for the interactive-element case, where this
// approach doesn't work). Reuses the Notes column's core idea --
// makeCaveatsMark() above -- of "title for mouse hover, a second
// always-in-the-accessible-tree text for everyone else," adapted for the
// one real difference: makeCaveatsMark() wraps a DECORATIVE icon
// (aria-hidden, with its real label living on a separate ancestor
// element), where every element this function is called on is
// non-decorative content that already fills its own accessible-tree slot
// -- so the definition is appended directly to it rather than parked on
// a sibling. Safe to call once per element creation; every caller here
// rebuilds its elements fresh on each render rather than mutating
// existing ones, so there's no double-append risk. No-op if `term` has
// no glossary entry.
export function attachGlossaryNote(el, term) {
  const def = GLOSSARY[term];
  if (!def) return;
  el.title = def;
  const sr = document.createElement("span");
  sr.className = "visually-hidden";
  sr.textContent = ` — ${def}`;
  el.appendChild(sr);
}

// Display-only name shortener. Was originally just
// `name.replace(/ SCHOOL DISTRICT$/i, "")`, duplicated identically in
// district-rankings.js and drill-down.js -- that anchored-to-end regex silently
// failed to shorten anything for the 9 districts whose name carries a
// trailing parenthetical disambiguator (e.g. "HARMONY GROVE SCHOOL
// DISTRICT (Ouachita)"), since "SCHOOL DISTRICT" no longer sits at the
// very end once "(Ouachita)" follows it, and for the 1 district whose
// suffix is abbreviated "SCHOOL DIST" rather than "SCHOOL DISTRICT"
// ("IMBODEN CHARTER SCHOOL DIST"). Both gaps are fixed here by no longer
// anchoring to end-of-string and by matching the "DIST" abbreviation too.
//
// "Consolidated" and "Bi County"/"Bi-County" are stripped when they
// directly precede "School Dist(rict)" -- both are administrative
// formation descriptors (a merger, or a district spanning two counties),
// not part of the place name itself:
//   "WESTSIDE CONSOLIDATED SCHOOL DISTRICT (Craighead)" -> "WESTSIDE (Craighead)"
//   "IZARD COUNTY CONSOLIDATED SCHOOL DISTRICT" -> "IZARD COUNTY"
//   "MULBERRY PLEASANT VIEW BI COUNTY SCHOOL DISTRICT" -> "MULBERRY PLEASANT VIEW"
// Checked against all 235 real names (2026-07-13): these are the only two
// administrative qualifier words that appear in that adjacent-to-"School
// District" position across the dataset. "Special" (PULASKI COUNTY
// SPECIAL SCHOOL DISTRICT) is deliberately NOT stripped -- unlike these
// two, it's part of how this specific, well-known district (PCSSD) is
// actually referred to, and dropping it would leave "Pulaski County,"
// which reads as if it covered the whole county rather than the specific
// carved-out district it is. "Consolidated"/"Bi County" are
// formation-type descriptors; "Special" is not decorative here, so it
// stays.
//
// Checked for collisions across all 235 real names: zero -- every
// shortened name is still unique (the 9 parenthetical-disambiguator
// districts, in particular, stay distinguishable from each other because
// the parenthetical itself differs even when the base name doesn't, e.g.
// "LAKESIDE (Chicot)" vs "LAKESIDE (Garland)").
export function shortName(name) {
  let s = name.replace(/\s+(?:Consolidated|Bi[\s-]+County)(?=\s+School\s+Dist)/i, "");
  s = s.replace(/\s*School\s+Dist(?:rict)?\.?/i, "");
  return s.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Random district selection -- extracted from index.js's own
// pickRandomDistrict() (originally built for the District Detail preview
// card alone) once the District Rankings and School Districts preview cards
// needed the same underlying mechanism: N districts picked at random,
// without replacement, rather than always the same deterministic set. Each
// caller still does its own per-card caching (pick once per real page load,
// not re-rolled on a dark/light-mode re-render) -- that caching is
// call-site-specific state, not something this function itself should own.
// Plain random-index-and-remove, the same approach pickRandomDistrict()
// already used for N=1, just generalized to N>1 without duplicates.
export function pickRandomDistricts(districts, n) {
  const pool = [...districts];
  const picked = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// District/charter search -- extracted from index.js (originally the
// landing page's hero-embedded search) so find-a-district.js can reuse the
// exact same matching behavior rather than a second, driftable copy. Same
// three outcomes both callers already relied on: one exact match redirects
// straight to its page, several matches list them, zero matches points to
// the district rankings.
// ---------------------------------------------------------------------------

// Imboden Charter is one of charter_points.json's 23 entries (rendered as a
// map point for lack of its own boundary polygon) but is actually one of
// districts.json's 235 real districts, not a charter SIS row -- excluded
// here for the same reason charter-schools.js's own IMBODEN_ID exclusion
// exists: counting it under both the district AND the charter search
// results would offer the same district twice under two different result
// types. A local copy, not exported/shared with charter-schools.js's or
// index.js's own copies -- same "small local constant, not worth a shared
// export" convention this project already uses for tiny per-file needs.
const SEARCH_IMBODEN_ID = "0500061";

export function buildSearchIndex(districts, charterPoints) {
  const districtEntries = districts.map((d) => ({
    name: d.name,
    display: shortName(d.name),
    href: `drill-down.html?id=${encodeURIComponent(d.id)}`,
  }));
  const charterEntries = charterPoints
    .filter((c) => c.id !== SEARCH_IMBODEN_ID)
    .map((c) => ({
      name: c.name,
      display: shortName(c.name),
      href: "charter-schools.html",
    }));
  return [...districtEntries, ...charterEntries];
}

export function populateSearchDatalist(datalist, entries) {
  const seen = new Set();
  const options = [...entries]
    .sort((a, b) => a.display.localeCompare(b.display))
    .filter((e) => {
      if (seen.has(e.display)) return false;
      seen.add(e.display);
      return true;
    });
  datalist.textContent = "";
  for (const e of options) {
    const opt = document.createElement("option");
    opt.value = e.display;
    datalist.appendChild(opt);
  }
}

// Case-insensitive substring match, same convention district-rankings.js's
// own search uses (d.name.toLowerCase().includes(query)) -- checked against
// both the full legal name and the shortName() display form, since the
// datalist offers the shortened form (e.g. "DeWitt") and a handful of
// districts' shortened form isn't a literal substring of their full name
// (the 9 parenthetical-disambiguator districts, where shortName() removes
// the "School District" segment sitting BETWEEN the base name and the
// parenthetical -- "LAKESIDE (Chicot)" is not a substring of "LAKESIDE
// SCHOOL DISTRICT (Chicot)"). Same algorithm, just checked against the one
// additional string a reader could plausibly have typed or selected.
export function matchSearchEntries(entries, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return entries.filter(
    (e) => e.name.toLowerCase().includes(q) || e.display.toLowerCase().includes(q)
  );
}

export function renderSearchNone(resultEl) {
  resultEl.textContent = "";
  const p = document.createElement("p");
  p.className = "result-none";
  p.textContent = "No exact match found. ";
  const a = document.createElement("a");
  a.href = "district-rankings.html";
  a.textContent = "Browse the district rankings";
  p.appendChild(a);
  p.appendChild(document.createTextNode(" to search more broadly."));
  resultEl.appendChild(p);
}

export function renderSearchMultiple(resultEl, matches) {
  resultEl.textContent = "";
  const label = document.createElement("p");
  label.className = "result-multi-label";
  label.textContent = `${matches.length} matches -- did you mean:`;
  resultEl.appendChild(label);
  const ul = document.createElement("ul");
  for (const m of matches) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = m.href;
    a.textContent = m.display;
    li.appendChild(a);
    ul.appendChild(li);
  }
  resultEl.appendChild(ul);
}

// Convenience wrapper -- both index.js (the landing page's card, which
// links out to find-a-district.html now rather than embedding this itself)
// and find-a-district.js wire up an identical form/datalist/result-region
// submit handler; centralizing the wiring here too, not just the matching
// logic underneath it, means there's exactly one submit handler to keep
// correct rather than two copies that could quietly diverge. Returns the
// built entries list, in case a caller wants it for anything else (neither
// current caller does, but returning it costs nothing and avoids a second
// buildSearchIndex() call if that ever changes).
export function wireSearchForm({ form, input, datalist, resultEl, districts, charterPoints }) {
  const entries = buildSearchIndex(districts, charterPoints);
  populateSearchDatalist(datalist, entries);
  form.addEventListener("submit", (evt) => {
    evt.preventDefault();
    const matches = matchSearchEntries(entries, input.value);
    if (matches.length === 1) {
      window.location.href = matches[0].href;
    } else if (matches.length > 1) {
      renderSearchMultiple(resultEl, matches);
    } else {
      renderSearchNone(resultEl);
    }
  });
  return entries;
}
