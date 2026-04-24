import axios from "axios";

// Relative base URL — Next.js rewrites proxy /api/* → FastAPI at port 8000
export const api = axios.create({
  baseURL: "",
  headers: { "Content-Type": "application/json" },
  timeout: 30_000,
});

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecipeBrief {
  id: number;
  title: string;
  slug?: string;
  image_url?: string;
  meal_type?: string;
  is_sweet: boolean;
  is_salty: boolean;
  is_spicy: boolean;
  is_vegetarian: boolean;
  calories_per_portion?: number;
  proteins_per_portion?: number;
  estimated_cost_per_portion?: number;
  health_score?: number;
  status: string;
  scraped_at?: string;
}

export interface RecipeDetail extends RecipeBrief {
  marmiton_url: string;
  instructions?: string;
  servings: number;
  prep_time_min?: number;
  cook_time_min?: number;
  difficulty?: string;
  is_vegan: boolean;
  cuisine_type?: string;
  tags_json?: string;
  carbs_per_portion?: number;
  lipids_per_portion?: number;
  ai_processed_at?: string;
  ingredients: RecipeIngredient[];
  /** User annotation (free-form notes) — item #10 */
  user_notes?: string | null;
  /** Favorite flag — item #33 */
  is_favorite?: boolean;
}

export interface RecipeIngredient {
  id: number;
  raw_text?: string;
  quantity_per_portion?: number;
  unit?: string;
  note?: string;
  order_index: number;
  ingredient?: {
    id: number;
    canonical_name: string;
    display_name_fr: string;
    category?: string;
    price_mapping_status?: string;
  };
}

export interface RecipeList {
  total: number;
  offset: number;
  limit: number;
  items: RecipeBrief[];
}

export interface ImportJob {
  id: number;
  job_type: string;
  status: string;
  progress_current: number;
  progress_total: number;
  current_item?: string;
  started_at?: string;
  finished_at?: string;
  error_log?: string;
  celery_task_id?: string;
  cancel_requested?: boolean;
  created_at: string;
}

export interface Batch {
  id: number;
  name?: string | null;
  notes?: string | null;
  target_portions: number;
  status: string;
  total_estimated_cost?: number | null;
  total_portions?: number | null;
  generated_at: string;
  batch_recipes: BatchRecipe[];
  shopping_items: ShoppingItem[];
}

export interface BatchRecipe {
  id: number;
  recipe_id: number;
  portions: number;
  recipe?: RecipeBrief;
}

export interface ShoppingItem {
  id: number;
  ingredient_master_id: number;
  quantity_needed: number;
  unit: string;
  format_qty?: number;
  format_unit?: string;
  packages_to_buy: number;
  estimated_cost?: number;
  from_inventory_qty: number;
  is_purchased: boolean;
  purchased_at?: string;
  product_url?: string;
  ingredient?: { id: number; canonical_name: string; display_name_fr: string };
  store?: { id: number; code: string; name: string };
}

export interface InventoryItem {
  id: number;
  ingredient_master_id: number;
  quantity: number;
  unit: string;
  purchased_at?: string;
  expires_at?: string;
  notes?: string;
  updated_at: string;
  ingredient?: { id: number; canonical_name: string; display_name_fr: string };
}

export interface Stats {
  total_recipes: number;
  ai_done_recipes: number;
  total_ingredients: number;
  priced_ingredients: number;
}

export interface Store {
  id: number;
  code: string;
  name: string;
  type: string;
  website_url?: string;
  is_transactional: boolean;
}

export interface StoreProduct {
  id: number;
  ingredient_master_id: number;
  store_id: number;
  product_name?: string;
  product_url?: string;
  price?: number;
  format_qty?: number;
  format_unit?: string;
  calories_per_100?: number;
  proteins_per_100?: number;
  carbs_per_100?: number;
  lipids_per_100?: number;
  nutriscore?: string;
  is_validated: boolean;
  confidence_score?: number;
  last_checked_at?: string;
  last_price_change_at?: string;
}

export interface IngredientMaster {
  id: number;
  canonical_name: string;
  display_name_fr: string;
  category?: string;
  subcategory?: string;
  is_produce?: boolean;
  default_unit?: string;
  estimated_price_per_kg?: number;
  parent_id?: number | null;
  specific_unit?: string | null;
  specific_price_per_unit?: number | null;
  calories_per_100?: number | null;
  proteins_per_100?: number | null;
  carbs_per_100?: number | null;
  lipids_per_100?: number | null;
  price_mapping_status: string;
  usage_count?: number;
  store_product_count?: number;
  children_count?: number;
  primary_image_url?: string | null;
  primary_store_code?: string | null;
  computed_price_per_kg?: number | null;
  computed_unit_price?: number | null;
  computed_unit_label?: string | null;
}

export interface ReceiptItem {
  id: number;
  raw_name?: string;
  ingredient_master_id?: number;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  total_price?: number;
  confidence?: number;
  is_confirmed: boolean;
}

export interface ReceiptScan {
  id: number;
  image_path: string;
  store_id?: number;
  scanned_at?: string;
  total_amount?: number;
  status: string;
  error_message?: string;
  created_at: string;
  items: ReceiptItem[];
}

// ─── API helpers ─────────────────────────────────────────────────────────────

export interface RecipeBatchRef {
  batch_id: number;
  batch_name: string | null;
  portions: number;
  generated_at: string;
  status: string;
}

export const recipesApi = {
  list: (params?: Record<string, unknown>) => api.get<RecipeList>("/api/recipes", { params }),
  get: (id: number) => api.get<RecipeDetail>(`/api/recipes/${id}`),
  classifyPending: (recipe_ids?: number[]) =>
    api.post<ImportJob>("/api/recipes/classify-pending", recipe_ids ?? null),
  updateIngredient: (recipeId: number, riId: number, data: {
    ingredient_master_id?: number | null;
    quantity_per_portion?: number | null;
    unit?: string | null;
    note?: string | null;
  }) => api.patch(`/api/recipes/${recipeId}/ingredients/${riId}`, data),
  patch: (id: number, data: { user_notes?: string | null; is_favorite?: boolean }) =>
    api.patch(`/api/recipes/${id}`, data),
  getBatches: (id: number) =>
    api.get<RecipeBatchRef[]>(`/api/recipes/${id}/batches`),
  recomputeCosts: (recipe_ids?: number[]) =>
    api.post<{ updated: number; complete: number; incomplete: number; pending: number }>(
      "/api/recipes/recompute-costs",
      recipe_ids ?? null,
    ),
  refreshIngredientUsage: () =>
    api.post<{ updated: number; parents: number; variants: number }>(
      "/api/recipes/refresh-ingredient-usage",
    ),
};

export const importsApi = {
  start: (limit?: number) => api.post<ImportJob>("/api/imports/marmiton", { limit }),
  getJob: (id: number) => api.get<ImportJob>(`/api/imports/${id}`),
  listJobs: () => api.get<ImportJob[]>("/api/imports"),
  cancel: (id: number) => api.post<ImportJob>(`/api/imports/${id}/cancel`),
};

export interface BatchGenerateRequest {
  target_portions?: number;
  num_recipes?: number;
  meal_type_sequence?: string[] | null;
  vegetarian_only?: boolean;
  vegan_only?: boolean;
  max_cost_per_portion?: number | null;
  prep_time_max_min?: number | null;
  health_score_min?: number | null;
  include_recipe_ids?: number[] | null;
  exclude_recipe_ids?: number[] | null;
  /**
   * When true (default server-side), the recipe selector re-ranks
   * candidates by inventory coverage — recipes using ingredients you
   * already have bubble to the top.
   */
  prefer_inventory?: boolean;
  /** Parent ingredient ids the recipe MUST contain (AND semantics) */
  include_ingredient_ids?: number[] | null;
  /** Parent ingredient ids the recipe MUST NOT contain */
  exclude_ingredient_ids?: number[] | null;
}

export interface BatchPreviewRecipe {
  id: number;
  title: string;
  image_url?: string;
  meal_type?: string;
  health_score?: number;
  estimated_cost_per_portion?: number;
  is_vegetarian: boolean;
  is_vegan: boolean;
  portions: number;
}

export interface ShoppingItemPreview {
  ingredient_master_id: number;
  quantity_needed: number;
  unit: string;
  format_qty?: number;
  format_unit?: string;
  packages_to_buy: number;
  estimated_cost?: number;
  from_inventory_qty: number;
  product_url?: string;
  ingredient?: { id: number; canonical_name: string; display_name_fr: string };
  store?: { id: number; code: string; name: string };
}

export interface BatchPreview {
  target_portions: number;
  total_portions: number;
  total_estimated_cost: number;
  price_coverage: number;
  unpriced_ingredients: string[];
  recipes: BatchPreviewRecipe[];
  shopping_items: ShoppingItemPreview[];
}

export interface PriceCoverageItem {
  id: number;
  canonical_name: string;
  display_name_fr: string;
  attempts: number;
}

export interface PriceCoverageOut {
  total: number;
  priced: number;
  coverage_pct: number;
  by_store: Record<string, number>;
  unpriced: PriceCoverageItem[];
}

export interface BatchAcceptRequest {
  target_portions: number;
  recipes: Array<{ recipe_id: number; portions: number }>;
  name?: string;
}

export interface MaxiCredsStatus {
  has_creds: boolean;
  email: string | null;
}

export interface GoogleStatus {
  connected: boolean;
  email: string | null;
}

export const authApi = {
  getMaxiCreds: () => api.get<MaxiCredsStatus>("/api/auth/maxi-creds"),
  setMaxiCreds: (data: { email: string; password: string }) =>
    api.put<MaxiCredsStatus>("/api/auth/maxi-creds", data),
  deleteMaxiCreds: () => api.delete("/api/auth/maxi-creds"),
  getGoogleStatus: () => api.get<GoogleStatus>("/api/auth/google/status"),
  googleOauthStart: () =>
    api.get<{ consent_url: string }>("/api/auth/google/oauth-start"),
  googleDisconnect: () => api.delete("/api/auth/google/disconnect"),
};

export const batchesApi = {
  generate: (req: BatchGenerateRequest) =>
    api.post<Batch>("/api/batches/generate", req),
  preview: (req: BatchGenerateRequest) =>
    api.post<BatchPreview>("/api/batches/preview", req),
  accept: (req: BatchAcceptRequest) =>
    api.post<Batch>("/api/batches/accept", req),
  delete: (id: number) => api.delete(`/api/batches/${id}`),
  list: () => api.get<Batch[]>("/api/batches"),
  get: (id: number) => api.get<Batch>(`/api/batches/${id}`),
  /** Partial update: name / notes / status */
  patch: (id: number, data: { name?: string; notes?: string; status?: string }) =>
    api.patch<Batch>(`/api/batches/${id}`, data),
  /** Clone a batch with fresh shopping list — UX #9 "reproduire" */
  duplicate: (id: number) =>
    api.post<Batch>(`/api/batches/${id}/duplicate`),
  /** Trigger the Playwright Maxi-cart filler. Returns the new ImportJob. */
  fillMaxiCart: (id: number) =>
    api.post<{ job_id: number; status: string; task_id: string }>(
      `/api/batches/${id}/fill-maxi-cart`,
    ),
  /** Export shopping list as a new Google Tasks list on the user's account. */
  exportToGoogleTasks: (id: number) =>
    api.post<{
      google_tasklist_id: string;
      title: string;
      tasks_created: number;
      total_items: number;
      errors: string[];
      google_email: string;
    }>(`/api/batches/${id}/export-to-google-tasks`),
  purchaseItem: (batchId: number, itemId: number) =>
    api.patch(`/api/batches/${batchId}/shopping-items/${itemId}/purchase`),
  unpurchaseItem: (batchId: number, itemId: number) =>
    api.patch(`/api/batches/${batchId}/shopping-items/${itemId}/unpurchase`),
  bulkPurchase: (batchId: number, itemIds: number[]) =>
    api.post(`/api/batches/${batchId}/shopping-items/bulk-purchase`, {
      item_ids: itemIds,
    }),
};

export const inventoryApi = {
  list: () => api.get<InventoryItem[]>("/api/inventory"),
  create: (data: Partial<InventoryItem>) => api.post<InventoryItem>("/api/inventory", data),
  update: (id: number, data: Partial<InventoryItem>) => api.patch<InventoryItem>(`/api/inventory/${id}`, data),
  delete: (id: number) => api.delete(`/api/inventory/${id}`),
};

export interface Metrics {
  generated_at: string;
  recipes: { total: number; by_status: Record<string, number> };
  ingredients: { total: number; parents_by_mapping_status: Record<string, number> };
  store_products_validated: number;
  batches_total: number;
  shopping_items_total: number;
  jobs_last_24h: Record<string, Record<string, number>>;
}

export const statsApi = {
  get: () => api.get<Stats>("/api/stats"),
  metrics: () => api.get<Metrics>("/api/metrics"),
};

export interface ChefChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChefChatRequest {
  messages: ChefChatMessage[];
  cart_recipes?: string[] | null;
}

export interface ChefChatResponse {
  reply: string;
}

export interface FridgeSuggestion {
  recipe_id: number;
  title: string;
  image_url: string | null;
  health_score: number | null;
  match_pct: number;
  missing: string[];
}

export interface FridgeSuggestResponse {
  fridge_items: string[];
  suggestions: FridgeSuggestion[];
}

export const chefApi = {
  chat: (body: ChefChatRequest) =>
    api.post<ChefChatResponse>("/api/chef/chat", body),
  suggestFromFridge: (limit = 8, min_match_pct = 0.5) =>
    api.get<FridgeSuggestResponse>("/api/chef/suggest-from-fridge", {
      params: { limit, min_match_pct },
    }),
};

// ─── Personal stats (item #36) ──────────────────────────────────────────────
export interface PersonalTopRecipe {
  recipe_id: number;
  title: string;
  image_url: string | null;
  times_used: number;
  total_portions: number;
}

export interface PersonalWeekBucket {
  week_start: string;
  batches: number;
  portions: number;
}

export interface PersonalStats {
  window_days: number;
  total_batches: number;
  total_portions: number;
  total_recipes_unique: number;
  avg_portions_per_batch: number;
  avg_cost_per_portion: number | null;
  top_recipes: PersonalTopRecipe[];
  weekly: PersonalWeekBucket[];
}

export const personalStatsApi = {
  get: (days = 90) =>
    api.get<PersonalStats>("/api/stats/personal", { params: { days } }),
};

export const storesApi = {
  list: () => api.get<Store[]>("/api/stores"),
  listProducts: (storeCode: string) => api.get<StoreProduct[]>(`/api/stores/${storeCode}/products`),
  mapPrices: (data?: { store_codes?: string[]; ingredient_ids?: number[] }) =>
    api.post<ImportJob>("/api/stores/map-prices", data ?? {}),
};

export const ingredientsApi = {
  list: (params?: {
    search?: string;
    category?: string;
    price_mapping_status?: string;
    parent_id?: string | number;
    limit?: number;
    offset?: number;
  }) => api.get<IngredientMaster[]>("/api/ingredients", { params }),
  count: (params?: {
    search?: string;
    category?: string;
    price_mapping_status?: string;
    parent_id?: string | number;
  }) => api.get<number>("/api/ingredients/count", { params }),
  categories: () => api.get<string[]>("/api/ingredients/categories"),
  update: (id: number, data: Partial<IngredientMaster>) =>
    api.patch<IngredientMaster>(`/api/ingredients/${id}`, data),
  unmap: (id: number) =>
    api.post<IngredientMaster>(`/api/ingredients/${id}/unmap`),
  repairPrefixes: () =>
    api.post<{ scanned: number; renamed: number; merged: number; skipped: number }>(
      "/api/ingredients/repair-prefixes",
    ),
  priceCoverage: () =>
    api.get<PriceCoverageOut>("/api/ingredients/price-coverage"),
  retryMissingPrices: () =>
    api.post("/api/ingredients/retry-missing-prices"),
  details: (id: number) =>
    api.get<IngredientDetails>(`/api/ingredients/${id}/details`),
};

export interface StoreProductOut {
  id: number;
  store_id: number;
  store_code?: string;
  store_name?: string;
  product_name?: string;
  product_url?: string;
  image_url?: string;
  price?: number;
  format_qty?: number;
  format_unit?: string;
  is_validated: boolean;
  confidence_score?: number;
  last_checked_at?: string;
}

export interface RecipeBriefForIng {
  id: number;
  title: string;
  image_url?: string;
  meal_type?: string;
  servings?: number;
  quantity_per_portion?: number;
  unit?: string;
}

export interface PricePoint {
  store_code: string;
  price: number;
  recorded_at: string;
}

export interface IngredientDetails extends IngredientMaster {
  store_products: StoreProductOut[];
  recipes: RecipeBriefForIng[];
  price_history: PricePoint[];
}

export interface ReceiptSuggestion {
  ingredient_id: number;
  name: string;
  canonical_name: string;
  confidence: number; // 0-1
  maxi_price: number | null;
  maxi_format_qty: number | null;
  maxi_format_unit: string | null;
}

export interface WeeklyTotal {
  week: string; // ISO "2026-W14"
  total: number;
  count: number;
}

export interface TopIngredient {
  ingredient_id: number;
  name: string;
  total: number;
  qty_times: number;
}

export interface PriceAlert {
  ingredient_id: number;
  name: string;
  avg_ticket_unit_price: number;
  maxi_unit_price: number;
  delta_pct: number;
}

export interface ReceiptStats {
  months: number;
  totals: { this_month: number; last_month: number; avg_weekly: number };
  weekly: WeeklyTotal[];
  top_ingredients: TopIngredient[];
  price_alerts: PriceAlert[];
}

// ─── Meal Plans (Trello-style weekly planner) ───────────────────────────────
export interface PlannedMeal {
  id: number;
  recipe_id: number;
  day_of_week: number;      // 0=Monday, 6=Sunday
  meal_slot: "midi" | "soir" | "snack";
  position: number;
  portions: number;
  notes?: string | null;
  recipe?: RecipeBrief;
}

export interface MealPlan {
  id: number;
  user_id?: number | null;
  week_start_date: string;   // ISO date of Monday
  name?: string | null;
  notes?: string | null;
  created_at: string;
  entries: PlannedMeal[];
}

export const mealPlansApi = {
  list: () => api.get<MealPlan[]>("/api/meal-plans"),
  current: () => api.get<MealPlan>("/api/meal-plans/current"),
  get: (id: number) => api.get<MealPlan>(`/api/meal-plans/${id}`),
  create: (data: { week_start_date?: string; name?: string }) =>
    api.post<MealPlan>("/api/meal-plans", data),
  remove: (id: number) => api.delete(`/api/meal-plans/${id}`),
  addEntry: (planId: number, data: {
    recipe_id: number;
    day_of_week: number;
    meal_slot: "midi" | "soir" | "snack";
    portions?: number;
    notes?: string | null;
  }) => api.post<MealPlan>(`/api/meal-plans/${planId}/entries`, data),
  moveEntry: (planId: number, entryId: number, data: {
    day_of_week?: number;
    meal_slot?: "midi" | "soir" | "snack";
    position?: number;
    portions?: number;
    notes?: string | null;
  }) => api.patch<MealPlan>(`/api/meal-plans/${planId}/entries/${entryId}`, data),
  removeEntry: (planId: number, entryId: number) =>
    api.delete(`/api/meal-plans/${planId}/entries/${entryId}`),
  toBatch: (planId: number) =>
    api.post<{ batch_id: number }>(`/api/meal-plans/${planId}/to-batch`),
};

export const receiptsApi = {
  list: () => api.get<ReceiptScan[]>("/api/receipts"),
  get: (id: number) => api.get<ReceiptScan>(`/api/receipts/${id}`),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post<ReceiptScan>("/api/receipts", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  confirm: (id: number, confirmed_item_ids: number[]) =>
    api.patch(`/api/receipts/${id}/confirm`, { confirmed_item_ids }),
  addItem: (scanId: number, data: Partial<ReceiptItem>) =>
    api.post<ReceiptItem>(`/api/receipts/${scanId}/items`, data),
  updateItem: (scanId: number, itemId: number, data: Record<string, string | number | null | undefined>) =>
    api.patch<ReceiptItem>(`/api/receipts/${scanId}/items/${itemId}`, data),
  deleteItem: (scanId: number, itemId: number) =>
    api.delete(`/api/receipts/${scanId}/items/${itemId}`),
  suggest: (raw_name: string) =>
    api.get<ReceiptSuggestion[]>("/api/receipts/suggest", { params: { raw_name } }),
  stats: (months = 6) =>
    api.get<ReceiptStats>("/api/receipts/stats", { params: { months } }),
};
