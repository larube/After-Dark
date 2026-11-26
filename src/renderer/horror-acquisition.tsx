import { useEffect, useState } from "react";

export function HorrorAcquisitionSetting() {
  const [enabled, setEnabled] = useState<boolean>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void window.afterDark.horrorAcquisition().then((reply) => {
      if (!active) return;
      if (reply.ok) setEnabled(reply.data);
      else setError(reply.error);
    }).catch(() => {
      if (active) setError("Impossible de lire le réglage local.");
    });
    return () => { active = false; };
  }, []);

  async function save(next: boolean) {
    setSaving(true);
    setError("");
    try {
      const result = await window.afterDark.setHorrorAcquisition(next);
      if (result.ok) setEnabled(result.data);
      else setError(result.error);
    } catch {
      setError("Impossible d’enregistrer le réglage local.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="library-section" aria-labelledby="experimental-settings">
    <h2 id="experimental-settings">Réglages expérimentaux</h2>
    <label className="horror-acquisition-setting">
      <input type="checkbox" checked={enabled ?? false} disabled={enabled === undefined || saving}
        aria-describedby="horror-acquisition-description" onChange={(event) => void save(event.currentTarget.checked)} />
      Acquisition personnalisée — Horreur (expérimental)
    </label>
    <p id="horror-acquisition-description">
      Utilise davantage les signaux de ton profil pour trouver des films d’horreur. Cela peut générer plus de requêtes TMDB.
    </p>
    {error && <p className="notice error" role="alert">{error}</p>}
  </section>;
}
