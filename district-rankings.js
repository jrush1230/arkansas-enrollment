import {
  loadDistricts,
  districtAriaLabel,
  districtShapeSentence,
  districtCagrDetail,
  sparklineSvg,
  sparklineBoundaryNote,
  thinBaselineIcon,
  boundaryChangedIcon,
  reversalIcon,
  makeCaveatsMark,
  pctChangeColor,
  GRADIENT_ANCHORS,
  shortName,
  glossaryAriaLabel,
  GLOSSARY,
} from "./shared.js";

// Magnitude bucket filter -- Declining/Stable/Growing are now defined by
// pct_change_efa_era's own value, not by typology-ramp membership. The old
// version bucketed by typology (first 4 categories = "growing," etc.),
// which let a district like Pottsville (typology growth_stalled, a
// "growing" category) land in the Growing bucket while its own displayed
// percentage was -1.3% -- a real, visible contradiction between a row's
// bucket and its own number. This can't happen anymore: every bucket's
// membership is directly a function of the same pct_change_efa_era shown
// on the row.
//
// +-2% threshold, chosen from the real distribution across all 235
// districts (computed 2026-07-13): min -38.2%, p10 -13.0%, p25 -8.5%,
// median -5.0%, p75 -1.0%, p90 +3.9%, p95 +6.8%, max +15.8%. At +-2%:
// declining=159, stable=44, growing=32 (235 total). Declining dominates
// (68%) because that's the real shape of this data -- Arkansas-wide
// EFA-era decline, already established via the map's color-scale work --
// not an artifact of where the threshold landed; +-1% (stable=18, feels
// too thin to read as a real "roughly flat" band) and +-3%
// (stable=63/27%, starts absorbing districts closer to the -5% median
// decline than to flat) were checked and rejected in favor of +-2% as the
// cleanest round number giving Stable a legible, non-trivial slice
// without pulling in genuinely-declining districts.
const STABLE_THRESHOLD = 0.02;

// colorKey indexes into shared.js's GRADIENT_ANCHORS (same green/yellow/red
// anchors the map's continuous fill uses) -- a magnitude-based bucket
// pairs naturally with the magnitude-based gradient, unlike the old
// typology-based buckets which had no principled color of their own.
const MAGNITUDE_BUCKETS = {
  all: { label: "All", colorKey: null, matches: () => true },
  declining: {
    label: `Declining (< -${STABLE_THRESHOLD * 100}%)`,
    colorKey: "red",
    matches: (pct) => typeof pct === "number" && pct <= -STABLE_THRESHOLD,
  },
  stable: {
    label: `Stable (±${STABLE_THRESHOLD * 100}%)`,
    colorKey: "yellow",
    matches: (pct) => typeof pct === "number" && pct > -STABLE_THRESHOLD && pct < STABLE_THRESHOLD,
  },
  growing: {
    label: `Growing (> +${STABLE_THRESHOLD * 100}%)`,
    colorKey: "green",
    matches: (pct) => typeof pct === "number" && pct >= STABLE_THRESHOLD,
  },
};
const MAGNITUDE_BUCKET_ORDER = ["all", "declining", "stable", "growing"];

function currentMode() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function fmtPct(v) {
  return v == null ? "—" : (v * 100).toFixed(1) + "%";
}
function fmtMagnitude(v) {
  return v ? v[0].toUpperCase() + v.slice(1) : "—";
}

// Everything the simplified row no longer shows by default -- the shape
// sentence, badge text, and the baseline/EFA CAGR numeric detail -- now
// lands here instead, in that order. districtShapeSentence() (not
// typologyLabel()) is the primary shape description -- a reader shouldn't
// need to already know what "growth_stalled" means, same reasoning that
// put this sentence on the drill-down page in the first place. Always
// non-empty, so the tooltip fires for every row, not just ones with a
// CAGR detail to show. districtCagrDetail()'s numeric rates no longer
// carry their own growing/flat/declining annotation (see shared.js) --
// the sentence already says that in words, so the two lines aren't
// repeating each other. sparklineBoundaryNote() (shared.js) appends the
// sparkline's boundary-change omission sentence for the 7 exception
// districts -- the row's own sparkline (see buildRow()) is decorative
// (aria-hidden), so this tooltip/the aria-label below are the only place
// that omission is ever stated, same shared wording the data table's
// cell label uses for the identical visual.
function tooltipText(d) {
  const segments = [districtShapeSentence(d)];
  const badgeText = badgeTexts(d);
  if (badgeText.length) segments.push(`${badgeText.join(". ")}.`);
  const detail = districtCagrDetail(d);
  if (detail) segments.push(detail);
  const boundaryNote = sparklineBoundaryNote(d).trim();
  if (boundaryNote) segments.push(boundaryNote);
  return segments.join(" ");
}

// One shared tooltip element for the whole list (same idiom as the
// statewide line's single #tooltip div) rather than one per row -- shown on
// whichever row is currently hovered or focused. Same content
// districtAriaLabel()/the row's own aria-label already carry for
// keyboard/screen-reader users, so this is a second rendering of one
// channel, not a separate one.
function showRowTooltip(li, d) {
  const tooltip = document.getElementById("row-tooltip");
  const wrap = document.getElementById("rank-list-wrap");
  tooltip.textContent = tooltipText(d);
  const wrapRect = wrap.getBoundingClientRect();
  const rowRect = li.getBoundingClientRect();
  tooltip.style.left = "6px";
  tooltip.style.top = `${rowRect.bottom - wrapRect.top + 2}px`;
  tooltip.style.opacity = "1";
}

function hideRowTooltip() {
  document.getElementById("row-tooltip").style.opacity = "0";
}

// Single source of truth for badge text, shared by the visual pills and
// the aria-label -- badge info was visual-only before this fix (never
// reached districtAriaLabel() in any prior round), a real gap for
// screen-reader users on any of the 7 boundary-change districts or the
// several thin-baseline/reversal ones, found while re-testing the badge
// wrap fix below.
function badgeTexts(d) {
  const texts = [];
  // Guarantees a null-typology district still gets SOME accessible signal
  // even if it happens to have no other caveat true -- without this, a
  // district with e.g. baseline_years_thin=false would get an empty
  // badgeText array and render as an ordinary-looking row with only an
  // oddly-worded tooltip, no "something to check" signal at all. (No
  // dedicated visual icon exists for this case, matching the data
  // table's own Notes column -- "Not yet classified" is
  // tooltip/aria-label-only, same as there; today all 235 districts
  // classify, so this is a defensive guard against a FUTURE district,
  // not something a current row visually needs to mark.)
  if (!d.typology) texts.push("Not yet classified");
  if (d.baseline_years_thin) texts.push("Thin baseline");
  if (d.reversal_magnitude) texts.push(`${fmtMagnitude(d.reversal_magnitude)} reversal`);
  // Disclosure, not a warning: this district's baseline may reflect a
  // different (pre-merger, smaller) boundary than today's -- see
  // METHODOLOGY.md. Doesn't imply anything about classification
  // correctness, unlike the other two badges which flag data thinness.
  if (d.boundary_change_within_series) texts.push(`Boundary changed ${d.current_boundary_since}`);
  return texts;
}

function buildRow(d, rank, mode) {
  const li = document.createElement("li");

  // The row is a real link (drill-down.html?id=<leaid>) rather than a
  // plain li/tabindex, closing the "not built yet" gap from when this
  // view was first built -- also gives every row genuine link semantics
  // (Enter/click navigates) instead of the fake-interactive li it used to
  // be, which is a small accessibility improvement on top of the wiring.
  const a = document.createElement("a");
  a.className = "rank-row";
  a.href = `drill-down.html?id=${encodeURIComponent(d.id)}`;
  const badgeText = badgeTexts(d);
  // districtAriaLabel() is shared across map.js/drill-down.js too, so the
  // sparkline's boundary-change note is appended HERE rather than added
  // inside that shared function -- this task is scoped to the ranked
  // list, and extending the shared function would have silently changed
  // those other two views' aria-labels as a side effect. Reuses
  // sparklineBoundaryNote(d) verbatim (not a second, hand-typed copy of
  // the same sentence) so the tooltip and this aria-label can't drift
  // apart -- same accessibility parity this project maintains for every
  // prior tooltip addition.
  const extras = [badgeText.length ? `${badgeText.join(". ")}.` : "", sparklineBoundaryNote(d).trim()]
    .filter(Boolean)
    .join(" ");
  a.setAttribute("aria-label", extras ? `${districtAriaLabel(d)} ${extras}` : districtAriaLabel(d));
  a.addEventListener("mouseenter", () => showRowTooltip(a, d));
  a.addEventListener("mouseleave", hideRowTooltip);
  a.addEventListener("focus", () => showRowTooltip(a, d));
  a.addEventListener("blur", hideRowTooltip);

  if (rank) {
    const rankEl = document.createElement("span");
    rankEl.className = "rank-num";
    rankEl.textContent = String(rank);
    a.appendChild(rankEl);
  }

  // Magnitude, not shape: same pctChangeColor() gradient the map's fill
  // uses, keyed to this row's own pct_change_efa_era -- not typologyColor(),
  // which school-districts.js's typology column still uses unchanged (that page
  // has its own copy of this import, this file no longer needs it).
  // dataset.typology is kept as metadata (unrelated to which color
  // renders) since any future styling here might still key off it.
  const swatch = document.createElement("span");
  swatch.className = "row-swatch";
  swatch.dataset.typology = d.typology ?? "";
  swatch.style.background = pctChangeColor(d.pct_change_efa_era, mode);
  a.appendChild(swatch);

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = shortName(d.name);
  a.appendChild(name);

  // Notes icons -- the same shared.js icon builders (thinBaselineIcon()/
  // boundaryChangedIcon()/reversalIcon()) and per-mark hover-title
  // wrapper (makeCaveatsMark()) the data table's Notes column uses, not
  // reimplemented. Only active flags render (nothing for a clean row,
  // same "no all-clear placeholder" convention the data table's cell
  // already established); the container still holds its fixed width even
  // when empty, same reason the ring this replaces did, so
  // .row-trajectory/.row-pct don't shift between rows. Every mark is
  // purely visual (aria-hidden, inherited from makeCaveatsMark()) -- this
  // row's own aria-label (badgeText, built above) remains the sole
  // accessible channel; these per-mark titles are an ADDITIONAL
  // sighted-hover channel on top of it, the same relationship the data
  // table established between its cell-level label and per-mark
  // tooltips, not a replacement for the row's screen-reader text.
  const notes = document.createElement("span");
  notes.className = "row-notes";
  if (d.baseline_years_thin) {
    notes.appendChild(makeCaveatsMark(thinBaselineIcon(), "Thin baseline"));
  }
  if (d.reversal_magnitude) {
    notes.appendChild(makeCaveatsMark(
      reversalIcon(d.reversal_magnitude),
      `${fmtMagnitude(d.reversal_magnitude)} reversal`
    ));
  }
  if (d.boundary_change_within_series) {
    notes.appendChild(makeCaveatsMark(boundaryChangedIcon(), `Boundary changed: ${d.current_boundary_since}`));
  }
  a.appendChild(notes);

  // Trajectory sparkline -- same shared.js function, same 2013-2025
  // window, same per-district scaling, same boundary-change-district
  // handling as the data table's Trajectory column; imported rather than
  // reimplemented (see shared.js). Purely decorative (aria-hidden) --
  // the row's own tooltip/aria-label (districtShapeSentence() + CAGR
  // detail + badge text, above) is the accessible channel for what this
  // line shows, the same division of labor the data table's cell already
  // uses (visual sparkline + separate title/visually-hidden text).
  const trajectory = document.createElement("span");
  trajectory.className = "row-trajectory";
  const spark = sparklineSvg(d, mode);
  spark.setAttribute("aria-hidden", "true");
  trajectory.appendChild(spark);
  a.appendChild(trajectory);

  const pct = document.createElement("span");
  pct.className = "row-pct";
  pct.textContent = fmtPct(d.pct_change_efa_era);
  a.appendChild(pct);

  li.appendChild(a);
  return li;
}

async function main() {
  const districts = await loadDistricts();

  // Every district classifies today (data_status='ok' for all 235,
  // confirmed via the v3 rebuild's diff against the locked typology
  // output) -- the insufficient_history separated-section treatment this
  // view originally needed for Pine Bluff was removed as dead code
  // post-fix. A FUTURE null-typology district still needs no special
  // handling here: the only filter axis left is the magnitude bucket
  // (declining/stable/growing), which is keyed to pct_change_efa_era, a
  // real number for every district regardless of classification status
  // (see 12_build_districts_json.py -- EFA-era coverage is universal) --
  // so a null-typology district is always correctly bucketable by its own
  // actual percentage, typology-independent by construction, nothing to
  // special-case. (An earlier round also had a typology-based category
  // filter axis here, which did need a null-typology bypass -- that axis
  // was removed entirely, taking the bypass with it.) badgeTexts() still
  // always flags "Not yet classified" in the row's aria-label regardless
  // of classification.

  let activeBucketKey = "all";
  let searchText = "";
  // "decline" = most-negative pct_change_efa_era first (default); "growth"
  // reverses it. Applied after filtering, same as the fixed order was.
  let sortDirection = "decline";

  function matchesSearch(d) {
    return d.name.toLowerCase().includes(searchText.trim().toLowerCase());
  }

  function filteredDistricts() {
    const bucket = MAGNITUDE_BUCKETS[activeBucketKey];
    return districts
      .filter((d) => bucket.matches(d.pct_change_efa_era) && matchesSearch(d))
      .sort((a, b) =>
        sortDirection === "decline"
          ? a.pct_change_efa_era - b.pct_change_efa_era
          : b.pct_change_efa_era - a.pct_change_efa_era
      );
  }

  function renderList() {
    hideRowTooltip(); // a row mid-render may be removed by the new filter/sort without a mouseleave/blur ever firing
    const list = document.getElementById("rank-list");
    list.textContent = "";
    const rows = filteredDistricts();
    const mode = currentMode();
    rows.forEach((d, i) => list.appendChild(buildRow(d, i + 1, mode)));

    document.getElementById("result-count").textContent =
      `Showing ${rows.length} of ${districts.length} districts`;
  }

  // JS-rendered (not static markup) so each pill's label can be derived
  // straight from STABLE_THRESHOLD -- one place defines the number, same
  // pattern as everywhere else in this file that avoids re-listing a
  // constant. Colors come from GRADIENT_ANCHORS, not typologyColor() --
  // this is the magnitude channel, same one the map's fill and this row's
  // own swatch already use, not the categorical one.
  function renderBucketToggle() {
    const container = document.getElementById("bucket-toggle");
    container.textContent = "";
    const mode = currentMode();
    for (const key of MAGNITUDE_BUCKET_ORDER) {
      const { label, colorKey } = MAGNITUDE_BUCKETS[key];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.bucket = key;
      btn.setAttribute("aria-pressed", String(key === activeBucketKey));
      if (colorKey) {
        const sw = document.createElement("span");
        sw.className = "bucket-swatch";
        sw.style.background = GRADIENT_ANCHORS[mode][colorKey];
        btn.appendChild(sw);
        btn.style.borderColor = GRADIENT_ANCHORS[mode][colorKey];
      }
      btn.appendChild(document.createTextNode(label));
      btn.addEventListener("click", () => {
        activeBucketKey = key;
        renderBucketToggle();
        renderList();
      });
      container.appendChild(btn);
    }
  }

  function renderAllColors() {
    // Re-derive swatch/pill backgrounds on a live OS theme change without
    // a data reload.
    renderBucketToggle();
    renderList();
  }

  document.getElementById("search-input").addEventListener("input", (evt) => {
    searchText = evt.target.value;
    renderList();
  });

  const sortBtn = document.getElementById("sort-direction-btn");
  // Native hover tooltip -- set once, doesn't depend on sort direction so
  // it doesn't need to live inside updateSortButton()'s per-toggle
  // rebuild. The aria-label DOES get rebuilt every toggle (below), so the
  // glossary definition is appended fresh via glossaryAriaLabel() each
  // time rather than read back from a previous call -- see that
  // function's own comment for why an explicit aria-label can't just get
  // a visually-hidden child span appended instead.
  sortBtn.title = GLOSSARY.efaChange;
  function updateSortButton() {
    const declining = sortDirection === "decline";
    sortBtn.classList.toggle("ascending", !declining);
    sortBtn.setAttribute(
      "aria-label",
      glossaryAriaLabel(`Sort by EFA change: steepest ${declining ? "decline" : "growth"} first`, "efaChange")
    );
  }
  // Called once here too, not just from the click handler below -- the
  // static HTML's own aria-label (district-rankings.html) is a plausible-looking
  // default that happens to match sortDirection's initial value, but it
  // never carried the glossary definition, so a keyboard/screen-reader
  // user who never clicks this button (a real, not hypothetical, case --
  // that's exactly who a hover-only tooltip fails to reach) got an
  // incomplete aria-label until the first toggle. Found while testing
  // this glossary addition, not a pre-existing intentional gap.
  updateSortButton();
  sortBtn.addEventListener("click", () => {
    sortDirection = sortDirection === "decline" ? "growth" : "decline";
    updateSortButton();
    renderList();
  });

  renderBucketToggle();
  renderList();

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    renderAllColors();
  });
}

main();
