// USDA-based reference values (kcal per 100g, cooked/served)
const KCAL_PER_100G = {
  cucumber: 15,
  carrot: 35,
  cabbage: 25,
  kimchi: 24,
  salad: 20,
  lettuce: 15,
  tomato: 18,
  pea: 81,
  peas: 81,
  broccoli: 35,
  spinach: 23,
  vegetable: 30,
  fruit: 50,
  apple: 52,
  banana: 89,
  rice: 130,
  bread: 265,
  noodle: 138,
  pasta: 131,
  potato: 87,
  chicken: 165,
  fish: 120,
  salmon: 180,
  beef: 250,
  pork: 242,
  tofu: 76,
  egg: 155,
  cheese: 350,
  sauce: 80,
  soup: 50,
  default: 100,
};

// Max realistic single-item portion (grams) for a standard plate
const MAX_PORTION_G = {
  vegetable: 180,
  salad: 150,
  rice: 220,
  bread: 80,
  chicken: 160,
  fish: 160,
  beef: 160,
  default: 200,
};

function getFoodCategory(name) {
  const n = name.toLowerCase();
  for (const key of Object.keys(KCAL_PER_100G)) {
    if (key !== 'default' && n.includes(key)) return key;
  }
  return 'default';
}

function getReferenceKcal(name, weightG) {
  const category = getFoodCategory(name);
  const kcalPer100 = KCAL_PER_100G[category] ?? KCAL_PER_100G.default;
  return Math.round((kcalPer100 * weightG) / 100);
}

function capPortionWeight(name, weightG) {
  const category = getFoodCategory(name);
  const maxG = MAX_PORTION_G[category] ?? MAX_PORTION_G.default;
  return Math.min(Math.max(weightG, 15), maxG);
}

function simplifyIngredientName(name) {
  const original = (name || 'food item').trim();
  const n = original.toLowerCase();

  const replacements = [
    [/tomato\s*ketchup|ketchup|catsup/i, 'tomatoes'],
    [/biryani|pilaf|pulao|jollof|paella|fried\s*rice|risotto/i, 'cooked rice'],
    [/salmon|trout|tuna|cod|mackerel|sardine|halibut|tilapia/i, 'fish fillet'],
    [/grilled\s*fish|baked\s*fish|steamed\s*fish|fish\s*steak/i, 'fish fillet'],
    [/white\s*fish|plain\s*fish/i, 'fish fillet'],
    [/chicken\s*curry|butter\s*chicken|tikka|masala/i, 'chicken'],
    [/beef\s*steak|grilled\s*beef/i, 'beef'],
    [/mayonnaise|mayo/i, 'sauce'],
    [/soy\s*sauce|teriyaki/i, 'sauce'],
    [/green\s*peas|garden\s*peas|peas/i, 'peas'],
    [/cherry\s*tomato|tomato\s*slice|sliced\s*tomato|fresh\s*tomato/i, 'tomatoes'],
    [/white\s*rice|steamed\s*rice|plain\s*rice|jasmine\s*rice|basmati\s*rice/i, 'cooked rice'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(n)) return replacement;
  }

  // Strip dish-style compound names — keep only the last simple noun if needed
  if (/\b(with|and|in|style|plate|bowl|curry|stew|salad)\b/i.test(original) && !/salad/i.test(n)) {
    const parts = original.split(/\bwith\b|\band\b|\bin\b/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) return simplifyIngredientName(parts[parts.length - 1]);
  }

  return original.charAt(0).toUpperCase() + original.slice(1);
}

function simplifyMealName(mealName, items) {
  if (!mealName) {
    return items.map((i) => i.name).join(', ') || 'Meal';
  }

  const n = mealName.toLowerCase();
  const dishPatterns = /biryani|ketchup|salmon|curry|paella|risotto|tikka|masala/i;
  if (dishPatterns.test(n) && items.length > 0) {
    return items.map((i) => i.name).join(', ');
  }

  return mealName;
}

function dedupeItems(items) {
  const merged = new Map();

  for (const item of items) {
    const key = item.name.toLowerCase();
    if (merged.has(key)) {
      const existing = merged.get(key);
      existing.estimated_weight_g += item.estimated_weight_g;
      existing.calories += item.calories;
    } else {
      merged.set(key, { ...item });
    }
  }

  return Array.from(merged.values());
}

function normalizeItem(item) {
  const name = simplifyIngredientName(item.name);
  const weightG = capPortionWeight(name, item.estimated_weight_g || 80);
  const referenceKcal = getReferenceKcal(name, weightG);
  const aiKcal = item.calories ?? referenceKcal;

  // Blend: weight USDA reference more heavily — AI tends to overestimate portions
  const calories = Math.round(referenceKcal * 0.7 + aiKcal * 0.3);

  return {
    ...item,
    name,
    estimated_weight_g: weightG,
    calories: Math.max(calories, 5),
  };
}

function normalizeMacros(totalCalories, macros = {}) {
  const protein = Math.max(0, Math.round(macros.protein_g ?? 0));
  const carbs = Math.max(0, Math.round(macros.carbs_g ?? 0));
  const fats = Math.max(0, Math.round(macros.fats_g ?? 0));
  const macroCalories = protein * 4 + carbs * 4 + fats * 9;

  if (macroCalories <= 0 || Math.abs(macroCalories - totalCalories) / totalCalories > 0.35) {
    return {
      protein_g: Math.round(totalCalories * 0.2 / 4),
      carbs_g: Math.round(totalCalories * 0.45 / 4),
      fats_g: Math.round(totalCalories * 0.35 / 9),
    };
  }

  return { protein_g: protein, carbs_g: carbs, fats_g: fats };
}

export function normalizeNutritionResult(data) {
  if (!data || typeof data !== 'object') return data;

  const items = dedupeItems(
    Array.isArray(data.items_detected)
      ? data.items_detected.map(normalizeItem)
      : []
  );

  const totalFromItems = items.reduce((sum, item) => sum + item.calories, 0);
  const aiTotal = Math.round(data.total_calories ?? totalFromItems);

  // Prefer item-sum; if AI total is much higher, it's likely overestimated
  let totalCalories = totalFromItems;
  if (items.length === 0) {
    totalCalories = aiTotal;
  } else if (aiTotal > totalFromItems * 1.25) {
    totalCalories = totalFromItems;
  } else {
    totalCalories = Math.round(totalFromItems * 0.85 + aiTotal * 0.15);
  }

  const mealName = simplifyMealName(data.meal_name, items);

  return {
    ...data,
    meal_name: mealName,
    items_detected: items,
    total_calories: Math.max(totalCalories, 0),
    macros: normalizeMacros(totalCalories, data.macros),
  };
}

export const ANALYSIS_PROMPT = `You are a clinical nutrition analyst. Identify ONLY what is visibly on the plate — use simple ingredient names, never guess fancy dishes or specific brands.

INGREDIENT IDENTIFICATION RULES (CRITICAL):
1. List each VISIBLE component as a separate item in items_detected — e.g. "cooked rice", "peas", "tomatoes", "fish fillet".
2. Use plain, literal names for what you SEE. Do NOT infer complex dish names.
   - WRONG: "biryani", "fried rice", "salmon", "tomato ketchup", "curry chicken"
   - RIGHT: "cooked rice", "peas", "tomatoes", "fish fillet", "chicken"
3. Do NOT assume specific fish species — if it looks like generic cooked fish, name it "fish fillet" (not salmon/tuna/cod unless unmistakable).
4. Do NOT call sliced fresh tomatoes "ketchup" or "sauce" — use "tomatoes".
5. Plain white rice with peas is NOT biryani — list "cooked rice" and "peas" separately.
6. meal_name should be a simple comma-separated summary of visible items (e.g. "Rice, peas, tomatoes, and fish") — not a restaurant dish name.
7. Count 2–6 separate items typically visible on one plate. Do not invent hidden ingredients.

PORTION ESTIMATION RULES:
1. Use the plate, bowl, or utensils in the image as size reference (standard dinner plate ≈ 26 cm / 10 in).
2. Estimate each item's weight in grams from what is actually on the plate — not a full recipe or restaurant serving.
3. A palm-sized protein portion ≈ 80–100 g. A fist-sized pile of rice ≈ 120–150 g cooked. Vegetables ≈ 60–120 g.
4. Do NOT add calories for invisible cooking oil, butter, or sauces unless clearly visible.
5. Prefer slight UNDERestimation over overestimation.

CALORIE CALCULATION:
- Use USDA-style averages per 100 g: peas 81, tomatoes 18, cooked rice 130, fish fillet 120, vegetables 20–40.
- Each item's calories = (estimated_weight_g / 100) × kcal_per_100g for that food type.
- total_calories MUST equal the sum of all items_detected[].calories (±5 kcal).
- Macros must be realistic: total_calories ≈ protein_g×4 + carbs_g×4 + fats_g×9.

Return ONLY valid JSON (no markdown):
{
  "meal_name": "string — simple list of visible foods",
  "meal_description": "2-3 sentences describing only what is visibly on the plate",
  "total_calories": number,
  "macros": { "protein_g": number, "carbs_g": number, "fats_g": number },
  "items_detected": [{ "name": "string — plain ingredient name", "emoji": "string", "estimated_weight_g": number, "calories": number }],
  "dietary_advice": "string"
}`;
