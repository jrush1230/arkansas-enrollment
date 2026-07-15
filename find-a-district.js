// Find a District -- a dedicated destination for the search feature that
// used to live embedded in the landing page's hero. All the actual
// matching logic (buildSearchIndex()/matchSearchEntries()/etc.) lives in
// shared.js now, extracted so this page and the landing page's old embed
// couldn't drift into two different behaviors -- this file just wires that
// shared implementation up to this page's own form/datalist/result
// elements via wireSearchForm(), the same convenience wrapper handles the
// full submit behavior (exact match redirects, multiple matches list,
// no match points to the district rankings).
import { loadDistricts, loadCharterPoints, wireSearchForm } from "./shared.js";

async function main() {
  const form = document.getElementById("find-search-form");
  const input = document.getElementById("find-search-input");
  const datalist = document.getElementById("find-search-datalist");
  const resultEl = document.getElementById("find-search-result");

  const [districts, charterPoints] = await Promise.all([
    loadDistricts(),
    loadCharterPoints(),
  ]);

  wireSearchForm({ form, input, datalist, resultEl, districts, charterPoints });
}

main();
