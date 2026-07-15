// fingerprint = lower(brand)|lower(model)|year|lower(trim)|lower(color)|lower(city)
// Used to de-duplicate inventory within the same showroom (PRD 4.3).

export type CarLike = {
  brand: string;
  model: string;
  year: number;
  trim?: string | null;
  color?: string | null;
  city: string;
};

export function buildFingerprint(car: CarLike): string {
  return [
    car.brand.toLowerCase().trim(),
    car.model.toLowerCase().trim(),
    String(car.year),
    (car.trim ?? "").toLowerCase().trim(),
    (car.color ?? "").toLowerCase().trim(),
    car.city.toLowerCase().trim(),
  ].join("|");
}
