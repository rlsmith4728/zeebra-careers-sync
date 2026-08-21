const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const JOBS_API_URL = process.env.JOBS_API_URL || "https://sample-jobs-api-production.up.railway.app/jobs";
const API_BASE = "https://api.webflow.com/v2";

if (!WEBFLOW_API_TOKEN || !COLLECTION_ID) {
  console.error("Missing WEBFLOW_API_TOKEN or WEBFLOW_COLLECTION_ID env vars.");
  process.exit(1);
}

async function webflow(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Webflow API ${options.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function fetchJobs() {
  const res = await fetch(JOBS_API_URL);
  if (!res.ok) throw new Error(`Jobs API request failed: ${res.status}`);
  const data = await res.json();
  return data.records || [];
}

async function listAllItems() {
  const items = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const page = await webflow(`/collections/${COLLECTION_ID}/items?limit=${limit}&offset=${offset}`);
    items.push(...page.items);
    if (page.items.length < limit) break;
    offset += limit;
  }
  return items;
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Slugs must stay stable across runs (changing them breaks live URLs), so
// uniqueness is only resolved once, at creation time.
function uniqueSlug(base, usedSlugs) {
  let slug = base || "job";
  let n = 2;
  while (usedSlugs.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  usedSlugs.add(slug);
  return slug;
}

function buildFieldData(record) {
  const f = record.fields || {};
  const fieldData = {
    "source-id": record.id,
    name: f.Name || "Untitled role",
    description: f["Full Job Description"] || "",
    "meta-description": f["Short Description"] || "",
    "application-link": f.apply_link || "",
    department: f.category_name || "",
    "company-name": f.company_name || "",
  };
  if (Array.isArray(f.company_logo) && f.company_logo[0]) {
    fieldData["company-logo"] = { url: f.company_logo[0] };
  }
  return fieldData;
}

// Compares only the fields the sync manages, and only by the company-logo
// URL (not the full object Webflow returns), so re-runs with unchanged
// source data don't produce spurious updates/publishes.
function hasChanged(existingFieldData, nextFieldData) {
  const keys = ["name", "description", "meta-description", "application-link", "department", "company-name"];
  if (keys.some((k) => (existingFieldData[k] || "") !== (nextFieldData[k] || ""))) return true;
  const existingLogo = existingFieldData["company-logo"]?.url || "";
  const nextLogo = nextFieldData["company-logo"]?.url || "";
  return existingLogo !== nextLogo;
}

async function main() {
  const [jobs, existingItems] = await Promise.all([fetchJobs(), listAllItems()]);

  const existingBySourceId = new Map();
  const usedSlugs = new Set();
  for (const item of existingItems) {
    usedSlugs.add(item.fieldData.slug);
    if (item.fieldData["source-id"]) {
      existingBySourceId.set(item.fieldData["source-id"], item);
    }
  }

  const seenSourceIds = new Set();
  const toPublish = [];
  let created = 0;
  let updated = 0;
  let reactivated = 0;

  for (const record of jobs) {
    seenSourceIds.add(record.id);
    const nextFieldData = buildFieldData(record);
    const existing = existingBySourceId.get(record.id);

    if (!existing) {
      const slug = uniqueSlug(slugify(`${nextFieldData.name}-${nextFieldData["company-name"]}`), usedSlugs);
      const item = await webflow(`/collections/${COLLECTION_ID}/items`, {
        method: "POST",
        body: JSON.stringify({ isArchived: false, isDraft: false, fieldData: { ...nextFieldData, slug } }),
      });
      toPublish.push(item.id);
      created += 1;
      continue;
    }

    const changed = hasChanged(existing.fieldData, nextFieldData);
    const wasArchived = existing.isArchived;
    if (changed || wasArchived) {
      await webflow(`/collections/${COLLECTION_ID}/items/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isArchived: false, fieldData: nextFieldData }),
      });
      toPublish.push(existing.id);
      if (wasArchived) reactivated += 1;
      if (changed) updated += 1;
    }
  }

  // Only archive items this script created (they carry a source-id) so
  // manually-added Careers entries are never touched.
  const stale = existingItems.filter(
    (item) => item.fieldData["source-id"] && !seenSourceIds.has(item.fieldData["source-id"]) && !item.isArchived
  );
  for (const item of stale) {
    await webflow(`/collections/${COLLECTION_ID}/items/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isArchived: true }),
    });
  }

  for (let i = 0; i < toPublish.length; i += 100) {
    await webflow(`/collections/${COLLECTION_ID}/items/publish`, {
      method: "POST",
      body: JSON.stringify({ itemIds: toPublish.slice(i, i + 100) }),
    });
  }

  console.log(
    `Sync complete: ${created} created, ${updated} updated, ${reactivated} reactivated, ${stale.length} archived.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
