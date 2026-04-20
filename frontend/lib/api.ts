import axios from "axios";

// Relative base URL — Next.js rewrites proxy /api/* → FastAPI at port 8000
export const api = axios.create({
  baseURL: "",
  headers: { "Content-Type": "application/json" },
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
  name?: string;
  target_portions: number;
  status: string;
  total_estimated_cost?: number;
  total_portions?: number;
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
}

export const batchesApi = {
  generate: (req: BatchGenerateRequest) =>
    api.post<Batch>("/api/batches/generate", req),
  list: () => api.get<Batch[]>("/api/batches"),
  get: (id: number) => api.get<Batch>(`/api/batches/${id}`),
  purchaseItem: (batchId: number, itemId: number) =>
    api.patch(`/api/batches/${batchId}/shopping-items/${itemId}/purchase`),
  unpurchaseItem: (batchId: number, itemId: number) =>
    api.patch(`/api/batches/${batchId}/shopping-items/${itemId}/unpurchase`),
};

export const inventoryApi = {
  list: () => api.get<InventoryItem[]>("/api/inventory"),
  create: (data: Partial<InventoryItem>) => api.post<InventoryItem>("/api/inventory", data),
  update: (id: number, data: Partial<InventoryItem>) => api.patch<InventoryItem>(`/api/inventory/${id}`, data),
  delete: (id: number) => api.delete(`/api/inventory/${id}`),
};

export const statsApi = {
  get: () => api.get<Stats>("/api/stats"),
};

export const storesApi = {
  list: () => api.get<Store[]>("/api/stores"),
  listProducts: (storeCode: string) => api.get<StoreProduct[]>(`/api/stores/${storeCode}/products`),
  upsertPrice: (storeCode: string, data: {
    ingredient_master_id: number;
    price: number;
    format_qty: number;
    format_unit: string;
  }) => api.patch(`/api/stores/${storeCode}/prices`, data),
  mapPrices: (data?: { store_codes?: string[]; ingredient_ids?: number[] }) =>
    api.post<ImportJob>("/api/stores/map-prices", data ?? {}),
  validatePrices: (max_items?: number) =>
    api.post<ImportJob>("/api/stores/validate-prices", undefined, { params: { max_items } }),
  estimateFruiteriePrices: (ingredient_ids?: number[]) =>
    api.post<ImportJob>("/api/stores/fruiterie_440/estimate-prices", ingredient_ids ?? null),
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
  sanitizeNames: (ingredient_ids?: number[]) =>
    api.post<ImportJob>("/api/ingredients/sanitize-names", { ingredient_ids: ingredient_ids ?? null }),
  repairPrefixes: () =>
    api.post<{ scanned: number; renamed: number; merged: number; skipped: number }>(
      "/api/ingredients/repair-prefixes",
    ),
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
};
