// Full data table, moved out of district-rankings.js's inline "View as table"
// expand/collapse section into its own page. Same table-rendering/sorting
// logic as before (COLUMNS, compareRows, renderHead/renderBody), just no
// longer gated behind a toggle button -- this page's only content is the
// table, so it renders unconditionally on load instead of lazily on first
// expand. Deliberately NOT filtered by the ranked list's search/bucket
// state -- always all 235 districts, the "full transparency" view.
import {
  loadDistricts,
  shortName,
  efaYearOverYear,
  schoolYearLabel,
  districtShapeSentence,
  districtCagrDetail,
  sparklineSvg,
  sparklineBoundaryNote,
  thinBaselineIcon,
  boundaryChangedIcon,
  reversalIcon,
  makeCaveatsMark,
  glossaryAriaLabel,
  GLOSSARY,
} from "./shared.js";

// Header labels are the actual width driver for several of these columns
// now, not the data (typology aside, cell content is short numbers or the
// Caveats column's tiny marks) -- so "EFA-era change" was shortened to
// "EFA change," parallel to "Baseline CAGR"/"EFA CAGR"'s own naming.
//
// The three separate caveat columns (Thin baseline, Reversal magnitude,
// Boundary changed) collapsed into one "Caveats" column -- checked
// against districts.json first (2026-07-13): 177 districts have none of
// the three, 53 have exactly one, 4 have two (Nevada, Jacksonville North
// Pulaski, West Memphis, Smackover Norphlet), and 1 (Hackett) has all
// three. Real, not hypothetical, overlap -- the combined cell has to
// render up to 3 simultaneous marks cleanly, not just 0 or 1.
//
// The 3 year-over-year EFA columns are NOT in this static list -- their
// count and headers depend on how many EFA-era years actually exist in
// the data (today: 3 consecutive pairs across 4 years, confirmed
// universal for all 235 districts against districts.json, but that's a
// fact about the current data, not a guarantee), so they're built inside
// main() from efaYearOverYear()'s real output after districts load, and
// spliced in between COLUMNS_BEFORE_YOY and COLUMNS_AFTER_YOY. A future
// data refresh that adds a 5th EFA year would grow this table an extra
// column automatically instead of silently going stale.
// `term` keys into shared.js's GLOSSARY -- renderHead() below bakes each
// into that header's title (mouse hover) and aria-label (keyboard/screen
// reader), computed fresh from c.label every render rather than read back
// from a previous aria-label, so re-sorting can't double up the appended
// definition text. Columns with no `term` (District, Trajectory, the
// year-over-year pairs, Notes) already have an established explanation
// elsewhere (Trajectory/Notes via their own per-cell title -- see
// makeTypologyVisualCell()/makeCaveatsCell() below -- and the
// year-over-year columns' own "22-23 → 23-24"-style headers are
// self-explanatory) or are plain, non-technical labels.
const COLUMNS_BEFORE_YOY = [
  { key: "name", label: "District", type: "string" },
  // Not sortable (see renderHead()) -- the column no longer shows
  // typologyLabel() text, so "sort by typology" with no visible category
  // name to explain the resulting order would be confusing. sortable:
  // false is the only column that sets this; every other column defaults
  // sortable.
  { key: "typology", label: "Trajectory", type: "typology", sortable: false },
  { key: "baseline_cagr", label: "Baseline CAGR", type: "pct", term: "cagr" },
  { key: "covid_drop_pct", label: "COVID drop", type: "pct", term: "covidDrop" },
];
const COLUMNS_AFTER_YOY = [
  { key: "efa_cagr", label: "EFA CAGR", type: "pct", term: "cagr" },
  { key: "pct_change_efa_era", label: "EFA change", type: "pct", term: "efaChange" },
  { key: "caveats", label: "Notes", type: "caveats" },
];

function fmtPct(v) {
  return v == null ? "—" : (v * 100).toFixed(1) + "%";
}
function fmtMagnitude(v) {
  return v ? v[0].toUpperCase() + v.slice(1) : "—";
}

// ---------------------------------------------------------------------------
// Trajectory column: sparkline
// ---------------------------------------------------------------------------
// Finalized after a live side-by-side comparison against an icon
// candidate (2-segment abstracted up/flat/down shape derived from
// baseline_cagr/efa_cagr) -- the sparkline won and the icon code path was
// removed entirely, not left behind as a dead option. The sparkline
// implementation itself (sparklineSvg(), the 2013-2025 window, the
// boundary-change-district handling) now lives in shared.js, since the
// ranked list needed the exact same visual -- imported above rather than
// kept as a local copy.

// Cell-scoped accessible label -- districtShapeSentence() (not the raw
// typologyLabel() this column showed before the sparkline) plus the
// baseline/EFA CAGR numbers behind it, same pairing every other
// visual-plus-text spot in this project uses. sparklineBoundaryNote()
// (shared.js) appends the boundary-change omission sentence for the 7
// exception districts -- same shared wording the ranked list's row
// tooltip now also uses for the same sparkline.
function typologyCellLabel(d) {
  const detail = districtCagrDetail(d);
  const label = detail ? `${districtShapeSentence(d)} ${detail}` : districtShapeSentence(d);
  return label + sparklineBoundaryNote(d);
}

// Same title-attribute + visually-hidden-span pattern as the Caveats
// column -- one accessible label, decorative mark aria-hidden.
function makeTypologyVisualCell(d, mode) {
  const td = document.createElement("td");
  td.className = "cell-typology-visual";
  const label = typologyCellLabel(d);
  td.title = label;
  const svg = sparklineSvg(d, mode);
  svg.setAttribute("aria-hidden", "true");
  td.appendChild(svg);
  const sr = document.createElement("span");
  sr.className = "visually-hidden";
  sr.textContent = label;
  td.appendChild(sr);
  return td;
}

// How many of the three caveat flags are active on a district -- the
// sort key for the combined column. Descending puts the busiest rows
// (Hackett's 3, then the 4 two-flag districts) first, which is exactly
// what a reader scanning for "which districts need the closest look"
// wants; ascending puts the 177 clean districts first, useful for the
// opposite question ("show me the districts with nothing to check").
// Considered weighting thin-baseline/boundary-changed as more
// "significant" than reversal-magnitude for sort purposes, but rejected
// it: all three are equally "something to verify before trusting this
// row's numbers," not a severity ranking, and a plain count keeps the
// sort's meaning obvious from the column header alone rather than
// needing its own explanation.
function caveatCount(d) {
  return (d.baseline_years_thin ? 1 : 0) +
    (d.reversal_magnitude ? 1 : 0) +
    (d.boundary_change_within_series ? 1 : 0);
}

// Full accessible text for a row's caveat cell -- same phrasing
// convention district-rankings.js's badgeTexts()/tooltipText() already
// established (each caveat its own sentence, period-separated), so a
// screen reader user gets one complete readout per cell ("Thin baseline.
// Large reversal. Boundary changed 2015." for Hackett) rather than having
// to piece together multiple adjacent marks. A clean row reads "No
// caveats." rather than silence.
function caveatLabel(d) {
  const parts = [];
  if (d.baseline_years_thin) parts.push("Thin baseline.");
  if (d.reversal_magnitude) parts.push(`${fmtMagnitude(d.reversal_magnitude)} reversal.`);
  if (d.boundary_change_within_series) parts.push(`Boundary changed ${d.current_boundary_since}.`);
  return parts.length ? parts.join(" ") : "No caveats.";
}

// ---------------------------------------------------------------------------
// Notes column: three distinct SVG mark icons
// ---------------------------------------------------------------------------
// thinBaselineIcon()/boundaryChangedIcon()/reversalIcon()/
// makeCaveatsMark() now live in shared.js -- moved there once the ranked
// list needed the exact same icons, same reason the sparkline moved
// there. See shared.js for the full design writeup (silhouette choices,
// the rejected triangle alternative for Reversal, the per-mark hit-target
// sizing fix).
function makeCaveatsCell(d) {
  const td = document.createElement("td");
  td.className = "cell-caveats";
  const label = caveatLabel(d);
  td.title = label;

  if (d.baseline_years_thin) {
    td.appendChild(makeCaveatsMark(thinBaselineIcon(), "Thin baseline"));
  }
  if (d.reversal_magnitude) {
    td.appendChild(makeCaveatsMark(
      reversalIcon(d.reversal_magnitude),
      `${fmtMagnitude(d.reversal_magnitude)} reversal`
    ));
  }
  if (d.boundary_change_within_series) {
    td.appendChild(makeCaveatsMark(boundaryChangedIcon(), `Boundary changed: ${d.current_boundary_since}`));
  }

  const sr = document.createElement("span");
  sr.className = "visually-hidden";
  sr.textContent = label;
  td.appendChild(sr);
  return td;
}

function compareRows(a, b, col, dir) {
  // "caveats" isn't a real district.json field -- it's the derived
  // 0-3 count above -- so it's handled before the generic a[col.key]
  // lookup below, which would otherwise see both sides as undefined and
  // treat every row as tied.
  if (col.type === "caveats") {
    const cmp = caveatCount(a) - caveatCount(b);
    return dir === "asc" ? cmp : -cmp;
  }

  // Same reasoning as "caveats" above -- an efa_yoy_N column key isn't a
  // real district field either, it's this specific pair's pct pulled out
  // of efaYearOverYear()'s array by index. Nulls last, same convention as
  // every other numeric column, even though no pair is null for any of
  // today's 235 districts.
  if (col.type === "efaYoy") {
    const av = efaYearOverYear(a)[col.pairIndex]?.pct;
    const bv = efaYearOverYear(b)[col.pairIndex]?.pct;
    const aNull = av == null, bNull = bv == null;
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    const cmp = av - bv;
    return dir === "asc" ? cmp : -cmp;
  }

  const av = a[col.key], bv = b[col.key];
  const aNull = av == null, bNull = bv == null;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls always sort last, regardless of direction
  if (bNull) return -1;

  let cmp;
  if (col.type === "string") cmp = String(av).localeCompare(String(bv));
  else if (col.type === "bool" || col.type === "boundary") cmp = av === bv ? 0 : av ? 1 : -1;
  else cmp = av - bv;
  return dir === "asc" ? cmp : -cmp;
}

function currentMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

async function main() {
  const districts = await loadDistricts();
  let sortKey = "name";
  let sortDir = "asc";

  // Real year values pulled from actual data (districts[0], since the
  // EFA-year range is universal across all 235 -- confirmed above), not
  // hardcoded -- header text like "22-23 → 23-24" tracks whatever years
  // are actually in districts.json. schoolYearLabel(fromYear) gives
  // "2022-23"; slice(2) drops the "20" on each side -- same underlying
  // year math, shorter text, still both full year-pairs (not collapsed
  // to just one side the way an earlier draft of this label was).
  const yoyColumns = efaYearOverYear(districts[0]).map((pair, i) => ({
    key: `efa_yoy_${i}`,
    label: `${schoolYearLabel(pair.fromYear).slice(2)} → ${schoolYearLabel(pair.toYear).slice(2)}`,
    type: "efaYoy",
    pairIndex: i,
  }));
  const COLUMNS = [...COLUMNS_BEFORE_YOY, ...yoyColumns, ...COLUMNS_AFTER_YOY];

  function renderBody() {
    const col = COLUMNS.find((c) => c.key === sortKey);
    const rows = [...districts].sort((a, b) => compareRows(a, b, col, sortDir));
    const mode = currentMode();
    const tbody = document.getElementById("data-table-body");
    tbody.textContent = "";
    for (const d of rows) {
      const tr = document.createElement("tr");
      for (const c of COLUMNS) {
        let td = document.createElement("td");
        if (c.key === "name") {
          const link = document.createElement("a");
          link.href = `drill-down.html?id=${encodeURIComponent(d.id)}`;
          link.textContent = shortName(d.name);
          link.title = d.name; // full name still discoverable on hover
          td.appendChild(link);
        } else if (c.type === "typology") {
          td = makeTypologyVisualCell(d, mode);
        } else if (c.type === "pct") {
          td.textContent = fmtPct(d[c.key]);
        } else if (c.type === "efaYoy") {
          td.textContent = fmtPct(efaYearOverYear(d)[c.pairIndex]?.pct);
        } else if (c.key === "caveats") {
          td = makeCaveatsCell(d);
        } else {
          td.textContent = d[c.key] ?? "—";
        }
        // Active-sort-column highlight -- see renderHead() for the header
        // half of this (bold text); this is the body half (background
        // tint), applied per-cell rather than at the <col>/table level
        // since td is sometimes reassigned above (typology/caveats cells
        // build their own <td> rather than reusing the loop's default).
        if (c.key === sortKey) td.classList.add("col-sorted");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function renderHead() {
    const row = document.getElementById("table-head-row");
    row.textContent = "";
    for (const c of COLUMNS) {
      const th = document.createElement("th");
      th.textContent = c.label;

      // Trajectory (c.sortable === false) renders as a plain, inert
      // header -- it no longer shows typologyLabel() text, so a click
      // that reorders rows with no visible category name to explain the
      // resulting order would be confusing (see the COLUMNS_BEFORE_YOY
      // comment). No tabIndex/role/aria-label/listeners/arrow, and
      // .col-header-static below strips the pointer cursor so it doesn't
      // visually promise the same interaction every other header offers.
      if (c.sortable === false) {
        th.className = "col-header-static";
        row.appendChild(th);
        continue;
      }

      th.tabIndex = 0;
      th.setAttribute("role", "button");
      th.setAttribute("aria-label", glossaryAriaLabel(`Sort by ${c.label}`, c.term));
      if (c.term) th.title = GLOSSARY[c.term];
      const isActive = sortKey === c.key;
      if (isActive) th.classList.add("col-sorted");
      // Rendered unconditionally on every sortable header, not just the
      // active one -- both to signal "this column is sortable" up front
      // (a faint neutral glyph) and, since the slot's width in CSS never
      // changes whether it's showing that neutral glyph or the solid
      // active ↑/↓, to keep this from ever being the reason a column's
      // width changes when the active sort column changes.
      const arrow = document.createElement("span");
      arrow.className = isActive ? "sort-arrow active" : "sort-arrow";
      arrow.textContent = isActive ? (sortDir === "asc" ? "↑" : "↓") : "⇅";
      arrow.setAttribute("aria-hidden", "true");
      th.appendChild(arrow);
      const activate = () => {
        if (sortKey === c.key) sortDir = sortDir === "asc" ? "desc" : "asc";
        else { sortKey = c.key; sortDir = "asc"; }
        renderHead();
        renderBody();
      };
      th.addEventListener("click", activate);
      th.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") { evt.preventDefault(); activate(); }
      });
      row.appendChild(th);
    }
  }

  // Live-theme-change listener is back (it was dead code and removed once
  // the caveats redesign made every color in this table pure-CSS) --
  // sparkline strokes are JS-computed (via shared.js's sparklineSvg(),
  // which resolves color through typologyColor(mode) internally) again,
  // so a live OS theme change needs a re-render to pick up the new mode.
  renderHead();
  renderBody();

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    renderBody();
  });
}

main();
