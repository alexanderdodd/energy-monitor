import type { Appliance, Category } from "../lib/types.ts";

interface Props {
  categories: Category[];
  appliances: Appliance[];
  onChange: (categories: Category[]) => void;
}

/**
 * Create, rename and delete categories, and choose which appliances belong
 * to each.
 *
 * Membership is deliberately many-to-many, so these are checkboxes rather
 * than a single-select on the appliance: an appliance can sit in several
 * categories at once.
 */
export function CategoryEditor({ categories, appliances, onChange }: Props) {
  const update = (id: string, patch: Partial<Category>) => {
    onChange(categories.map((category) => (category.id === id ? { ...category, ...patch } : category)));
  };

  const toggleMember = (category: Category, applianceId: string, member: boolean) => {
    const applianceIds = member
      ? [...new Set([...category.applianceIds, applianceId])]
      : category.applianceIds.filter((id) => id !== applianceId);
    update(category.id, { applianceIds });
  };

  const add = () => {
    // A blank id tells the server to derive a stable one from the name.
    onChange([...categories, { id: "", name: "", applianceIds: [] }]);
  };

  // An appliance in several categories makes the totals overlap; say so here
  // too, where the choice is actually being made.
  const counts = new Map<string, number>();
  for (const category of categories) {
    for (const id of new Set(category.applianceIds)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const shared = appliances.filter((appliance) => (counts.get(appliance.id) ?? 0) > 1);

  return (
    <div>
      {categories.length === 0 ? (
        <p className="meta">
          No categories yet. Add one to group appliances by what they are for — “Washing”,
          “Cooking”, “Heating”.
        </p>
      ) : null}

      {categories.map((category, index) => (
        <section className="appliance-setting" key={category.id || `new-${index}`}>
          <header>
            <input
              type="text"
              value={category.name}
              placeholder="Category name"
              aria-label={`Name for category ${index + 1}`}
              onChange={(event) => update(category.id, { name: event.target.value })}
            />
            <button
              type="button"
              className="button"
              onClick={() => onChange(categories.filter((item) => item !== category))}
            >
              Remove
            </button>
          </header>

          {appliances.length === 0 ? (
            <p className="meta">No appliances configured yet.</p>
          ) : (
            <div className="member-picker">
              {appliances.map((appliance) => (
                <label className="toggle" key={appliance.id}>
                  <input
                    type="checkbox"
                    checked={category.applianceIds.includes(appliance.id)}
                    onChange={(event) => toggleMember(category, appliance.id, event.target.checked)}
                  />
                  {appliance.name}
                </label>
              ))}
            </div>
          )}
        </section>
      ))}

      {shared.length > 0 ? (
        <p className="meta overlap-note">
          {shared.map((appliance) => appliance.name).join(", ")}{" "}
          {shared.length === 1 ? "belongs" : "belong"} to more than one category, so category
          totals will overlap and add up to more than the household total.
        </p>
      ) : null}

      <div className="actions">
        <button type="button" className="button" onClick={add}>
          Add category
        </button>
      </div>
    </div>
  );
}
