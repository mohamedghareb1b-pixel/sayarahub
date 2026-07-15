// Static "brand knowledge base" used instead of a DB table (car_brands / car_models
// in the original PRD) to keep the pipeline simple while still allowing the
// free-text parser to infer a brand from a model name, and to normalize common
// Arabic misspellings seen in Saudi WhatsApp groups.

export type BrandInfo = {
  brand: string; // canonical Arabic brand name
  models: { name: string; aliases: string[] }[];
};

export const CAR_BRANDS: BrandInfo[] = [
  {
    brand: "تويوتا",
    models: [
      { name: "كامري", aliases: ["كامري", "كامرى", "camry"] },
      { name: "كورولا", aliases: ["كورولا", "كورولة", "corolla"] },
      { name: "لاندكروزر", aliases: ["لاندكروزر", "لاندكروز", "land cruiser", "لكزب"] },
      { name: "هايلكس", aliases: ["هايلكس", "هايلوكس", "hilux"] },
      { name: "يارس", aliases: ["يارس", "yaris"] },
      { name: "افالون", aliases: ["افالون", "أفالون", "avalon"] },
      { name: "براءة", aliases: ["برادو", "prado"] },
      { name: "راف فور", aliases: ["راف فور", "راف4", "rav4"] },
      { name: "فورتشنر", aliases: ["فورتشنر", "fortuner"] },
    ],
  },
  {
    brand: "هيونداي",
    models: [
      { name: "سوناتا", aliases: ["سوناتا", "سوناتة", "sonata"] },
      { name: "النترا", aliases: ["النترا", "الانترا", "elantra"] },
      { name: "توسان", aliases: ["توسان", "tucson"] },
      { name: "اكسنت", aliases: ["اكسنت", "أكسنت", "accent"] },
      { name: "سنتافي", aliases: ["سنتافي", "سنتا في", "santa fe"] },
    ],
  },
  {
    brand: "كيا",
    models: [
      { name: "سيراتو", aliases: ["سيراتو", "cerato"] },
      { name: "اوبتيما", aliases: ["اوبتيما", "أوبتيما", "optima"] },
      { name: "سبورتاج", aliases: ["سبورتاج", "sportage"] },
      { name: "كارنيفال", aliases: ["كارنيفال", "carnival"] },
      { name: "بيكانتو", aliases: ["بيكانتو", "picanto"] },
    ],
  },
  {
    brand: "نيسان",
    models: [
      { name: "التيما", aliases: ["التيما", "alitma", "altima"] },
      { name: "باترول", aliases: ["باترول", "patrol"] },
      { name: "صني", aliases: ["صني", "sunny"] },
      { name: "اكس تريل", aliases: ["اكس تريل", "xtrail", "x-trail"] },
    ],
  },
  {
    brand: "جي ام سي",
    models: [
      { name: "يوكن", aliases: ["يوكن", "yukon"] },
      { name: "سييرا", aliases: ["سييرا", "سيرا", "sierra"] },
      { name: "تاهو", aliases: ["تاهو", "tahoe"] },
    ],
  },
  {
    brand: "شفروليه",
    models: [
      { name: "تاهو", aliases: ["تاهو", "tahoe"] },
      { name: "سلفرادو", aliases: ["سلفرادو", "silverado"] },
      { name: "كابرس", aliases: ["كابرس", "caprice"] },
      { name: "ماليبو", aliases: ["ماليبو", "malibu"] },
    ],
  },
  {
    brand: "فورد",
    models: [
      { name: "اكسبيديشن", aliases: ["اكسبيديشن", "expedition"] },
      { name: "اف 150", aliases: ["اف 150", "ف150", "f150", "f-150"] },
      { name: "اكسبلورر", aliases: ["اكسبلورر", "explorer"] },
      { name: "توروس", aliases: ["توروس", "taurus"] },
    ],
  },
  {
    brand: "لكزس",
    models: [
      { name: "ES", aliases: ["اي اس", "es350", "es"] },
      { name: "LX", aliases: ["ال اكس", "lx570", "lx600", "lx"] },
      { name: "RX", aliases: ["ار اكس", "rx350", "rx"] },
    ],
  },
  {
    brand: "هوندا",
    models: [
      { name: "اكورد", aliases: ["اكورد", "accord"] },
      { name: "سيفيك", aliases: ["سيفيك", "civic"] },
      { name: "بايلوت", aliases: ["بايلوت", "pilot"] },
    ],
  },
  {
    brand: "مازدا",
    models: [
      { name: "6", aliases: ["مازدا 6", "mazda6", "6"] },
      { name: "CX5", aliases: ["cx5", "cx-5"] },
    ],
  },
  {
    brand: "مرسيدس",
    models: [
      { name: "C200", aliases: ["c200", "سي 200"] },
      { name: "E200", aliases: ["e200", "اي 200"] },
      { name: "S500", aliases: ["s500", "اس 500"] },
      { name: "GLE", aliases: ["gle"] },
    ],
  },
  {
    brand: "بي ام دبليو",
    models: [
      { name: "الفئة الثالثة", aliases: ["320", "330", "الفئة الثالثة"] },
      { name: "الفئة الخامسة", aliases: ["520", "530", "الفئة الخامسة"] },
      { name: "X5", aliases: ["x5"] },
    ],
  },
];

export const SAUDI_CITIES = [
  "الرياض",
  "جدة",
  "مكة",
  "المدينة",
  "الدمام",
  "الخبر",
  "الظهران",
  "الطائف",
  "تبوك",
  "بريدة",
  "خميس مشيط",
  "ابها",
  "حائل",
  "نجران",
  "جازان",
  "ينبع",
  "القصيم",
  "الاحساء",
  "عرعر",
  "سكاكا",
];

export const SPECS = ["سعودي", "خليجي", "امريكي", "اوروبي", "ياباني", "كوري"];

export const COLORS = [
  "ابيض",
  "اسود",
  "فضي",
  "رمادي",
  "احمر",
  "ازرق",
  "بني",
  "ذهبي",
  "بيج",
  "اخضر",
  "جملي",
  "كريمي",
  "نبيتي",
  "كحلي",
  "برونزي",
  "وردي",
  "اصفر",
  "برتقالي",
];

/** Try to resolve a free-typed model/brand token to a canonical brand + model. */
export function resolveBrandModel(token: string): { brand: string; model: string } | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  for (const b of CAR_BRANDS) {
    if (t === b.brand.toLowerCase()) return { brand: b.brand, model: "" };
    for (const m of b.models) {
      if (m.aliases.some((a) => a.toLowerCase() === t)) {
        return { brand: b.brand, model: m.name };
      }
    }
  }
  return null;
}

export function findModelInText(text: string): { brand: string; model: string } | null {
  const lower = text.toLowerCase();
  for (const b of CAR_BRANDS) {
    for (const m of b.models) {
      for (const alias of m.aliases) {
        if (lower.includes(alias.toLowerCase())) {
          return { brand: b.brand, model: m.name };
        }
      }
    }
  }
  for (const b of CAR_BRANDS) {
    if (lower.includes(b.brand.toLowerCase())) {
      return { brand: b.brand, model: "" };
    }
  }
  return null;
}
