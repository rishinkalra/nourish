export class ProfileError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ProfileError";
    this.code = code;
    this.status = status;
  }
}

export class MemoryProfileStore {
  profilesByUserID = new Map();

  async read(userID) {
    return this.profilesByUserID.get(userID) ?? null;
  }

  async compareAndSet(userID, request, updatedAt) {
    const current = this.profilesByUserID.get(userID);
    const currentRevision = current?.revision ?? 0;
    if (request.expectedRevision !== currentRevision) {
      throw new ProfileError("CONFLICT", "Your preferences changed elsewhere. Refresh and try again.", 409);
    }
    const stored = {
      profile: structuredClone(request.profile),
      revision: currentRevision + 1,
      effectiveScope: request.changeScope,
      updatedAt,
    };
    this.profilesByUserID.set(userID, stored);
    return stored;
  }
}

export class ProfileService {
  constructor({ store = new MemoryProfileStore(), now = () => new Date() } = {}) {
    this.store = store;
    this.now = now;
  }

  async read(userID) {
    return this.store.read(userID);
  }

  async update(userID, request) {
    if (
      !request?.profile ||
      !Number.isInteger(request.expectedRevision) ||
      !["currentAndFuturePlans", "nextPlanOnly"].includes(request.changeScope)
    ) {
      throw new ProfileError("VALIDATION_ERROR", "The profile update is incomplete.");
    }
    if (!validateProfile(request.profile)) {
      throw new ProfileError("VALIDATION_ERROR", "The profile contains invalid planning values.");
    }
    return this.store.compareAndSet(userID, request, this.now());
  }
}

function validateProfile(profile) {
  return (
    typeof profile.countryRegionCode === "string" && profile.countryRegionCode.length > 0 &&
    typeof profile.timeZoneIdentifier === "string" && profile.timeZoneIdentifier.length > 0 &&
    Number.isInteger(profile.calorieTarget) && profile.calorieTarget >= 1_200 && profile.calorieTarget <= 3_500 &&
    Array.isArray(profile.enabledMealSlots) && profile.enabledMealSlots.length > 0 &&
    Array.isArray(profile.cookingDays) && profile.cookingDays.length > 0 &&
    (profile.optionalDailyProteinTargetGrams == null || (
      Number.isInteger(profile.optionalDailyProteinTargetGrams) &&
      profile.optionalDailyProteinTargetGrams >= 10 && profile.optionalDailyProteinTargetGrams <= 300
    )) &&
    (profile.availableEquipment == null || (
      Array.isArray(profile.availableEquipment) && profile.availableEquipment.length <= 24 &&
      profile.availableEquipment.every((item) => typeof item === "string" && /^[a-z0-9-]{2,40}$/.test(item))
    )) &&
    profile.wellnessConsent?.policyVersion && profile.wellnessConsent?.acceptedAt
  );
}
