import { AccountError } from "./account-service.mjs";

const accessStates = new Set(["active", "trial", "graceOrBillingRetry", "upgraded", "downgraded"]);
const subscriptionStates = new Set(["active", "trial", "graceOrBillingRetry", "expired", "revokedOrRefunded", "upgraded", "downgraded", "unknown"]);
const cohorts = new Set(["all", "onboarded", "plan_adopters", "subscribers"]);
const cohortDimensions = new Set(["registration_week", "first_plan_week"]);
const minimumCohortSize = 5;
const acquisitionSources = new Set(["unknown", "organic", "app_store_search", "referral", "paid_social"]);

const metricDefinitions = [
  { id: "registered_users", label: "New accounts", format: "integer", formula: "Count of non-disabled internal users created inside the selected local-date window." },
  { id: "onboarding_completion_rate", label: "Onboarding completion", format: "percentage", formula: "Distinct users whose first saved profile falls inside the window ÷ accounts created inside the window." },
  { id: "plan_generation_success_rate", label: "Plan success", format: "percentage", formula: "Succeeded plan jobs created inside the window ÷ terminal succeeded, rejected, or failed plan jobs created inside the window." },
  { id: "plan_adoption_rate", label: "Plan adoption", format: "percentage", formula: "Distinct users adopting a plan inside the window ÷ distinct users with a succeeded plan job inside the window." },
  { id: "weekly_review_rate", label: "Weekly review", format: "percentage", formula: "Distinct users submitting a weekly review inside the window ÷ distinct users adopting a plan inside the window." },
  { id: "meal_completion_rate", label: "Meal completion", format: "percentage", formula: "Meal states marked completed inside the window ÷ completed, skipped, or replaced-outside-app states updated inside the window." },
  { id: "verified_access_users", label: "Verified access now", format: "integer", formula: "Count of filtered users whose latest server-owned subscription snapshot is in an access-granting state at dashboard freshness time; the date window does not change this snapshot metric." },
];

const funnelDefinitions = [
  { id: "registered", label: "Registered", formula: "Distinct cohort users at the selected cohort-start milestone." },
  { id: "onboarded", label: "Profile saved", formula: "Cohort users with at least one saved profile by the selected end date." },
  { id: "generated", label: "Plan generated", formula: "Cohort users with at least one succeeded plan job by the selected end date." },
  { id: "adopted", label: "Plan adopted", formula: "Cohort users with at least one plan adoption by the selected end date." },
  { id: "reviewed", label: "Weekly review", formula: "Cohort users with at least one weekly plan review by the selected end date." },
];

export class AnalyticsOperationsService {
  constructor({ dataset = {}, now = () => new Date() } = {}) {
    this.dataset = {
      users: dataset.users ?? [], profiles: dataset.profiles ?? [], subscriptions: dataset.subscriptions ?? [],
      planJobs: dataset.planJobs ?? [], planAdoptions: dataset.planAdoptions ?? [], weeklyReviews: dataset.weeklyReviews ?? [],
      mealStates: dataset.mealStates ?? [], dimensions: dataset.dimensions ?? [],
    };
    this.now = now;
  }

  async kpis(request = {}) {
    const filters = parseFilters(request, this.now());
    const users = filteredUsers(this.dataset, filters);
    const userIDs = new Set(users.map((user) => user.id));
    const inWindow = (value) => within(value, filters.startAt, filters.endAt);
    const registrations = users.filter((user) => inWindow(user.createdAt));
    const onboarded = uniqueUsers(this.dataset.profiles.filter((item) => userIDs.has(item.userID) && inWindow(item.createdAt)));
    const terminalJobs = this.dataset.planJobs.filter((item) => userIDs.has(item.userID) && inWindow(item.createdAt) && ["succeeded", "rejected", "failed"].includes(item.state));
    const succeededJobs = terminalJobs.filter((item) => item.state === "succeeded");
    const generatedUsers = uniqueUsers(succeededJobs);
    const adoptedUsers = uniqueUsers(this.dataset.planAdoptions.filter((item) => userIDs.has(item.userID) && inWindow(item.adoptedAt)));
    const reviewedUsers = uniqueUsers(this.dataset.weeklyReviews.filter((item) => userIDs.has(item.userID) && inWindow(item.submittedAt)));
    const decidedMeals = this.dataset.mealStates.filter((item) => userIDs.has(item.userID) && inWindow(item.updatedAt) && ["completed", "skipped", "replaced_outside_app"].includes(item.completionState));
    const completedMeals = decidedMeals.filter((item) => item.completionState === "completed");
    const verifiedAccessUsers = users.filter((user) => {
      const entitlement = this.dataset.subscriptions.find((item) => item.userID === user.id);
      return entitlement && accessStates.has(entitlement.state);
    }).length;
    const values = {
      registered_users: countValue(registrations.length),
      onboarding_completion_rate: rateValue(onboarded.size, registrations.length),
      plan_generation_success_rate: rateValue(succeededJobs.length, terminalJobs.length),
      plan_adoption_rate: rateValue(adoptedUsers.size, generatedUsers.size),
      weekly_review_rate: rateValue(reviewedUsers.size, adoptedUsers.size),
      meal_completion_rate: rateValue(completedMeals.length, decidedMeals.length),
      verified_access_users: countValue(verifiedAccessUsers),
    };
    return analyticsPayload(filters, values, freshness(this.dataset, this.now()), users.length);
  }

  async cohorts(request = {}) {
    const filters = parseFilters(request, this.now());
    const users = filteredUsers(this.dataset, filters);
    const milestones = users.map((user) => memoryMilestones(user, this.dataset, filters.cohortBy))
      .filter((item) => item.cohortAt && within(item.cohortAt, filters.startAt, filters.endAt));
    const grouped = new Map();
    for (const item of milestones) {
      const key = localWeekStart(item.cohortAt, filters.timeZone);
      const row = grouped.get(key) ?? { cohortStart: key, registeredUsers: 0, onboardedUsers: 0, generatedUsers: 0, adoptedUsers: 0, reviewedUsers: 0 };
      row.registeredUsers += 1;
      if (item.onboardedAt && item.onboardedAt <= filters.endAt) row.onboardedUsers += 1;
      if (item.generatedAt && item.generatedAt <= filters.endAt) row.generatedUsers += 1;
      if (item.adoptedAt && item.adoptedAt <= filters.endAt) row.adoptedUsers += 1;
      if (item.reviewedAt && item.reviewedAt <= filters.endAt) row.reviewedUsers += 1;
      grouped.set(key, row);
    }
    const rows = [...grouped.values()].sort((left, right) => left.cohortStart.localeCompare(right.cohortStart)).map(addConversions);
    return cohortPayload(filters, rows, freshness(this.dataset, this.now()));
  }

  async recordDimensions({ userID, appVersion, acquisitionSource }) {
    const input = normalizeDimensions({ userID, appVersion, acquisitionSource });
    const now = this.now();
    let dimension = this.dataset.dimensions.find((item) => item.userID === input.userID);
    if (!dimension) {
      dimension = {
        userID: input.userID, firstAppVersion: input.appVersion, latestAppVersion: input.appVersion,
        acquisitionSource: input.acquisitionSource, firstSeenAt: now, updatedAt: now,
      };
      this.dataset.dimensions.push(dimension);
    } else {
      dimension.latestAppVersion = input.appVersion;
      dimension.acquisitionSource = resolvedAcquisition(dimension.acquisitionSource, input.acquisitionSource);
      dimension.updatedAt = now;
    }
    return publicDimension(dimension);
  }
}

export class PostgresAnalyticsOperationsService {
  constructor({ pool, now = () => new Date() } = {}) {
    if (!pool?.query) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.now = now;
  }

  async kpis(request = {}) {
    const filters = parseFilters(request, this.now());
    const result = await this.pool.query(kpiQuery(), filterValues(filters, false));
    const row = result.rows[0] ?? {};
    const values = {
      registered_users: countValue(number(row.registered_users)),
      onboarding_completion_rate: rateValue(number(row.onboarded_users), number(row.registered_users)),
      plan_generation_success_rate: rateValue(number(row.succeeded_jobs), number(row.terminal_jobs)),
      plan_adoption_rate: rateValue(number(row.adopted_users), number(row.generated_users)),
      weekly_review_rate: rateValue(number(row.reviewed_users), number(row.adopted_users)),
      meal_completion_rate: rateValue(number(row.completed_meals), number(row.decided_meals)),
      verified_access_users: countValue(number(row.verified_access_users)),
    };
    return analyticsPayload(filters, values, row.freshness_at ? new Date(row.freshness_at) : this.now(), number(row.population_users));
  }

  async cohorts(request = {}) {
    const filters = parseFilters(request, this.now());
    const result = await this.pool.query(cohortQuery(), filterValues(filters, true));
    const rows = result.rows.map((row) => addConversions({
      cohortStart: dateValue(row.cohort_start), registeredUsers: number(row.registered_users),
      onboardedUsers: number(row.onboarded_users), generatedUsers: number(row.generated_users),
      adoptedUsers: number(row.adopted_users), reviewedUsers: number(row.reviewed_users),
    }));
    const freshnessAt = result.rows.reduce((latest, row) => latestDate(latest, row.freshness_at), null) ?? this.now();
    return cohortPayload(filters, rows, freshnessAt);
  }

  async recordDimensions({ userID, appVersion, acquisitionSource }) {
    const input = normalizeDimensions({ userID, appVersion, acquisitionSource });
    const now = this.now();
    const result = await this.pool.query(
      `INSERT INTO user_analytics_dimensions (
          user_id, first_app_version, latest_app_version, acquisition_source, first_seen_at, updated_at
       ) VALUES ($1, $2, $2, $3, $4, $4)
       ON CONFLICT (user_id) DO UPDATE SET
          latest_app_version = EXCLUDED.latest_app_version,
          acquisition_source = CASE
            WHEN user_analytics_dimensions.acquisition_source = 'unknown'
              AND EXCLUDED.acquisition_source <> 'unknown' THEN EXCLUDED.acquisition_source
            ELSE user_analytics_dimensions.acquisition_source
          END,
          updated_at = EXCLUDED.updated_at
       RETURNING user_id, first_app_version, latest_app_version, acquisition_source, first_seen_at, updated_at`,
      [input.userID, input.appVersion, input.acquisitionSource, now],
    );
    return publicDimension(mapDimension(result.rows[0]));
  }
}

function normalizeDimensions({ userID, appVersion, acquisitionSource }) {
  const normalizedUserID = String(userID ?? "").trim();
  if (!normalizedUserID) throw new AccountError("AUTHENTICATION_REQUIRED", "Please sign in again.", 401);
  const normalizedVersion = String(appVersion ?? "").trim();
  if (!/^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/.test(normalizedVersion) || normalizedVersion.length > 80) {
    throw new AccountError("VALIDATION_ERROR", "App version must use a bounded numeric semantic form.");
  }
  const normalizedSource = String(acquisitionSource ?? "unknown").trim().toLowerCase();
  if (!acquisitionSources.has(normalizedSource)) throw new AccountError("VALIDATION_ERROR", "Choose a supported acquisition source.");
  return { userID: normalizedUserID, appVersion: normalizedVersion, acquisitionSource: normalizedSource };
}

function resolvedAcquisition(current, incoming) {
  return (!current || current === "unknown") && incoming !== "unknown" ? incoming : current || incoming;
}

function publicDimension(dimension) {
  return {
    firstAppVersion: dimension.firstAppVersion,
    latestAppVersion: dimension.latestAppVersion,
    acquisitionSource: dimension.acquisitionSource,
    firstSeenAt: dimension.firstSeenAt,
    updatedAt: dimension.updatedAt,
    contractVersion: "analytics-dimensions-v1",
  };
}

function mapDimension(row) {
  if (!row) throw new AccountError("TEMPORARY_FAILURE", "Analytics dimensions could not be saved.", 503);
  return {
    userID: row.user_id, firstAppVersion: row.first_app_version, latestAppVersion: row.latest_app_version,
    acquisitionSource: row.acquisition_source, firstSeenAt: new Date(row.first_seen_at), updatedAt: new Date(row.updated_at),
  };
}

function kpiQuery() {
  return `${analyticsCTEs()}, window_events AS (
    SELECT
      (SELECT count(*) FROM scoped_users, boundaries WHERE created_at >= start_at AND created_at < end_at) AS registered_users,
      (SELECT count(DISTINCT profile.user_id) FROM profiles profile JOIN scoped_users scoped ON scoped.user_id = profile.user_id, boundaries WHERE profile.created_at >= start_at AND profile.created_at < end_at) AS onboarded_users,
      (SELECT count(*) FROM plan_jobs job JOIN scoped_users scoped ON scoped.user_id = job.user_id, boundaries WHERE job.created_at >= start_at AND job.created_at < end_at AND job.state IN ('succeeded', 'rejected', 'failed')) AS terminal_jobs,
      (SELECT count(*) FROM plan_jobs job JOIN scoped_users scoped ON scoped.user_id = job.user_id, boundaries WHERE job.created_at >= start_at AND job.created_at < end_at AND job.state = 'succeeded') AS succeeded_jobs,
      (SELECT count(DISTINCT job.user_id) FROM plan_jobs job JOIN scoped_users scoped ON scoped.user_id = job.user_id, boundaries WHERE job.created_at >= start_at AND job.created_at < end_at AND job.state = 'succeeded') AS generated_users,
      (SELECT count(DISTINCT adoption.user_id) FROM plan_adoptions adoption JOIN scoped_users scoped ON scoped.user_id = adoption.user_id, boundaries WHERE adoption.adopted_at >= start_at AND adoption.adopted_at < end_at) AS adopted_users,
      (SELECT count(DISTINCT review.user_id) FROM weekly_plan_reviews review JOIN scoped_users scoped ON scoped.user_id = review.user_id, boundaries WHERE review.submitted_at >= start_at AND review.submitted_at < end_at) AS reviewed_users,
      (SELECT count(*) FROM plan_item_operational_states state JOIN scoped_users scoped ON scoped.user_id = state.user_id, boundaries WHERE state.updated_at >= start_at AND state.updated_at < end_at AND state.completion_state IN ('completed', 'skipped', 'replaced_outside_app')) AS decided_meals,
      (SELECT count(*) FROM plan_item_operational_states state JOIN scoped_users scoped ON scoped.user_id = state.user_id, boundaries WHERE state.updated_at >= start_at AND state.updated_at < end_at AND state.completion_state = 'completed') AS completed_meals,
      (SELECT count(*) FROM scoped_users WHERE subscription_state IN ('active', 'trial', 'graceOrBillingRetry', 'upgraded', 'downgraded')) AS verified_access_users,
      (SELECT count(*) FROM scoped_users) AS population_users,
      GREATEST(
        (SELECT max(created_at) FROM users), (SELECT max(updated_at) FROM profiles),
        (SELECT max(updated_at) FROM subscriptions), (SELECT max(completed_at) FROM plan_jobs),
        (SELECT max(adopted_at) FROM plan_adoptions), (SELECT max(submitted_at) FROM weekly_plan_reviews),
        (SELECT max(updated_at) FROM plan_item_operational_states)
      ) AS freshness_at
  ) SELECT * FROM window_events`;
}

function cohortQuery() {
  return `${analyticsCTEs()}, milestones AS (
    SELECT scoped.user_id, scoped.created_at AS registered_at,
      profile.created_at AS onboarded_at,
      generated.generated_at, adopted.adopted_at, reviewed.reviewed_at,
      CASE WHEN $9 = 'first_plan_week' THEN generated.generated_at ELSE scoped.created_at END AS cohort_at
    FROM scoped_users scoped
    LEFT JOIN LATERAL (SELECT min(created_at) AS created_at FROM profiles WHERE user_id = scoped.user_id) profile ON true
    LEFT JOIN LATERAL (SELECT min(created_at) AS generated_at FROM plan_jobs WHERE user_id = scoped.user_id AND state = 'succeeded') generated ON true
    LEFT JOIN LATERAL (SELECT min(adopted_at) AS adopted_at FROM plan_adoptions WHERE user_id = scoped.user_id) adopted ON true
    LEFT JOIN LATERAL (SELECT min(submitted_at) AS reviewed_at FROM weekly_plan_reviews WHERE user_id = scoped.user_id) reviewed ON true
  ), cohort_rows AS (
    SELECT date_trunc('week', milestone.cohort_at AT TIME ZONE $3)::date AS cohort_start,
      count(*) AS registered_users,
      count(*) FILTER (WHERE milestone.onboarded_at < boundary.end_at) AS onboarded_users,
      count(*) FILTER (WHERE milestone.generated_at < boundary.end_at) AS generated_users,
      count(*) FILTER (WHERE milestone.adopted_at < boundary.end_at) AS adopted_users,
      count(*) FILTER (WHERE milestone.reviewed_at < boundary.end_at) AS reviewed_users
    FROM milestones milestone CROSS JOIN boundaries boundary
    WHERE milestone.cohort_at >= boundary.start_at AND milestone.cohort_at < boundary.end_at
    GROUP BY 1
  ) SELECT cohort_rows.*,
      GREATEST((SELECT max(created_at) FROM users), (SELECT max(completed_at) FROM plan_jobs),
               (SELECT max(adopted_at) FROM plan_adoptions), (SELECT max(submitted_at) FROM weekly_plan_reviews)) AS freshness_at
    FROM cohort_rows ORDER BY cohort_start`;
}

function analyticsCTEs() {
  return `WITH boundaries AS (
    SELECT ($1::date::timestamp AT TIME ZONE $3) AS start_at,
           (($2::date + 1)::timestamp AT TIME ZONE $3) AS end_at
  ), scoped_users AS (
    SELECT account.id AS user_id, account.created_at,
           profile.profile_json->>'diet' AS diet_type,
           subscription.state AS subscription_state,
           COALESCE(dimension.latest_app_version, 'unknown') AS app_version,
           COALESCE(dimension.acquisition_source, 'unknown') AS acquisition_source
      FROM users account
      LEFT JOIN profiles profile ON profile.user_id = account.id
      LEFT JOIN subscriptions subscription ON subscription.user_id = account.id
      LEFT JOIN user_analytics_dimensions dimension ON dimension.user_id = account.id
     WHERE account.disabled_at IS NULL
       AND ($4::text IS NULL OR subscription.state = $4)
       AND ($5::text IS NULL OR COALESCE(dimension.latest_app_version, 'unknown') = $5)
       AND ($6::text IS NULL OR COALESCE(dimension.acquisition_source, 'unknown') = $6)
       AND ($7::text IS NULL OR profile.profile_json->>'diet' = $7)
       AND ($8 = 'all'
         OR ($8 = 'onboarded' AND profile.user_id IS NOT NULL)
         OR ($8 = 'plan_adopters' AND EXISTS (SELECT 1 FROM plan_adoptions adoption WHERE adoption.user_id = account.id))
         OR ($8 = 'subscribers' AND subscription.state IN ('active', 'trial', 'graceOrBillingRetry', 'upgraded', 'downgraded')))
  )`;
}

function filteredUsers(dataset, filters) {
  return dataset.users.filter((user) => {
    if (user.disabledAt) return false;
    const profile = dataset.profiles.find((item) => item.userID === user.id);
    const subscription = dataset.subscriptions.find((item) => item.userID === user.id);
    const dimension = dataset.dimensions.find((item) => item.userID === user.id) ?? {};
    if (filters.subscriptionState && subscription?.state !== filters.subscriptionState) return false;
    if (filters.appVersion && (dimension.latestAppVersion ?? "unknown") !== filters.appVersion) return false;
    if (filters.acquisitionSource && (dimension.acquisitionSource ?? "unknown") !== filters.acquisitionSource) return false;
    if (filters.dietType && profile?.dietType !== filters.dietType) return false;
    if (filters.cohort === "onboarded" && !profile) return false;
    if (filters.cohort === "plan_adopters" && !dataset.planAdoptions.some((item) => item.userID === user.id)) return false;
    if (filters.cohort === "subscribers" && !accessStates.has(subscription?.state)) return false;
    return true;
  });
}

function memoryMilestones(user, dataset, cohortBy) {
  const earliest = (items, key) => {
    const value = items.sort((left, right) => new Date(left[key]) - new Date(right[key]))[0]?.[key];
    return value ? new Date(value) : null;
  };
  const generatedAt = earliest(dataset.planJobs.filter((item) => item.userID === user.id && item.state === "succeeded"), "createdAt");
  return {
    cohortAt: cohortBy === "first_plan_week" ? generatedAt : new Date(user.createdAt),
    onboardedAt: earliest(dataset.profiles.filter((item) => item.userID === user.id), "createdAt"), generatedAt,
    adoptedAt: earliest(dataset.planAdoptions.filter((item) => item.userID === user.id), "adoptedAt"),
    reviewedAt: earliest(dataset.weeklyReviews.filter((item) => item.userID === user.id), "submittedAt"),
  };
}

function analyticsPayload(filters, values, freshnessAt, populationSize) {
  const suppressed = populationSize > 0 && populationSize < minimumCohortSize;
  return {
    filters: publicFilters(filters), freshnessAt,
    metrics: metricDefinitions.map((definition) => ({ ...definition, ...(suppressed ? { value: null, numerator: null, denominator: null, suppressed: true } : values[definition.id]) })),
    privacy: { aggregationOnly: true, minimumCohortSize, populationSize, suppressed, identifiableFieldsReturned: [] },
  };
}

function cohortPayload(filters, rows, freshnessAt) {
  const totals = rows.reduce((sum, row) => ({
    registered: sum.registered + row.registeredUsers, onboarded: sum.onboarded + row.onboardedUsers,
    generated: sum.generated + row.generatedUsers, adopted: sum.adopted + row.adoptedUsers,
    reviewed: sum.reviewed + row.reviewedUsers,
  }), { registered: 0, onboarded: 0, generated: 0, adopted: 0, reviewed: 0 });
  const suppressed = totals.registered > 0 && totals.registered < minimumCohortSize;
  let previous = null;
  const funnel = funnelDefinitions.map((definition) => {
    const count = totals[definition.id];
    const conversionFromPrevious = previous == null ? 1 : previous ? count / previous : null;
    previous = count;
    return { ...definition, count: suppressed ? null : count, conversionFromPrevious: suppressed ? null : conversionFromPrevious, suppressed };
  });
  const publicRows = rows.map((row) => row.registeredUsers > 0 && row.registeredUsers < minimumCohortSize
    ? { cohortStart: row.cohortStart, registeredUsers: null, onboardedUsers: null, generatedUsers: null, adoptedUsers: null, reviewedUsers: null, onboardingRate: null, generationRate: null, adoptionRate: null, reviewRate: null, suppressed: true }
    : row);
  return {
    filters: publicFilters(filters), freshnessAt, cohortDimension: filters.cohortBy,
    funnel, rows: publicRows, tableColumns: [
      { id: "cohortStart", label: "Cohort week" }, { id: "registeredUsers", label: "Registered" },
      { id: "onboardedUsers", label: "Profile saved" }, { id: "generatedUsers", label: "Plan generated" },
      { id: "adoptedUsers", label: "Plan adopted" }, { id: "reviewedUsers", label: "Weekly review" },
    ],
    privacy: { aggregationOnly: true, minimumCohortSize, populationSize: totals.registered, suppressed, identifiableFieldsReturned: [] },
  };
}

function parseFilters(request, now) {
  const today = dateValue(now);
  const endDate = validDate(request.endDate ?? today, "end date");
  const fallbackStart = new Date(`${endDate}T00:00:00.000Z`); fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 27);
  const startDate = validDate(request.startDate ?? dateValue(fallbackStart), "start date");
  if (startDate > endDate) throw validation("The analytics start date must not be after the end date.");
  if ((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86_400_000 > 366) throw validation("Analytics date ranges are limited to 367 days.");
  const timeZone = String(request.timeZone ?? "UTC");
  try { new Intl.DateTimeFormat("en", { timeZone }).format(now); } catch { throw validation("The analytics timezone is invalid."); }
  const subscriptionState = optionalEnum(request.subscriptionState, subscriptionStates, "subscription state");
  const cohort = String(request.cohort ?? "all"); if (!cohorts.has(cohort)) throw validation("The analytics cohort filter is invalid.");
  const cohortBy = String(request.cohortBy ?? "registration_week"); if (!cohortDimensions.has(cohortBy)) throw validation("The cohort dimension is invalid.");
  const filters = {
    startDate, endDate, timeZone, subscriptionState,
    appVersion: optionalDimension(request.appVersion, "app version"),
    acquisitionSource: optionalDimension(request.acquisitionSource, "acquisition source"),
    dietType: optionalDimension(request.dietType, "diet type"), cohort, cohortBy,
  };
  filters.startAt = new Date(`${startDate}T00:00:00.000Z`);
  filters.endAt = new Date(`${endDate}T23:59:59.999Z`);
  return filters;
}

function filterValues(filters, includeCohortBy) {
  const values = [filters.startDate, filters.endDate, filters.timeZone, filters.subscriptionState,
    filters.appVersion, filters.acquisitionSource, filters.dietType, filters.cohort];
  if (includeCohortBy) values.push(filters.cohortBy);
  return values;
}

function publicFilters(filters) {
  return { startDate: filters.startDate, endDate: filters.endDate, timeZone: filters.timeZone,
    subscriptionState: filters.subscriptionState ?? "all", appVersion: filters.appVersion ?? "all",
    acquisitionSource: filters.acquisitionSource ?? "all", dietType: filters.dietType ?? "all",
    cohort: filters.cohort, cohortBy: filters.cohortBy };
}

function countValue(value) { return { value, numerator: value, denominator: null }; }
function rateValue(numerator, denominator) { return { value: denominator ? numerator / denominator : null, numerator, denominator }; }
function uniqueUsers(items) { return new Set(items.map((item) => item.userID)); }
function within(value, start, end) { const date = new Date(value); return date >= start && date <= end; }
function number(value) { return Number(value ?? 0); }
function dateValue(value) { return new Date(value).toISOString().slice(0, 10); }
function validDate(value, label) { const text = String(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())) throw validation(`The analytics ${label} is invalid.`); return text; }
function optionalEnum(value, allowed, label) { if (value == null || value === "" || value === "all") return null; if (!allowed.has(value)) throw validation(`The analytics ${label} filter is invalid.`); return value; }
function optionalDimension(value, label) { if (value == null || value === "" || value === "all") return null; const text = String(value).trim(); if (!/^[A-Za-z0-9._ -]{1,80}$/.test(text)) throw validation(`The analytics ${label} filter is invalid.`); return text; }
function validation(message) { return new AccountError("VALIDATION_ERROR", message, 400); }
function latestDate(current, value) { if (!value) return current; const date = new Date(value); return !current || date > current ? date : current; }
function freshness(dataset, fallback) {
  let latest = null;
  for (const [items, keys] of [[dataset.users, ["createdAt"]], [dataset.profiles, ["updatedAt", "createdAt"]], [dataset.subscriptions, ["updatedAt", "lastVerifiedAt"]], [dataset.planJobs, ["completedAt", "createdAt"]], [dataset.planAdoptions, ["adoptedAt"]], [dataset.weeklyReviews, ["submittedAt"]], [dataset.mealStates, ["updatedAt"]]]) {
    for (const item of items) for (const key of keys) latest = latestDate(latest, item[key]);
  }
  return latest ?? (typeof fallback === "function" ? fallback() : fallback);
}
function localWeekStart(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const date = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
  const day = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 })[get("weekday")] ?? 0;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}
function addConversions(row) {
  return { ...row,
    onboardingRate: row.registeredUsers ? row.onboardedUsers / row.registeredUsers : null,
    generationRate: row.registeredUsers ? row.generatedUsers / row.registeredUsers : null,
    adoptionRate: row.generatedUsers ? row.adoptedUsers / row.generatedUsers : null,
    reviewRate: row.adoptedUsers ? row.reviewedUsers / row.adoptedUsers : null,
  };
}
