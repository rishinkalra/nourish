const todayMeals = [
  { slot: "Breakfast", name: "Moong dal chilla", meta: "410 kcal · 24g protein", time: "8:00 AM", icon: "🥞", color: "#f3e4b9", done: true },
  { slot: "Lunch", name: "Rajma quinoa bowl", meta: "520 kcal · 27g protein", time: "1:00 PM", icon: "🥣", color: "#e9c9b8", done: false },
  { slot: "Snack", name: "Masala chaas + almonds", meta: "210 kcal · 15g protein", time: "4:30 PM", icon: "🥛", color: "#dcebd4", done: false },
  { slot: "Dinner", name: "Palak paneer plate", meta: "620 kcal · 32g protein", time: "7:30 PM", icon: "🍛", color: "#c9dfb8", done: false },
];

const weekMeals = [
  ["Moong dal chilla", "Rajma quinoa bowl", "Masala chaas + almonds", "Palak paneer plate"],
  ["Vegetable poha", "Lemon rice + cucumber raita", "Guava chaat", { name: "Palak paneer plate", reuse: "Planned leftover · cooked Monday" }],
  ["Idli + vegetable sambar", "Chana palak rice", "Roasted makhana", "Paneer tikka grain bowl"],
  ["Besan vegetable cheela", { name: "Rajma quinoa bowl", reuse: "Planned leftover · cooked Monday" }, "Coconut yogurt + fruit", "Tomato dal + cabbage sabzi"],
  ["Overnight cardamom oats", "Sambar rice bowl", "Masala corn", "Methi tofu + phulka"],
  ["Ragi dosa + chutney", "Vegetable biryani + raita", "Mango lassi", "Chole + jeera rice"],
  ["Paneer bhurji toast", "Curd rice + beetroot poriyal", "Fruit + roasted chana", "Moong khichdi + kadhi"],
];

const weeklyPlanItems = [
  { recipeId: "moong-chilla", dominantIngredients: ["moong", "onion"] },
  { recipeId: "rajma-bowl", batchId: "batch-rajma", dominantIngredients: ["rajma", "tomato"] },
  { recipeId: "palak-paneer", batchId: "batch-palak", dominantIngredients: ["spinach", "paneer"] },
  { recipeId: "palak-paneer", batchId: "batch-palak", reuseType: "leftover", dominantIngredients: ["spinach", "paneer"] },
  { recipeId: "chana-palak", dominantIngredients: ["chana", "spinach"] },
  { recipeId: "rajma-bowl", batchId: "batch-rajma", reuseType: "leftover", dominantIngredients: ["rajma", "tomato"] },
  { recipeId: "tomato-dal", dominantIngredients: ["toor-dal", "tomato"] },
  { recipeId: "methi-tofu", dominantIngredients: ["methi", "tofu"] },
];

const days = [
  { day: "Mon", date: 13, kcal: "1,760", protein: 98 }, { day: "Tue", date: 14, kcal: "1,820", protein: 102 },
  { day: "Wed", date: 15, kcal: "1,790", protein: 95 }, { day: "Thu", date: 16, kcal: "1,850", protein: 106 },
  { day: "Fri", date: 17, kcal: "1,805", protein: 99 }, { day: "Sat", date: 18, kcal: "1,890", protein: 101 },
  { day: "Sun", date: 19, kcal: "1,835", protein: 104 },
];

const groceryGroups = [
  { name: "Fresh produce", items: [["Spinach", "500 g", true], ["Tomatoes", "1.2 kg", true], ["Onions", "1 kg", false], ["Cucumber", "4 medium", false], ["Coriander", "2 bunches", true]] },
  { name: "Dairy & chilled", items: [["Paneer", "600 g", false], ["Plain curd", "1 kg", true], ["Buttermilk", "1 L", false]] },
  { name: "Grains & pulses", items: [["Brown rice", "750 g", true], ["Quinoa", "300 g", false], ["Rajma", "500 g", true], ["Moong dal", "500 g", false]] },
  { name: "Extras", items: [["Almonds", "200 g", false], ["Lemons", "6", true], ["Whole-wheat rotis", "12", false]] },
];

const prepTasks = [
  ["Make the base masala", "For rajma, chana and paneer", "20 min"], ["Cook brown rice", "Cool and portion for three meals", "8 min active"],
  ["Soak rajma", "Cover and refrigerate overnight", "3 min"], ["Wash and chop greens", "Dry well before storing", "12 min"],
  ["Blend mint chutney", "Keeps for four chilled days", "10 min"], ["Portion snack boxes", "Almonds + roasted chana", "5 min"],
];

const swapMeals = [
  ["Tofu saag bowl", "598 kcal · 35g protein · 30 min", "🥬", "#dce9ce"],
  ["Matar paneer + roti", "635 kcal · 30g protein · 35 min", "🫛", "#e3edc7"],
  ["Chana palak rice", "605 kcal · 28g protein · 25 min", "🍲", "#efe0bd"],
];

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const icon = (id) => `<svg><use href="#${id}"/></svg>`;
const mark = (value) => value ? "checked" : "";

const freshOnboardingState = () => ({
  step: 0,
  adult: false,
  wellnessFit: false,
  auth: "apple",
  goal: "maintain",
  calories: 1850,
  diet: "vegetarian",
  allergies: "Peanuts",
  cuisines: ["North Indian", "South Indian"],
  budget: "medium",
  cookTime: 35,
  cookDays: ["Mon", "Wed", "Fri", "Sun"],
  leftovers: "planned",
});

let onboardingState = freshOnboardingState();

const onboardingSteps = [
  () => `<section class="onboarding-step"><p class="eyebrow">WELCOME TO NOURISH</p><h1>Seven days. Far fewer decisions.</h1><p class="onboarding-lead">We’ll build a calorie-aware week around how you actually eat, shop, and cook. It takes about two minutes.</p><div class="value-stack"><div class="value-item"><span>1</span><div><strong>Meals that fit</strong><p>Your diet, tastes, target, budget, and available time.</p></div></div><div class="value-item"><span>2</span><div><strong>One useful shop</strong><p>A consolidated list that reuses ingredients thoughtfully.</p></div></div><div class="value-item"><span>3</span><div><strong>Less cooking, not more</strong><p>Planned leftovers and prep work only where they help.</p></div></div></div></section>`,
  () => `<section class="onboarding-step"><p class="eyebrow">WELLNESS FIT</p><h1>First, a quick safety check.</h1><p class="onboarding-lead">Nourish supports general wellness and meal organization. It does not provide clinical or medically prescribed diets.</p><div class="check-stack"><label class="check-card"><input id="adultConfirm" type="checkbox" ${mark(onboardingState.adult)}><span><strong>I am 18 years or older</strong><small>The personalized planner is currently designed for adults.</small></span></label><label class="check-card"><input id="wellnessFitConfirm" type="checkbox" ${mark(onboardingState.wellnessFit)}><span><strong>A general-wellness plan is suitable for me</strong><small>I am not seeking planning for pregnancy, breastfeeding, an active eating disorder, or a medically prescribed diet.</small></span></label></div><p class="helper-note">If either statement does not fit, Nourish should not generate an automated personalized target. Recipe browsing may be offered separately later.</p><p class="onboarding-error" id="onboardingError"></p></section>`,
  () => `<section class="onboarding-step"><p class="eyebrow">YOUR ACCOUNT</p><h1>Keep your plan with you.</h1><p class="onboarding-lead">Your account securely carries preferences, grocery progress, and weekly history between devices.</p><div class="auth-list"><button class="auth-option ${onboardingState.auth === "apple" ? "is-selected" : ""}" data-onboarding-auth="apple"><span class="auth-symbol">●</span>Continue with Apple</button><button class="auth-option ${onboardingState.auth === "email" ? "is-selected" : ""}" data-onboarding-auth="email"><span class="auth-symbol">@</span>Use an email magic link</button></div><p class="helper-note">Prototype only: no account is created and no information leaves this device.</p></section>`,
  () => `<section class="onboarding-step"><p class="eyebrow">YOUR DIRECTION</p><h1>What should the week support?</h1><p class="onboarding-lead">Choose a gentle goal and provide a target you trust. An optional professionally reviewed estimator can be added in production.</p><form class="onboarding-form"><fieldset><legend>Goal</legend><div class="option-grid"><label class="option-card"><input type="radio" name="onb-goal" value="maintain" ${mark(onboardingState.goal === "maintain")}><strong>Maintain</strong><small>Steady routine</small></label><label class="option-card"><input type="radio" name="onb-goal" value="gradual-loss" ${mark(onboardingState.goal === "gradual-loss")}><strong>Gradual loss</strong><small>No aggressive language</small></label><label class="option-card"><input type="radio" name="onb-goal" value="gradual-gain" ${mark(onboardingState.goal === "gradual-gain")}><strong>Gradual gain</strong><small>Build consistently</small></label></div></fieldset><label class="input-field"><span>Daily calorie target</span><div class="input-wrap"><input id="onbCalories" type="number" min="1200" max="3500" value="${onboardingState.calories}"><span>kcal/day</span></div></label><p class="helper-note">Nutrition values are estimates. Targets outside approved safety thresholds will be blocked rather than silently accepted.</p><p class="onboarding-error" id="onboardingError"></p></form></section>`,
  () => `<section class="onboarding-step"><p class="eyebrow">FOOD PROFILE</p><h1>Make every option feel like yours.</h1><p class="onboarding-lead">Diet and allergies are hard constraints. Cuisines and dislikes guide ranking without weakening safety.</p><form class="onboarding-form"><fieldset><legend>Diet</legend><div class="option-grid"><label class="option-card"><input type="radio" name="onb-diet" value="vegetarian" ${mark(onboardingState.diet === "vegetarian")}><strong>Vegetarian</strong></label><label class="option-card"><input type="radio" name="onb-diet" value="eggetarian" ${mark(onboardingState.diet === "eggetarian")}><strong>Eggetarian</strong></label><label class="option-card"><input type="radio" name="onb-diet" value="vegan" ${mark(onboardingState.diet === "vegan")}><strong>Vegan</strong></label></div></fieldset><label class="input-field"><span>Allergies and ingredients to avoid</span><input class="text-field" id="onbAllergies" value="${onboardingState.allergies}" placeholder="e.g. peanuts, mushrooms"></label><fieldset><legend>Favourite cuisines</legend><div class="chip-grid">${["North Indian","South Indian","Gujarati","Bengali","Continental"].map((name) => `<label class="select-chip"><input type="checkbox" name="onb-cuisine" value="${name}" ${mark(onboardingState.cuisines.includes(name))}><span>${name}</span></label>`).join("")}</div></fieldset></form></section>`,
  () => `<section class="onboarding-step"><p class="eyebrow">REAL LIFE</p><h1>How does cooking fit your week?</h1><p class="onboarding-lead">This is what turns a mathematically valid plan into one you can actually follow.</p><form class="onboarding-form"><fieldset><legend>Weekly budget</legend><div class="option-grid"><label class="option-card"><input type="radio" name="onb-budget" value="value" ${mark(onboardingState.budget === "value")}><strong>Value-first</strong></label><label class="option-card"><input type="radio" name="onb-budget" value="medium" ${mark(onboardingState.budget === "medium")}><strong>Medium</strong></label><label class="option-card"><input type="radio" name="onb-budget" value="flexible" ${mark(onboardingState.budget === "flexible")}><strong>Flexible</strong></label></div></fieldset><label class="input-field"><span>Maximum active time on a cook day</span><div class="input-wrap"><input id="onbCookTime" type="number" min="10" max="120" value="${onboardingState.cookTime}"><span>minutes</span></div></label><fieldset><legend>Days you can cook</legend><div class="chip-grid">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => `<label class="select-chip"><input type="checkbox" name="onb-cookday" value="${day}" ${mark(onboardingState.cookDays.includes(day))}><span>${day}</span></label>`).join("")}</div></fieldset><fieldset><legend>Leftover preference</legend><div class="option-grid"><label class="option-card"><input type="radio" name="onb-leftovers" value="avoid" ${mark(onboardingState.leftovers === "avoid")}><strong>Avoid</strong><small>Maximum variety</small></label><label class="option-card"><input type="radio" name="onb-leftovers" value="planned" ${mark(onboardingState.leftovers === "planned")}><strong>Planned</strong><small>1–2 useful reuses</small></label><label class="option-card"><input type="radio" name="onb-leftovers" value="often" ${mark(onboardingState.leftovers === "often")}><strong>Often</strong><small>Cook less</small></label></div></fieldset><p class="onboarding-error" id="onboardingError"></p></form></section>`,
  () => `<section class="onboarding-step"><p class="eyebrow">READY TO PLAN</p><h1>Here’s what Nourish will protect.</h1><p class="onboarding-lead">We’ll validate hard constraints first, reserve useful leftover pairs, then optimize calories, protein, cost, cooking load, ingredient waste, and variety.</p><div class="summary-list"><div class="summary-row"><span>Goal and target</span><strong>${onboardingState.goal.replace("-", " ")} · ${onboardingState.calories} kcal</strong></div><div class="summary-row"><span>Food profile</span><strong>${onboardingState.diet} · avoid ${onboardingState.allergies || "none listed"}</strong></div><div class="summary-row"><span>Cooking rhythm</span><strong>${onboardingState.cookDays.length} days · ${onboardingState.cookTime} min max</strong></div><div class="summary-row"><span>Variety</span><strong>1 exact recipe/week + planned leftovers</strong></div><div class="summary-row"><span>Budget</span><strong>${onboardingState.budget}</strong></div></div><div class="check-stack" style="margin-top:16px"><label class="check-card"><input id="estimateConfirm" type="checkbox"><span><strong>I understand nutrition values are estimates</strong><small>Nourish is a general-wellness planning tool, not medical advice.</small></span></label></div><p class="onboarding-error" id="onboardingError"></p></section>`,
];

function renderOnboarding() {
  const lastStep = onboardingSteps.length - 1;
  $("#onboardingContent").innerHTML = onboardingSteps[onboardingState.step]();
  $("#onboardingStepLabel").textContent = `Step ${onboardingState.step + 1} of ${onboardingSteps.length}`;
  $("#onboardingProgress").style.width = `${((onboardingState.step + 1) / onboardingSteps.length) * 100}%`;
  $("#onboardingBackButton").disabled = onboardingState.step === 0;
  $("#onboardingNextButton").textContent = onboardingState.step === 0 ? "Let's begin" : onboardingState.step === lastStep ? "Build my week" : "Continue";
}

function openOnboarding(reset = false) {
  if (reset) onboardingState = freshOnboardingState();
  closeModal($("#profileModal"));
  $("#onboarding").classList.add("is-open");
  $("#onboarding").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderOnboarding();
}

function closeOnboarding(markComplete = false) {
  $("#onboarding").classList.remove("is-open");
  $("#onboarding").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  if (markComplete) {
    try { localStorage.setItem("nourish-onboarding-complete", "true"); } catch (_) { /* local preview may disable storage */ }
  }
}

function onboardingError(message) {
  const error = $("#onboardingError");
  if (error) error.textContent = message;
  return false;
}

function captureOnboardingStep() {
  const step = onboardingState.step;
  if (step === 1) {
    onboardingState.adult = $("#adultConfirm").checked;
    onboardingState.wellnessFit = $("#wellnessFitConfirm").checked;
    if (!onboardingState.adult || !onboardingState.wellnessFit) return onboardingError("Both confirmations are required before personalized planning.");
  }
  if (step === 3) {
    onboardingState.goal = $('input[name="onb-goal"]:checked').value;
    onboardingState.calories = Number($("#onbCalories").value);
    if (onboardingState.calories < 1200 || onboardingState.calories > 3500) return onboardingError("Enter a target between 1,200 and 3,500 kcal for this prototype.");
  }
  if (step === 4) {
    onboardingState.diet = $('input[name="onb-diet"]:checked').value;
    onboardingState.allergies = $("#onbAllergies").value.trim();
    onboardingState.cuisines = $$('input[name="onb-cuisine"]:checked').map((input) => input.value);
  }
  if (step === 5) {
    onboardingState.budget = $('input[name="onb-budget"]:checked').value;
    onboardingState.cookTime = Number($("#onbCookTime").value);
    onboardingState.cookDays = $$('input[name="onb-cookday"]:checked').map((input) => input.value);
    onboardingState.leftovers = $('input[name="onb-leftovers"]:checked').value;
    if (onboardingState.cookDays.length === 0) return onboardingError("Choose at least one day when cooking is possible.");
  }
  if (step === 6 && !$("#estimateConfirm").checked) return onboardingError("Please confirm that nutrition values are estimates.");
  return true;
}

function renderTodayMeals() {
  $("#todayMealList").innerHTML = todayMeals.map((meal, index) => `
    <article class="meal-row ${meal.done ? "is-done" : ""}">
      <div class="meal-thumb" style="--meal-bg:${meal.color}">${meal.icon}</div>
      <div><h3>${meal.name}</h3><p>${meal.slot} · ${meal.meta}</p></div>
      <span class="meal-time">${meal.time}</span>
      <button class="check-button ${meal.done ? "is-checked" : ""}" data-meal-check="${index}" aria-label="${meal.done ? "Mark incomplete" : "Mark complete"}">${icon("i-check")}</button>
    </article>`).join("");
}

function renderDays(selected = 0) {
  $("#dayStrip").innerHTML = days.map((d, index) => `<button class="day-button ${index === selected ? "is-selected" : ""}" data-day="${index}"><span>${d.day}</span><strong>${d.date}</strong><i></i></button>`).join("");
  const d = days[selected];
  $("#selectedDayEyebrow").textContent = `${d.day.toUpperCase()}DAY`.replace("TUEDAY", "TUESDAY").replace("WEDDAY", "WEDNESDAY").replace("THUDAY", "THURSDAY").replace("FRIDAYDAY", "FRIDAY").replace("SATDAY", "SATURDAY").replace("SUNDAYDAY", "SUNDAY");
  $("#selectedDayTitle").textContent = `${d.kcal} kcal · ${d.protein}g protein`;
  renderWeekMeals(selected);
}

function renderWeekMeals(dayIndex) {
  const meals = todayMeals.map((base, index) => {
    const planned = weekMeals[dayIndex][index];
    return { ...base, name: typeof planned === "string" ? planned : planned.name, reuse: typeof planned === "string" ? "" : planned.reuse };
  });
  $("#weekMealList").innerHTML = meals.map((meal) => `<div class="timeline-item"><span class="timeline-time">${meal.time}</span><div class="timeline-meal"><div class="meal-thumb" style="--meal-bg:${meal.color}">${meal.icon}</div><div><h3>${meal.name}</h3><p>${meal.reuse ? `<span class="reuse-label">↻ ${meal.reuse}</span> · ` : ""}${meal.meta}</p></div></div><button class="icon-button" data-swap="${meal.name}" aria-label="Swap ${meal.name}">${icon("i-swap")}</button></div>`).join("");
}

function renderVarietyDiagnostics() {
  if (!window.NourishPlanner) return;
  const diagnostics = window.NourishPlanner.analyzeVariety(weeklyPlanItems, []);
  $("#exactRepeatCount").textContent = diagnostics.exactRepeatCount;
  $("#leftoverReuseCount").textContent = diagnostics.intentionalLeftoverCount;
  $("#dominantIngredientPeak").textContent = `${diagnostics.peakIngredientCount}×`;
}

function renderGroceries() {
  $("#groceryGroups").innerHTML = groceryGroups.map((group, groupIndex) => `<section class="grocery-group"><div class="group-heading"><h3>${group.name}</h3><span>${group.items.length} items</span></div>${group.items.map((item, itemIndex) => `<label class="grocery-item"><input type="checkbox" data-grocery="${groupIndex}-${itemIndex}" ${item[2] ? "checked" : ""}/><span class="item-name">${item[0]}<small>Used in ${2 + ((groupIndex + itemIndex) % 3)} meals</small></span><span class="item-qty">${item[1]}</span></label>`).join("")}</section>`).join("");
  updateGroceryProgress();
}

function updateGroceryProgress() {
  const total = groceryGroups.reduce((sum, group) => sum + group.items.length, 0);
  const done = groceryGroups.reduce((sum, group) => sum + group.items.filter((item) => item[2]).length, 0);
  $("#groceryDone").textContent = done; $("#groceryTotal").textContent = total;
  $("#groceryProgress").style.width = `${(done / total) * 100}%`;
}

function renderPrep() {
  $("#prepSteps").innerHTML = prepTasks.map((task, index) => `<label class="prep-step"><input type="checkbox" data-prep="${index}"/><div><h3>${task[0]}</h3><p>${task[1]}</p></div><span>${task[2]}</span></label>`).join("");
}

function showView(view) {
  $$("[data-view-panel]").forEach((panel) => panel.classList.toggle("is-visible", panel.dataset.viewPanel === view));
  $$("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(modal) { modal.classList.add("is-open"); modal.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; }
function closeModal(modal) { modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; }
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove("show"), 2300); }

function openSwap(name) {
  $("#swapTitle").textContent = `Swap ${name.toLowerCase()}`;
  $("#swapOptions").innerHTML = swapMeals.map((meal) => `<button class="swap-option" data-select-swap="${meal[0]}"><div class="meal-thumb" style="--meal-bg:${meal[3]}">${meal[2]}</div><div><h3>${meal[0]}</h3><p>${meal[1]}</p></div><strong>Choose</strong></button>`).join("");
  openModal($("#swapModal"));
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]"); if (nav) showView(nav.dataset.view);
  const go = event.target.closest("[data-go]"); if (go) showView(go.dataset.go);
  const check = event.target.closest("[data-meal-check]");
  if (check) { const index = Number(check.dataset.mealCheck); todayMeals[index].done = !todayMeals[index].done; renderTodayMeals(); toast(todayMeals[index].done ? "Meal marked complete" : "Meal moved back to today"); }
  const day = event.target.closest("[data-day]"); if (day) renderDays(Number(day.dataset.day));
  const swap = event.target.closest("[data-swap]"); if (swap) openSwap(swap.dataset.swap);
  const selectedSwap = event.target.closest("[data-select-swap]"); if (selectedSwap) { closeModal($("#swapModal")); toast(`${selectedSwap.dataset.selectSwap} added to your day`); }
  const authChoice = event.target.closest("[data-onboarding-auth]");
  if (authChoice) { onboardingState.auth = authChoice.dataset.onboardingAuth; renderOnboarding(); }
  if (event.target.closest("[data-close-modal]")) closeModal(event.target.closest(".modal-backdrop"));
  if (event.target.classList.contains("modal-backdrop")) closeModal(event.target);
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-grocery]")) { const [g, i] = event.target.dataset.grocery.split("-").map(Number); groceryGroups[g].items[i][2] = event.target.checked; updateGroceryProgress(); }
  if (event.target.matches("[data-prep]")) { const count = $$('[data-prep]:checked').length; $("#prepStatus").textContent = `${count} of ${prepTasks.length}`; }
});

[$("#profileButton"), $("#mobileProfileButton"), $("#tunePlanButton")].forEach((button) => button?.addEventListener("click", () => openModal($("#profileModal"))));
$("#profileForm").addEventListener("submit", (event) => { event.preventDefault(); closeModal($("#profileModal")); toast("Preferences saved for your next plan"); });
$("#replayOnboardingButton").addEventListener("click", () => openOnboarding(true));
$("#exitOnboardingButton").addEventListener("click", () => closeOnboarding(false));
$("#onboardingBackButton").addEventListener("click", () => { if (onboardingState.step > 0) { onboardingState.step -= 1; renderOnboarding(); } });
$("#onboardingNextButton").addEventListener("click", () => {
  if (!captureOnboardingStep()) return;
  if (onboardingState.step < onboardingSteps.length - 1) {
    onboardingState.step += 1;
    renderOnboarding();
  } else {
    closeOnboarding(true);
    toast("Your first week is ready to preview");
  }
});
$("#regenerateButton").addEventListener("click", () => toast("A fresh plan is being prepared…"));
$("#searchListButton").addEventListener("click", () => { const item = prompt("Find an ingredient"); if (item) toast(`Searching for “${item}”`); });
$("#startPrepButton").addEventListener("click", () => toast("Guided prep started: base masala · 20 min"));
$("[data-open-meal]").addEventListener("click", () => toast("Recipe detail is next in the build queue"));

renderTodayMeals(); renderDays(); renderGroceries(); renderPrep(); renderVarietyDiagnostics();
const initialView = location.hash.replace("#", "");
if (["today", "week", "groceries", "prep"].includes(initialView)) showView(initialView);

let onboardingPreviouslyCompleted = false;
try { onboardingPreviouslyCompleted = localStorage.getItem("nourish-onboarding-complete") === "true"; } catch (_) { /* local preview may disable storage */ }
if (!onboardingPreviouslyCompleted) window.setTimeout(() => openOnboarding(false), 350);
