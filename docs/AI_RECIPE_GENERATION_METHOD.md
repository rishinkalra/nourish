# AI recipe generation methodology

## Boundary

Nourish uses the OpenAI API only from the background worker. API credentials never enter the iOS app, browser Control Room, recipe payloads, logs, or source control.

`POST /admin/v1/recipe-generations` accepts an author-owned brief and requires an idempotency key. It transactionally creates a `recipe_generation_runs` quarantine record and a leased `recipe.generate` job. `GET /admin/v1/recipe-generations` and `GET /admin/v1/recipe-generations/{id}` expose bounded status and generated review material to authorized authors. `GET /admin/v1/recipe-generations/{id}/image` decrypts and streams a private, no-store preview only after the same author authorization; provider storage keys never enter the browser response.

Generated output never enters the publishable catalogue automatically.

## Generation stages

1. The worker sends a bounded recipe brief to the Responses API.
2. Strict Structured Outputs constrain the result to the Nourish recipe proposal schema.
3. Nourish validates text lengths, enumerations, timings, serving bounds, ingredient quantities, and per-100g numeric ranges.
4. Nourish independently calculates per-serving nutrition by gram weighting the proposed ingredient estimates. A model-supplied recipe total is never trusted.
5. Only a valid recipe proceeds to image generation.
6. GPT Image creates one landscape food image without people, text, logos, packaging, watermarks, or unlisted decorative ingredients.
7. The image is stored through the authenticated private object-store boundary and the database retains only its object key plus dimensions and MIME type. Recipe Studio loads it through a private API preview rather than a public object URL.
8. The run becomes `awaitingReview`. It is not a canonical ingredient, reviewed nutrient record, recipe draft, published recipe, or planner candidate.

## Review and publication

An author or reviewer must:

- match proposed ingredients to existing canonical ingredients or create reviewer-approved ingredient records;
- accept or correct household-to-gram conversions;
- accept, replace, or reject every AI-estimated nutrient record;
- derive diet compatibility and allergens from canonical ingredient rules;
- visually confirm that the image matches the final recipe;
- create a normal catalogue draft; and
- use the existing separate-reviewer publication workflow.

AI-generated nutrient evidence retains `aiEstimated` provenance, the exact text model, image model, and prompt version, and low or medium confidence. It cannot claim high confidence. Any resulting catalogue version must disclose estimated nutrition.

## Configuration

The worker recognizes:

- `NOURISH_RECIPE_GENERATION_ENABLED=true`
- secret `NOURISH_OPENAI_API_KEY`
- `NOURISH_OPENAI_RECIPE_MODEL` (default `gpt-5.6-sol`)
- `NOURISH_OPENAI_IMAGE_MODEL` (default `gpt-image-2`)
- `NOURISH_OPENAI_TIMEOUT_MILLISECONDS` (default 120000)

Recipe generation remains disabled when the feature switch is absent. When enabled on a worker, startup fails closed without a sufficiently formed API key or safe model identifiers.

Provider response bodies are never copied into errors or logs. Retryable network, timeout, rate-limit, conflict, and provider failures remain inside the leased-job retry budget. Idempotent requests and stable generation IDs prevent duplicate quarantine records.

## Remaining publishing work

The Control Room now includes Recipe Studio for creating bounded briefs, monitoring generation status, reviewing calculated estimates and instructions, privately previewing images, discarding unsuitable generations with a permanent reason, and atomically importing a fully mapped generation as an editable catalogue draft. Import requires reviewed ingredient and nutrient mappings plus explicit nutrition, image, method, diet, and allergen confirmations. It never submits or publishes the draft.

Before generated recipes appear in the consumer app, Nourish still needs an approved public-image delivery boundary, a production moderation and rights policy, and a production catalogue coverage programme.
