BEGIN;

ALTER TABLE background_jobs
    DROP CONSTRAINT background_jobs_job_type_check;

ALTER TABLE background_jobs
    ADD CONSTRAINT background_jobs_job_type_check CHECK (job_type IN (
        'plan.generate', 'account.export', 'account.delete', 'entitlement.reconcile',
        'notification.plan-ready', 'notification.operational', 'recipe.generate'
    ));

COMMIT;
