/** Girişten sonra varış: kullanıcının yetkili olduğu toplam marka tam olarak bir ise o markanın Genel Bakış'ı. */
export function singleBrandTarget(workspaces: Array<{ id: string; brands: Array<{ id: string }> }>): string | null {
  const all = workspaces.flatMap((w) => w.brands.map((b) => ({ ws: w.id, brand: b.id })));
  return all.length === 1 ? `/w/${all[0]!.ws}/b/${all[0]!.brand}/dashboard` : null;
}
