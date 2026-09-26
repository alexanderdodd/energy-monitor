import { useEffect, useState } from "react";
import {
  ApplianceEditor,
  buildDrafts,
  toAppliances,
  type ApplianceDraft,
} from "../components/ApplianceEditor.tsx";
import { api } from "../lib/api.ts";
import { navigate } from "../lib/router.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { Appliance, DiscoveredAppliance } from "../lib/types.ts";

interface DiscoveryResponse {
  appliances: DiscoveredAppliance[];
}

interface AppliancesResponse {
  appliances: Appliance[];
}

/**
 * First run: show what was found, let the user confirm it, and get out of
 * the way. Everything here can be changed later in Settings.
 */
export function Setup() {
  const discovery = useApiResource<DiscoveryResponse>("api/discovery");
  const configured = useApiResource<AppliancesResponse>("api/appliances");

  const [drafts, setDrafts] = useState<ApplianceDraft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!discovery.data || !configured.data) return;
    // On first run everything found is switched on by default; that is the
    // outcome almost everyone wants.
    const firstRun = configured.data.appliances.length === 0;
    setDrafts(buildDrafts(discovery.data.appliances, configured.data.appliances, firstRun));
  }, [discovery.data, configured.data]);

  const save = async () => {
    if (!drafts) return;
    setSaving(true);
    setError(null);
    try {
      await api.put("api/appliances", { appliances: toAppliances(drafts) });
      navigate({ name: "overview" });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (discovery.loading && !discovery.data) {
    return <p className="meta">Looking for energy-monitoring devices&hellip;</p>;
  }

  if (!discovery.data) {
    return (
      <div className="card empty">
        <h2>Cannot reach Home Assistant</h2>
        <p>{discovery.error ?? "Discovery is unavailable."}</p>
        <button className="button" onClick={discovery.reload}>
          Try again
        </button>
      </div>
    );
  }

  const found = drafts ?? [];
  const selected = found.filter((draft) => draft.enabled).length;

  return (
    <div className="card panel">
      <h2>Welcome to Home Energy Monitor</h2>
      {found.length === 0 ? (
        <>
          <p className="description">
            No power or energy sensors were found. Add a smart plug or energy meter to Home
            Assistant, then scan again.
          </p>
          <button className="button" onClick={discovery.reload}>
            Scan again
          </button>
        </>
      ) : (
        <>
          <p className="description">
            We found {found.length} device{found.length === 1 ? "" : "s"} capable of energy
            monitoring. Choose the ones to track and give them the names you use at home.
          </p>

          <ApplianceEditor drafts={found} onChange={setDrafts} showMappings={false} />

          {error ? <p className="error-text">{error}</p> : null}

          <div className="actions">
            <button
              className="button button-primary"
              onClick={save}
              disabled={saving || selected === 0}
            >
              {saving ? "Saving…" : `Monitor ${selected} appliance${selected === 1 ? "" : "s"}`}
            </button>
            <button className="button" onClick={discovery.reload} disabled={saving}>
              Scan again
            </button>
          </div>
        </>
      )}
    </div>
  );
}
