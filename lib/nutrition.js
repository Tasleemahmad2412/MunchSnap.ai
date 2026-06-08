// USDA-based reference values (kcal per 100g, cooked/served)
const KCAL_PER_100G = {
  cucumber: 15,
  carrot: 35,
  cabbage: 25,
  kimchi: 24,
  salad: 20,
  lettuce: 15,
  tomato: 18,
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

function normalizeItem(item) {
  const name = item.name || 'food item';
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

  const items = Array.isArray(data.items_detected)
    ? data.items_detected.map(normalizeItem)
    : [];

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

  return {
    ...data,
    items_detected: items,
    total_calories: Math.max(totalCalories, 0),
    macros: normalizeMacros(totalCalories, data.macros),
  };
}

export const ANALYSIS_PROMPT = `You are a clinical nutrition analyst. Estimate calories from the VISIBLE portion only — be conservative and avoid overestimating.

PORTION ESTIMATION RULES:
1. Use the plate, bowl, or utensils in the image as size reference (standard dinner plate ≈ 26 cm / 10 in).
2. Estimate each item's weight in grams from what is actually on the plate — not a full recipe or restaurant serving.
3. A palm-sized protein portion ≈ 80–100 g. A fist-sized pile of rice/noodles ≈ 120–150 g cooked. A side of vegetables ≈ 60–120 g.
4. Do NOT add calories for invisible cooking oil, butter, or sauces unless clearly visible as a large amount.
5. Prefer slight UNDERestimation over overestimation.

CALORIE CALCULATION:
- Use USDA-style averages per 100 g: vegetables 20–40, cooked rice 130, lean chicken 165, fish 120, kimchi/pickled veg 25, tofu 76.
- Each item's calories = (estimated_weight_g / 100) × kcal_per_100g for that food type.
- total_calories MUST equal the sum of all items_detected[].calories (±5 kcal).
- Macros must be realistic: total_calories ≈ protein_g×4 + carbs_g×4 + fats_g×9.

Return ONLY valid JSON (no markdown):
{
  "meal_name": "string",
  "meal_description": "2-3 sentences describing visible foods and portion sizes",
  "total_calories": number,
  "macros": { "protein_g": number, "carbs_g": number, "fats_g": number },
  "items_detected": [{ "name": "string", "emoji": "string", "estimated_weight_g": number, "calories": number }],
  "dietary_advice": "string"
}`;
