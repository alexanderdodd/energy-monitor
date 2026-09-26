import { useEffect, useState } from "react";
import {
  ApplianceEditor,
  buildDrafts,
  toAppliances,
  type ApplianceDraft,
} from "../components/ApplianceEditor.tsx";
import { api } from "../lib/api.ts";
import { formatRelativeTime } from "../lib/format.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { Appliance, DiscoveredAppliance, Settings as SettingsPayload } from "../lib/types.ts";

interface DiscoveryResponse {
  appliances: DiscoveredAppliance[];
}

interface AppliancesResponse {
  appliances: Appliance[];
}

const CURRENCIES = ["EUR", "GBP", "USD", "CHF", "SEK", "NOK", "DKK", "PLN", "AUD", "CAD"];

export function Settings() {
  const settings = useApiResource<SettingsPayload>("api/settings");
  const discovery = useApiResource<DiscoveryResponse>("api/discovery");
  const configured = useApiResource<AppliancesResponse>("api/appliances");

  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [drafts, setDrafts] = useState<ApplianceDraft[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setPrice(String(settings.data.electricityPricePerKwh));
    setCurrency(settings.data.currency);
  }, [settings.data]);

  useEffect(() => {
    if (!discovery.data || !configured.data) return;
    setDrafts(buildDrafts(discovery.data.appliances, configured.data.appliances, false));
  }, [discovery.data, configured.data]);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const parsed = Number(price);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("Electricity price must be a number of 0 or more");
      }
      await api.put("api/settings", { electricityPricePerKwh: parsed, currency });
      if (drafts) {
        await api.put("api/appliances", { appliances: toAppliances(drafts) });
      }
      setStatus("Saved");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const connection = settings.data?.homeAssistant;

  return (
    <>
      <div className="card panel">
        <h2>General</h2>
        <p className="description">Used to turn kilowatt-hours into money throughout the app.</p>

        <div className="field">
          <label htmlFor="price">Electricity price (per kWh)</label>
          <input
            id="price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="currency">Currency</label>
          <select
            id="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {(CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]).map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card panel">
        <h2>Appliances</h2>
        <p className="description">
          Turn appliances on or off, rename them, and change which sensor fills each measurement.
        </p>

        {drafts === null ? (
          <p className="meta">
            {discovery.error ? discovery.error : "Loading devices…"}
          </p>
        ) : drafts.length === 0 ? (
          <p className="meta">No power or energy sensors were found in Home Assistant.</p>
        ) : (
          <ApplianceEditor drafts={drafts} onChange={setDrafts} showMappings />
        )}

        <div className="actions">
          <button
            className="button"
            onClick={() => {
              discovery.reload();
              configured.reload();
            }}
            disabled={saving}
          >
            Rediscover devices
          </button>
        </div>
      </div>

      <div className="card panel">
        <h2>Home Assistant</h2>
        <dl style={{ margin: 0 }}>
          <div className="status-line">
            <dt>Connection</dt>
            <dd style={{ color: connection?.connected ? "var(--accent)" : "var(--warn)" }}>
              {connection?.connected ? "Connected" : "Disconnected"}
            </dd>
          </div>
          <div className="status-line">
            <dt>Last successful update</dt>
            <dd>{formatRelativeTime(connection?.lastUpdate)}</dd>
          </div>
          {connection?.lastError ? (
            <div className="status-line">
              <dt>Last error</dt>
              <dd>{connection.lastError}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="actions">
        <button className="button button-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        {status ? <span className="meta">{status}</span> : null}
        {error ? <span className="error-text">{error}</span> : null}
      </div>
    </>
  );
}
