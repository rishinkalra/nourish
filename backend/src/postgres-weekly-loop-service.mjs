import { createHash } from "node:crypto";
import { withTransaction } from "./database.mjs";
import { buildDurableSwapSuccessor, buildPreservedSwapOperations, localDateKey } from "./durable-swap.mjs";
import { WELLNESS_SCORE_V2, PlanError, analyzeVariety, eligibilityReasons, scoreRecipe } from "./planner-service.mjs";
import { deterministicUUID, isUUID } from "./stable-identifiers.mjs";

export class PostgresWeeklyLoopService {
  constructor({ pool, planService, catalogueReader, scoringConfiguration = WELLNESS_SCORE_V2, now = () => new Date() }) {
    if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
    this.pool = pool;
    this.planService = planService;
    this.catalogueReader = catalogueReader;
    this.scoringConfiguration = scoringConfiguration;
    this.now = now;
  }

  async readActive(userID) {
    const active = await this.planService.readActive(userID);
    const [groceryList, prep, mealStates] = await Promise.all([
      this.#readGroceryForPlan(active.plan.id, userID),
      this.pool.query(
        `SELECT task.* FROM prep_tasks task
         JOIN weekly_plans plan ON plan.id = task.weekly_plan_id
         WHERE task.weekly_plan_id = $1 AND plan.user_id = $2
         ORDER BY task.local_date, task.title`,
        [active.plan.id, userID],
      ),
      this.pool.query(
        `SELECT state.plan_item_id, state.completion_state, state.revision
           FROM plan_item_operational_states state
           JOIN plan_items item ON item.id = state.plan_item_id
           JOIN weekly_plans plan ON plan.id = item.weekly_plan_id
          WHERE plan.id = $1 AND state.user_id = $2`,
        [active.plan.id, userID],
      ),
    ]);
    const stateByItem = new Map(mealStates.rows.map((row) => [row.plan_item_id, row]));
    for (const item of active.plan.days.flatMap((day) => day.items)) {
      const state = stateByItem.get(item.id);
      if (state) item.completionState = stateFromDatabase(state.completion_state);
    }
    const prepTasks = prep.rows.map(mapPrepTask);
    return {
      plan: active.plan,
      diagnostics: active.diagnostics,
      groceryList,
      prepTimeline: { planID: active.plan.id, tasks: prepTasks },
      revision: groceryList.revision,
      operationalRevisions: {
        grocery: groceryList.revision,
        meals: Object.fromEntries(active.plan.days.flatMap((day) => day.items).map((item) => [item.id, Number(stateByItem.get(item.id)?.revision ?? 0)])),
        prep: Object.fromEntries(prepTasks.map((task) => [task.id, task.revision])),
      },
    };
  }

  async swapCandidates({ itemID, userID, profile }) {
    if (!profile) throw new PlanError("PROFILE_INELIGIBLE", "Complete your planning profile first.", 422);
    const { plan, item } = await this.#findItem(itemID, userID);
    if (hasLinkedReuse(plan, item)) return [];
    const recipes = await this.catalogueReader.publishedSnapshots();
    const activeSlots = [...new Set(plan.days.flatMap((day) => day.items.map((planItem) => planItem.slot)))];
    const existingIngredientIDs = ingredientsOutsideItem(plan, itemID);
    return recipes.filter((recipe) => (
      recipe.recipeID !== item.recipeSnapshot.recipeID
      && eligibilityReasons(recipe, profile, item.slot, this.scoringConfiguration).length === 0
      && resultingVariety(plan, item.id, recipe).passed
    )).map((recipe) => {
      const breakdown = scoreRecipe(recipe, profile, item.slot, activeSlots, this.scoringConfiguration, existingIngredientIDs);
      const nutrition = scaledNutrition(recipe.nutritionPerServing, breakdown.servingMultiplier);
      return {
        recipe,
        servingMultiplier: breakdown.servingMultiplier,
        rankingScore: breakdown.total,
        calorieDelta: Number(nutrition.calories) - Number(item.nutrition.calories),
        proteinDeltaGrams: Number(nutrition.proteinGrams) - Number(item.nutrition.proteinGrams),
      };
    }).sort((left, right) => (
      left.rankingScore - right.rankingScore
      || Math.abs(left.calorieDelta) - Math.abs(right.calorieDelta)
      || left.recipe.recipeID.localeCompare(right.recipe.recipeID)
    )).map(({ rankingScore: _rankingScore, ...candidate }) => candidate);
  }

  async applySwap({ itemID, replacementRecipeID, userID, profile, idempotencyKey }) {
    if (!idempotencyKey) throw new PlanError("VALIDATION_ERROR", "An idempotency key is required.", 400);
    const replay = await this.#findSwapMutation(userID, idempotencyKey);
    if (replay) return this.#swapReceipt(replay, userID);

    const { record, plan, item } = await this.#findItem(itemID, userID);
    if (!profile) throw new PlanError("PROFILE_INELIGIBLE", "Complete your planning profile first.", 422);
    if (hasLinkedReuse(plan, item)) {
      throw new PlanError("CONFLICT", "This meal supplies planned leftovers. Regenerate those linked meals together.", 409, true);
    }
    const recipes = await this.catalogueReader.publishedSnapshots();
    const replacement = recipes.find((recipe) => recipe.recipeID === replacementRecipeID);
    if (!replacement) throw new PlanError("VALIDATION_ERROR", "Swap recipe not found.", 404);
    const issues = eligibilityReasons(replacement, profile, item.slot, this.scoringConfiguration);
    if (issues.length) {
      throw new PlanError("VALIDATION_ERROR", "This swap no longer satisfies your safety rules.", 422, false, { eligibilityIssues: issues });
    }
    const activeSlots = [...new Set(plan.days.flatMap((day) => day.items.map((planItem) => planItem.slot)))];
    const servingMultiplier = scoreRecipe(
      replacement, profile, item.slot, activeSlots, this.scoringConfiguration, ingredientsOutsideItem(plan, itemID),
    ).servingMultiplier;
    const successor = buildDurableSwapSuccessor({
      sourcePlan: plan,
      sourceDiagnostics: record.diagnostics,
      sourceItemID: itemID,
      replacement,
      servingMultiplier,
      userID,
      idempotencyKey,
    });
    const swappedAt = this.now();
    const outcome = await withTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`meal-swap:${userID}:${idempotencyKey}`],
      );
      const existing = await findSwapMutation(client, userID, idempotencyKey);
      if (existing) return { replay: existing };
      const locked = await client.query(
        `SELECT item.id, item.weekly_plan_id
           FROM plan_items item
           JOIN weekly_plans plan ON plan.id = item.weekly_plan_id
          WHERE item.id = $1 AND item.weekly_plan_id = $2 AND plan.user_id = $3
          FOR UPDATE OF item`,
        [itemID, plan.id, userID],
      );
      if (!locked.rows[0]) throw new PlanError("CONFLICT", "This plan changed before the swap could be saved.", 409, true);
      const profileResult = await client.query("SELECT revision, profile_json FROM profiles WHERE user_id = $1 FOR SHARE", [userID]);
      if (!profileResult.rows[0]) throw new PlanError("PROFILE_INELIGIBLE", "Complete your planning profile first.", 422);
      const currentIssues = eligibilityReasons(replacement, profileResult.rows[0].profile_json, item.slot, this.scoringConfiguration);
      if (currentIssues.length) {
        throw new PlanError("VALIDATION_ERROR", "This swap no longer satisfies your safety rules.", 422, false, { eligibilityIssues: currentIssues });
      }
      const currentServingMultiplier = scoreRecipe(
        replacement,
        profileResult.rows[0].profile_json,
        item.slot,
        activeSlots,
        this.scoringConfiguration,
        ingredientsOutsideItem(plan, itemID),
      ).servingMultiplier;
      if (currentServingMultiplier !== servingMultiplier) {
        throw new PlanError("CONFLICT", "Your planning targets changed before this swap could be saved. Review the updated comparison.", 409, true);
      }

      const [previousGrocery, previousPrep, previousMealStates, adoptionResult] = await Promise.all([
        readGroceryForPlan(client, plan.id, userID),
        readPrepForPlan(client, plan.id, userID),
        client.query(
          `SELECT state.plan_item_id, state.completion_state, state.revision, state.updated_at
             FROM plan_item_operational_states state
             JOIN plan_items item ON item.id = state.plan_item_id
            WHERE state.user_id = $1 AND item.weekly_plan_id = $2`,
          [userID, plan.id],
        ),
        client.query(
          `SELECT id, adopted_at, activates_on, superseded_at
             FROM plan_adoptions
            WHERE user_id = $1 AND weekly_plan_id = $2
            ORDER BY adopted_at DESC LIMIT 1
            FOR UPDATE`,
          [userID, plan.id],
        ),
      ]);
      const adoption = adoptionResult.rows[0];
      if (adoption?.superseded_at) {
        throw new PlanError("CONFLICT", "A newer plan is already active. Refresh before swapping a meal.", 409, true);
      }
      const operations = buildPreservedSwapOperations({
        resultPlan: successor.resultPlan,
        oldToNew: successor.oldToNew,
        previousGroceryList: previousGrocery,
        previousPrepTimeline: previousPrep,
      });
      await persistSwapPlan(client, {
        userID,
        profileRevision: Number(profileResult.rows[0].revision),
        sourcePlanID: plan.id,
        sourceItemID: itemID,
        replacement,
        idempotencyKey,
        recipes,
        successor,
        operations,
        previousMealStates: previousMealStates.rows,
        adoption,
        swappedAt,
      });

      const stateByOldID = new Map(previousMealStates.rows.map((row) => [row.plan_item_id, row]));
      const oldByNewID = new Map([...successor.oldToNew].map(([oldID, newID]) => [newID, oldID]));
      for (const resultItem of successor.resultPlan.days.flatMap((day) => day.items)) {
        const oldID = oldByNewID.get(resultItem.id);
        const state = oldID === itemID ? null : stateByOldID.get(oldID);
        if (state) resultItem.completionState = stateFromDatabase(state.completion_state);
      }
      return {
        receipt: {
          plan: successor.resultPlan,
          groceryList: operations.groceryList,
          prepTimeline: operations.prepTimeline,
          revision: 1,
          supersedesPlanID: plan.id,
          swappedAt,
        },
      };
    });
    if (outcome.replay) return this.#swapReceipt(outcome.replay, userID);
    return outcome.receipt;
  }

  async readGroceryList(id, userID) {
    if (!isUUID(id)) throw new PlanError("VALIDATION_ERROR", "Grocery list not found.", 404);
    return this.#readGrocery(id, userID);
  }

  async updateGroceryList({ id, userID, expectedRevision, changes }) {
    if (!isUUID(id)) throw new PlanError("VALIDATION_ERROR", "Grocery list not found.", 404);
    await withTransaction(this.pool, async (client) => {
      const list = await client.query("SELECT id, revision FROM grocery_lists WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, userID]);
      if (!list.rows[0]) throw new PlanError("VALIDATION_ERROR", "Grocery list not found.", 404);
      if (Number(expectedRevision) !== Number(list.rows[0].revision)) throw new PlanError("CONFLICT", "This grocery list changed elsewhere.", 409, true);
      for (const change of changes ?? []) {
        if (!isUUID(change.itemID)) throw new PlanError("VALIDATION_ERROR", "Grocery item not found.", 404);
        if (change.disposition && !["needed", "checked", "alreadyHave"].includes(change.disposition)) {
          throw new PlanError("VALIDATION_ERROR", "Grocery disposition is invalid.", 400);
        }
        if (change.userAdjustedGrams !== undefined && change.userAdjustedGrams !== null && Number(change.userAdjustedGrams) <= 0) {
          throw new PlanError("VALIDATION_ERROR", "Quantity must be greater than zero.", 400);
        }
        const fields = [];
        const values = [change.itemID, id];
        if (change.disposition) {
          fields.push(`disposition = $${values.length + 1}`);
          values.push(dispositionToDatabase(change.disposition));
        }
        if (change.userAdjustedGrams !== undefined) {
          fields.push(`user_adjusted_grams = $${values.length + 1}`);
          values.push(change.userAdjustedGrams);
        }
        if (!fields.length) continue;
        const updated = await client.query(
          `UPDATE grocery_items SET ${fields.join(", ")} WHERE id = $1 AND grocery_list_id = $2 RETURNING id`,
          values,
        );
        if (!updated.rows[0]) throw new PlanError("VALIDATION_ERROR", "Grocery item not found.", 404);
      }
      await client.query("UPDATE grocery_lists SET revision = revision + 1, updated_at = $2 WHERE id = $1", [id, this.now()]);
    });
    return this.#readGrocery(id, userID);
  }

  async updateMealStatus({ itemID, userID, state, expectedRevision = 0 }) {
    if (!isUUID(itemID) || !["planned", "completed", "skipped", "replacedOutsideApp", "moved"].includes(state)) {
      throw new PlanError("VALIDATION_ERROR", "Meal status is invalid.", 400);
    }
    const updatedAt = this.now();
    return withTransaction(this.pool, async (client) => {
      const owned = await client.query(
        `SELECT item.id FROM plan_items item JOIN weekly_plans plan ON plan.id = item.weekly_plan_id
         WHERE item.id = $1 AND plan.user_id = $2`,
        [itemID, userID],
      );
      if (!owned.rows[0]) throw new PlanError("VALIDATION_ERROR", "Plan item not found.", 404);
      const current = await client.query(
        "SELECT revision FROM plan_item_operational_states WHERE user_id = $1 AND plan_item_id = $2 FOR UPDATE",
        [userID, itemID],
      );
      const revision = Number(current.rows[0]?.revision ?? 0);
      if (Number(expectedRevision) !== revision) throw new PlanError("CONFLICT", "This meal changed elsewhere.", 409, true);
      const result = await client.query(
        `INSERT INTO plan_item_operational_states (
            user_id, plan_item_id, completion_state, revision, updated_at
         ) VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (user_id, plan_item_id) DO UPDATE SET
            completion_state = EXCLUDED.completion_state,
            revision = plan_item_operational_states.revision + 1,
            updated_at = EXCLUDED.updated_at
         RETURNING revision`,
        [userID, itemID, stateToDatabase(state), updatedAt],
      );
      return { itemID, state, revision: Number(result.rows[0].revision), updatedAt };
    });
  }

  async updatePrepTask({ taskID, userID, isComplete, expectedRevision = 0 }) {
    if (!isUUID(taskID)) throw new PlanError("VALIDATION_ERROR", "Prep task not found.", 404);
    const updatedAt = this.now();
    const result = await this.pool.query(
      `UPDATE prep_tasks task
          SET is_complete = $3, revision = revision + 1, updated_at = $4
         FROM weekly_plans plan
        WHERE task.id = $1 AND task.weekly_plan_id = plan.id
          AND plan.user_id = $2 AND task.revision = $5
      RETURNING task.revision`,
      [taskID, userID, Boolean(isComplete), updatedAt, Number(expectedRevision) + 1],
    );
    if (!result.rows[0]) {
      const exists = await this.pool.query(
        `SELECT task.revision FROM prep_tasks task JOIN weekly_plans plan ON plan.id = task.weekly_plan_id
         WHERE task.id = $1 AND plan.user_id = $2`,
        [taskID, userID],
      );
      if (!exists.rows[0]) throw new PlanError("VALIDATION_ERROR", "Prep task not found.", 404);
      throw new PlanError("CONFLICT", "This prep task changed elsewhere.", 409, true);
    }
    return { taskID, isComplete: Boolean(isComplete), revision: Number(result.rows[0].revision) - 1, updatedAt };
  }

  async #findItem(itemID, userID) {
    if (!isUUID(itemID)) throw new PlanError("VALIDATION_ERROR", "Plan item not found.", 404);
    const selected = await this.pool.query(
      `SELECT item.weekly_plan_id FROM plan_items item JOIN weekly_plans plan ON plan.id = item.weekly_plan_id
       WHERE item.id = $1 AND plan.user_id = $2`,
      [itemID, userID],
    );
    if (!selected.rows[0]) throw new PlanError("VALIDATION_ERROR", "Plan item not found.", 404);
    const read = await this.planService.read(selected.rows[0].weekly_plan_id, userID);
    const item = read.plan.days.flatMap((day) => day.items).find((candidate) => candidate.id === itemID);
    return { record: read, plan: read.plan, item };
  }

  async #findSwapMutation(userID, idempotencyKey) {
    return findSwapMutation(this.pool, userID, idempotencyKey);
  }

  async #swapReceipt(mutation, userID) {
    const [record, groceryList, prepTimeline, mealStates] = await Promise.all([
      this.planService.read(mutation.result_weekly_plan_id, userID),
      this.#readGroceryForPlan(mutation.result_weekly_plan_id, userID),
      readPrepForPlan(this.pool, mutation.result_weekly_plan_id, userID),
      this.pool.query(
        `SELECT state.plan_item_id, state.completion_state
           FROM plan_item_operational_states state
           JOIN plan_items item ON item.id = state.plan_item_id
           JOIN weekly_plans plan ON plan.id = item.weekly_plan_id
          WHERE plan.id = $1 AND state.user_id = $2`,
        [mutation.result_weekly_plan_id, userID],
      ),
    ]);
    const stateByItem = new Map(mealStates.rows.map((row) => [row.plan_item_id, row.completion_state]));
    for (const item of record.plan.days.flatMap((day) => day.items)) {
      if (stateByItem.has(item.id)) item.completionState = stateFromDatabase(stateByItem.get(item.id));
    }
    return {
      plan: record.plan,
      groceryList,
      prepTimeline,
      revision: 1,
      supersedesPlanID: mutation.source_weekly_plan_id,
      swappedAt: new Date(mutation.created_at),
    };
  }

  async #readGroceryForPlan(planID, userID) {
    const selected = await this.pool.query("SELECT id FROM grocery_lists WHERE weekly_plan_id = $1 AND user_id = $2", [planID, userID]);
    if (!selected.rows[0]) throw new PlanError("TEMPORARY_FAILURE", "This plan's grocery list is not ready.", 503, true);
    return this.#readGrocery(selected.rows[0].id, userID);
  }

  async #readGrocery(id, userID) {
    const [list, items] = await Promise.all([
      this.pool.query("SELECT id, weekly_plan_id, revision FROM grocery_lists WHERE id = $1 AND user_id = $2", [id, userID]),
      this.pool.query(
        `SELECT item.* FROM grocery_items item JOIN grocery_lists list ON list.id = item.grocery_list_id
         WHERE item.grocery_list_id = $1 AND list.user_id = $2
         ORDER BY item.category_snapshot, item.display_name_snapshot`,
        [id, userID],
      ),
    ]);
    if (!list.rows[0]) throw new PlanError("VALIDATION_ERROR", "Grocery list not found.", 404);
    return {
      id: list.rows[0].id,
      planID: list.rows[0].weekly_plan_id,
      revision: Number(list.rows[0].revision),
      items: items.rows.map((row) => ({
        id: row.id,
        ingredientID: row.ingredient_id,
        displayName: row.display_name_snapshot,
        category: row.category_snapshot,
        requiredGrams: Number(row.required_grams),
        householdQuantities: row.household_quantities_json,
        userAdjustedGrams: row.user_adjusted_grams === null ? null : Number(row.user_adjusted_grams),
        disposition: dispositionFromDatabase(row.disposition),
        changedBySwap: row.changed_by_swap,
        newlyAddedBySwap: row.newly_added_by_swap,
      })),
    };
  }
}

async function persistSwapPlan(client, {
  userID,
  profileRevision,
  sourcePlanID,
  sourceItemID,
  replacement,
  idempotencyKey,
  recipes,
  successor,
  operations,
  previousMealStates,
  adoption,
  swappedAt,
}) {
  const plan = successor.resultPlan;
  const dates = plan.days.map((day) => localDateKey(day.localDate)).sort();
  const jobID = deterministicUUID(`meal-swap-job|${plan.id}`);
  const correlationID = deterministicUUID(`meal-swap-correlation|${plan.id}`);
  const reason = successor.diagnostics.regenerationReason;
  await client.query(
    `INSERT INTO plan_jobs (
        id, user_id, idempotency_key, state, week_start,
        time_zone_identifier, trigger, regeneration_reason,
        generator_version, scoring_version, rule_version,
        deterministic_seed_sha256, candidate_pool_size, diagnostics_json,
        retryable, correlation_id, profile_revision, request_json,
        created_at, started_at, completed_at
     ) VALUES ($1, $2, $3, 'succeeded', $4, $5, 'meal_swap', $6, $7, $8, $9,
               $10, $11, $12::jsonb, false, $13, $14, $15::jsonb, $16, $16, $16)`,
    [
      jobID, userID, `meal-swap:${idempotencyKey}`, dates[0], plan.timeZoneIdentifier,
      reason, plan.generatorVersion, plan.scoringVersion, plan.ruleVersion,
      sha256(`${sourcePlanID}|${sourceItemID}|${replacement.recipeVersionID}|${idempotencyKey}`),
      recipes.length, JSON.stringify(successor.diagnostics), correlationID, profileRevision,
      JSON.stringify({ sourcePlanID, sourcePlanItemID: sourceItemID, replacementRecipeVersionID: replacement.recipeVersionID }),
      swappedAt,
    ],
  );
  await client.query(
    `INSERT INTO weekly_plans (
        id, user_id, plan_job_id, week_start, week_end,
        time_zone_identifier, profile_revision, target_snapshot_json,
        generator_version, scoring_version, rule_version, diagnostics_json,
        supersedes_weekly_plan_id, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb, $13, $14)`,
    [
      plan.id, userID, jobID, dates[0], dates.at(-1), plan.timeZoneIdentifier,
      profileRevision, JSON.stringify(plan.targetSnapshot), plan.generatorVersion,
      plan.scoringVersion, plan.ruleVersion, JSON.stringify(successor.diagnostics),
      sourcePlanID, swappedAt,
    ],
  );
  for (const item of plan.days.flatMap((day) => day.items)) {
    if (!item.recipeSnapshot.recipeVersionID) {
      throw new PlanError("CONTENT_INSUFFICIENT", "A reviewed recipe snapshot is missing its immutable version identifier.", 422);
    }
    await client.query(
      `INSERT INTO plan_items (
          id, weekly_plan_id, local_date, slot, recipe_id, recipe_version_id,
          recipe_snapshot_json, serving_multiplier, serving_quantity_grams,
          nutrition_snapshot_json, leftover_relationship_json,
          locked_from_plan_item_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
      [
        item.id, plan.id, localDateKey(item.localDate), item.slot,
        item.recipeSnapshot.recipeID, item.recipeSnapshot.recipeVersionID,
        JSON.stringify(item.recipeSnapshot), item.servingMultiplier,
        item.servingQuantityGrams, JSON.stringify(item.nutrition),
        JSON.stringify(item.leftoverRelationship), item.lockedFromPlanItemID ?? null, swappedAt,
      ],
    );
  }

  await client.query(
    `INSERT INTO grocery_lists (id, user_id, weekly_plan_id, revision, created_at, updated_at)
     VALUES ($1, $2, $3, 1, $4, $4)`,
    [operations.groceryList.id, userID, plan.id, swappedAt],
  );
  for (const item of operations.groceryList.items) {
    await client.query(
      `INSERT INTO grocery_items (
          id, grocery_list_id, ingredient_id, display_name_snapshot,
          category_snapshot, required_grams, household_quantities_json,
          user_adjusted_grams, disposition, changed_by_swap, newly_added_by_swap
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
      [
        item.id, operations.groceryList.id, item.ingredientID, item.displayName,
        item.category, item.requiredGrams, JSON.stringify(item.householdQuantities),
        item.userAdjustedGrams, dispositionToDatabase(item.disposition),
        item.changedBySwap, item.newlyAddedBySwap,
      ],
    );
  }
  for (const task of operations.prepTimeline.tasks) {
    await client.query(
      `INSERT INTO prep_tasks (
          id, weekly_plan_id, local_date, title, active_minutes, storage_note,
          reuse_note, source_plan_item_ids, is_complete, revision, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9, $10, $11)`,
      [
        task.id, plan.id, localDateKey(task.localDate), task.title,
        task.activeMinutes, task.storageNote, task.reuseNote, task.sourcePlanItemIDs,
        task.isComplete, Number(task.revision ?? 0) + 1, swappedAt,
      ],
    );
  }

  for (const state of previousMealStates) {
    if (state.plan_item_id === sourceItemID) continue;
    const newItemID = successor.oldToNew.get(state.plan_item_id);
    if (!newItemID) continue;
    await client.query(
      `INSERT INTO plan_item_operational_states (
          user_id, plan_item_id, completion_state, revision, updated_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [userID, newItemID, state.completion_state, Number(state.revision), state.updated_at],
    );
  }
  await client.query(
    `INSERT INTO plan_swap_mutations (
        id, user_id, source_weekly_plan_id, result_weekly_plan_id,
        source_plan_item_id, replacement_recipe_version_id,
        idempotency_key, diagnostics_json, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      deterministicUUID(`meal-swap-mutation|${userID}|${idempotencyKey}`), userID,
      sourcePlanID, plan.id, sourceItemID, replacement.recipeVersionID,
      idempotencyKey, JSON.stringify(successor.diagnostics), swappedAt,
    ],
  );
  if (adoption) {
    const adoptedAt = new Date(adoption.adopted_at);
    const successorAdoptedAt = new Date(Math.max(swappedAt.getTime(), adoptedAt.getTime() + 1));
    const superseded = await client.query(
      `UPDATE plan_adoptions SET superseded_at = $2
        WHERE id = $1 AND superseded_at IS NULL
        RETURNING id`,
      [adoption.id, successorAdoptedAt],
    );
    if (!superseded.rows[0]) throw new PlanError("CONFLICT", "A newer plan is already active. Refresh before swapping a meal.", 409, true);
    await client.query(
      `INSERT INTO plan_adoptions (
          id, user_id, weekly_plan_id, adopted_at, activates_on, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        deterministicUUID(`meal-swap-adoption|${plan.id}`), userID, plan.id,
        successorAdoptedAt, dateValue(adoption.activates_on), `meal-swap:${idempotencyKey}`,
      ],
    );
  }
}

async function findSwapMutation(queryable, userID, idempotencyKey) {
  const result = await queryable.query(
    `SELECT source_weekly_plan_id, result_weekly_plan_id, created_at
       FROM plan_swap_mutations
      WHERE user_id = $1 AND idempotency_key = $2`,
    [userID, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function readGroceryForPlan(queryable, planID, userID) {
  const [list, items] = await Promise.all([
    queryable.query("SELECT id, weekly_plan_id, revision FROM grocery_lists WHERE weekly_plan_id = $1 AND user_id = $2", [planID, userID]),
    queryable.query(
      `SELECT item.* FROM grocery_items item
       JOIN grocery_lists list ON list.id = item.grocery_list_id
       WHERE list.weekly_plan_id = $1 AND list.user_id = $2
       ORDER BY item.category_snapshot, item.display_name_snapshot`,
      [planID, userID],
    ),
  ]);
  if (!list.rows[0]) throw new PlanError("TEMPORARY_FAILURE", "This plan's grocery list is not ready.", 503, true);
  return {
    id: list.rows[0].id,
    planID: list.rows[0].weekly_plan_id,
    revision: Number(list.rows[0].revision),
    items: items.rows.map(mapGroceryItem),
  };
}

async function readPrepForPlan(queryable, planID, userID) {
  const result = await queryable.query(
    `SELECT task.* FROM prep_tasks task
     JOIN weekly_plans plan ON plan.id = task.weekly_plan_id
     WHERE task.weekly_plan_id = $1 AND plan.user_id = $2
     ORDER BY task.local_date, task.title`,
    [planID, userID],
  );
  return { planID, tasks: result.rows.map(mapPrepTask) };
}

function mapGroceryItem(row) {
  return {
    id: row.id,
    ingredientID: row.ingredient_id,
    displayName: row.display_name_snapshot,
    category: row.category_snapshot,
    requiredGrams: Number(row.required_grams),
    householdQuantities: row.household_quantities_json,
    userAdjustedGrams: row.user_adjusted_grams === null ? null : Number(row.user_adjusted_grams),
    disposition: dispositionFromDatabase(row.disposition),
    changedBySwap: row.changed_by_swap,
    newlyAddedBySwap: row.newly_added_by_swap,
  };
}

function mapPrepTask(row) {
  return {
    id: row.id,
    localDate: localDateObject(row.local_date),
    title: row.title,
    activeMinutes: Number(row.active_minutes),
    storageNote: row.storage_note,
    reuseNote: row.reuse_note,
    sourcePlanItemIDs: row.source_plan_item_ids,
    isComplete: row.is_complete,
    revision: Number(row.revision) - 1,
  };
}

function resultingVariety(plan, itemID, recipe) {
  const items = structuredClone(plan.days.flatMap((day) => day.items));
  const item = items.find((candidate) => candidate.id === itemID);
  item.recipeSnapshot = structuredClone(recipe);
  item.leftoverRelationship = { none: {} };
  return analyzeVariety(items, new Set());
}

function hasLinkedReuse(plan, item) {
  return Boolean(item.leftoverRelationship.batchSource && plan.days.flatMap((day) => day.items).some(
    (candidate) => candidate.leftoverRelationship.plannedReuse?.sourcePlanItemID === item.id,
  ));
}

function localDateObject(value) {
  const text = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [year, month, day] = text.split("-").map(Number);
  return { year, month, day };
}

function stateToDatabase(value) {
  return value === "replacedOutsideApp" ? "replaced_outside_app" : value;
}

function stateFromDatabase(value) {
  return value === "replaced_outside_app" ? "replacedOutsideApp" : value;
}

function dispositionToDatabase(value) {
  return value === "alreadyHave" ? "already_have" : value;
}

function dispositionFromDatabase(value) {
  return value === "already_have" ? "alreadyHave" : value;
}

function dateValue(value) {
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return localDateKey(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function ingredientsOutsideItem(plan, itemID) {
  return new Set(plan.days.flatMap((day) => day.items)
    .filter((item) => item.id !== itemID)
    .flatMap((item) => item.recipeSnapshot.ingredients?.map((ingredient) => normalizedIngredient(ingredient.ingredientID)) ?? []));
}

function normalizedIngredient(value) {
  return String(value ?? "").trim().toLowerCase();
}

function scaledNutrition(nutrition, multiplier) {
  return {
    calories: Number(nutrition.calories) * Number(multiplier),
    proteinGrams: Number(nutrition.proteinGrams) * Number(multiplier),
    carbohydrateGrams: Number(nutrition.carbohydrateGrams) * Number(multiplier),
    fatGrams: Number(nutrition.fatGrams) * Number(multiplier),
    fibreGrams: Number(nutrition.fibreGrams) * Number(multiplier),
  };
}
