import { accountSubjectHash } from "./account-service.mjs";
import { withTransaction } from "./database.mjs";
import { randomUUID } from "node:crypto";

export function createPrivacyJobHandlers({ pool, objectStore, now = () => new Date() }) {
  if (!pool?.query || !pool?.connect) throw new Error("A PostgreSQL pool is required.");
  if (!objectStore?.putJSON || !objectStore?.deletePrefix) throw new Error("A private object store is required.");
  return {
    "account.export": async (job) => {
      const requestID = job.payload.requestID;
      const userID = job.payload.userID ?? job.userID;
      const processing = await pool.query(
        `UPDATE account_export_requests
            SET status = 'processing', failure_code = NULL
          WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'processing')
        RETURNING id, requested_at`,
        [requestID, userID],
      );
      if (!processing.rows[0]) throw jobError("EXPORT_REQUEST_UNAVAILABLE", "The export request is no longer processable.");

      const [
        account, identities, profile, subscription, appStoreAccountBinding, planJobs, plans, planItems,
        adoptions, swaps, groceryLists, groceryItems, prepTasks, operationalStates,
        mutationJournal, mealFeedback, weeklyReviews,
      ] = await Promise.all([
        pool.query("SELECT id, verified_email, created_at, disabled_at FROM users WHERE id = $1", [userID]),
        pool.query("SELECT provider, provider_subject, created_at FROM auth_identities WHERE user_id = $1 ORDER BY created_at", [userID]),
        pool.query("SELECT revision, effective_scope, profile_json, created_at, updated_at FROM profiles WHERE user_id = $1", [userID]),
        pool.query("SELECT state, product_id, environment, period_ends_at, will_auto_renew, last_verified_at, next_reconciliation_at, reconciliation_status, original_transaction_id, app_account_token, last_reconciled_at, reconciliation_attempt_count, last_reconciliation_error_code FROM subscriptions WHERE user_id = $1", [userID]),
        pool.query("SELECT app_account_token, created_at FROM app_store_account_bindings WHERE user_id = $1", [userID]),
        pool.query("SELECT id, state, week_start, time_zone_identifier, trigger, regeneration_reason, generator_version, scoring_version, rule_version, diagnostics_json, error_category, retryable, created_at, completed_at FROM plan_jobs WHERE user_id = $1 ORDER BY created_at", [userID]),
        pool.query("SELECT id, plan_job_id, week_start, week_end, time_zone_identifier, profile_revision, target_snapshot_json, generator_version, scoring_version, rule_version, diagnostics_json, supersedes_weekly_plan_id, created_at FROM weekly_plans WHERE user_id = $1 ORDER BY created_at", [userID]),
        pool.query("SELECT item.* FROM plan_items item JOIN weekly_plans plan ON plan.id = item.weekly_plan_id WHERE plan.user_id = $1 ORDER BY item.local_date, item.slot", [userID]),
        pool.query("SELECT id, weekly_plan_id, adopted_at, superseded_at, activates_on FROM plan_adoptions WHERE user_id = $1 ORDER BY adopted_at", [userID]),
        pool.query("SELECT id, source_weekly_plan_id, result_weekly_plan_id, source_plan_item_id, replacement_recipe_version_id, diagnostics_json, created_at FROM plan_swap_mutations WHERE user_id = $1 ORDER BY created_at", [userID]),
        pool.query("SELECT id, weekly_plan_id, revision, created_at, updated_at FROM grocery_lists WHERE user_id = $1 ORDER BY created_at", [userID]),
        pool.query("SELECT item.* FROM grocery_items item JOIN grocery_lists list ON list.id = item.grocery_list_id WHERE list.user_id = $1 ORDER BY item.grocery_list_id, item.category_snapshot, item.display_name_snapshot", [userID]),
        pool.query("SELECT task.* FROM prep_tasks task JOIN weekly_plans plan ON plan.id = task.weekly_plan_id WHERE plan.user_id = $1 ORDER BY task.local_date, task.title", [userID]),
        pool.query("SELECT plan_item_id, completion_state, revision, updated_at FROM plan_item_operational_states WHERE user_id = $1 ORDER BY updated_at", [userID]),
        pool.query("SELECT id, weekly_plan_id, mutation_id, base_revision, resulting_revision, mutation_json, client_created_at, acknowledged_at FROM weekly_loop_mutation_journal WHERE user_id = $1 ORDER BY client_created_at", [userID]),
        pool.query("SELECT id, plan_item_id, recipe_id, rating, reason_tags, note, submitted_at FROM meal_feedback WHERE user_id = $1 ORDER BY submitted_at", [userID]),
        pool.query("SELECT id, weekly_plan_id, completion_rate, changes_requested, submitted_at FROM weekly_plan_reviews WHERE user_id = $1 ORDER BY submitted_at", [userID]),
      ]);

      const generatedAt = now();
      const expiresAt = new Date(generatedAt.getTime() + 7 * 24 * 60 * 60_000);
      const objectKey = `account-exports/${accountSubjectHash(userID)}/${requestID}.json`;
      await objectStore.putJSON({
        key: objectKey,
        value: {
          schemaVersion: "nourish-portable-export-v1",
          generatedAt,
          account: account.rows[0] ?? null,
          identities: identities.rows,
          profile: profile.rows[0] ?? null,
          subscription: subscription.rows[0] ?? null,
          appStoreAccountBinding: appStoreAccountBinding.rows[0] ?? null,
          planJobs: planJobs.rows,
          plans: plans.rows,
          planItems: planItems.rows,
          planAdoptions: adoptions.rows,
          planSwaps: swaps.rows,
          groceryLists: groceryLists.rows,
          groceryItems: groceryItems.rows,
          prepTasks: prepTasks.rows,
          mealOperationalStates: operationalStates.rows,
          mutationJournal: mutationJournal.rows,
          mealFeedback: mealFeedback.rows,
          weeklyReviews: weeklyReviews.rows,
        },
      });
      await withTransaction(pool, async (client) => {
        await client.query(
          `UPDATE account_export_requests
              SET status = 'ready', object_key = $2, completed_at = $3, expires_at = $4
            WHERE id = $1`,
          [requestID, objectKey, generatedAt, expiresAt],
        );
        await client.query(
          `INSERT INTO background_jobs (
              id, job_type, user_id, idempotency_key, state, payload_json,
              max_attempts, available_at, created_at, updated_at
           ) VALUES ($1, 'notification.operational', $2, $3, 'queued', $4::jsonb, 6, $5, $5, $5)
           ON CONFLICT (job_type, idempotency_key) DO NOTHING`,
          [
            randomUUID(), userID, `export-ready:${requestID}`,
            JSON.stringify({
              templateID: "export_ready",
              referenceID: requestID,
              correlationID: job.payload?.correlationID ?? job.id,
            }),
            generatedAt,
          ],
        );
      });
      return { requestID, status: "ready", objectKey, expiresAt };
    },

    "account.delete": async (job) => {
      const requestID = job.payload.requestID;
      const completedAt = now();
      const pending = await pool.query(
        `SELECT id, user_subject_sha256
           FROM account_deletion_requests
          WHERE id = $1 AND status IN ('queued', 'processing')`,
        [requestID],
      );
      if (!pending.rows[0]) throw jobError("DELETION_REQUEST_UNAVAILABLE", "The deletion request is no longer processable.");
      await objectStore.deletePrefix(`account-exports/${pending.rows[0].user_subject_sha256}/`);

      return withTransaction(pool, async (client) => {
        const request = await client.query(
          `UPDATE account_deletion_requests
              SET status = 'processing', failure_code = NULL
            WHERE id = $1 AND status IN ('queued', 'processing')
          RETURNING id, user_id, user_subject_sha256`,
          [requestID],
        );
        if (!request.rows[0]) throw jobError("DELETION_REQUEST_UNAVAILABLE", "The deletion request is no longer processable.");
        if (request.rows[0].user_id) {
          const userID = request.rows[0].user_id;
          await client.query("SELECT set_config('nourish.account_deletion', 'on', true)");
          await client.query("DELETE FROM plan_swap_mutations WHERE user_id = $1", [userID]);
          await client.query("DELETE FROM grocery_lists WHERE user_id = $1", [userID]);
          await client.query("DELETE FROM prep_tasks WHERE weekly_plan_id IN (SELECT id FROM weekly_plans WHERE user_id = $1)", [userID]);
          await client.query("DELETE FROM plan_item_operational_states WHERE user_id = $1", [userID]);
          await client.query("DELETE FROM weekly_loop_mutation_journal WHERE user_id = $1", [userID]);
          await client.query("DELETE FROM weekly_plan_reviews WHERE user_id = $1", [userID]);
          await client.query("DELETE FROM meal_feedback WHERE user_id = $1", [userID]);
          await client.query("DELETE FROM plan_adoptions WHERE user_id = $1", [userID]);
          await client.query("DELETE FROM plan_items WHERE weekly_plan_id IN (SELECT id FROM weekly_plans WHERE user_id = $1)", [userID]);
          await client.query("DELETE FROM weekly_plans WHERE user_id = $1", [userID]);
          await client.query("DELETE FROM plan_jobs WHERE user_id = $1", [userID]);
          await client.query("DELETE FROM users WHERE id = $1", [userID]);
        }
        await client.query(
          `UPDATE account_deletion_requests
              SET status = 'completed', completed_at = $2, user_id = NULL
            WHERE id = $1`,
          [requestID, completedAt],
        );
        return { requestID, status: "completed", completedAt };
      });
    },
  };
}

function jobError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
