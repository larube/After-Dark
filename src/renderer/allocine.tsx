import { useState } from "react";

export function AllocineLink({ title, year }: { title: string; year: number | null }) {
  const [failed, setFailed] = useState(false);
  async function open() {
    setFailed(false);
    try {
      const reply = await window.afterDark.openAllocine({ title, year });
      setFailed(!reply.ok);
    } catch {
      setFailed(true);
    }
  }
  return <div>
    <button type="button" className="allocine-link" aria-label={`Voir sur Allociné · ${title}`}
      onClick={() => void open()}>Voir sur Allociné <span aria-hidden="true">↗</span></button>
    {failed && <p className="muted" role="status">Impossible d’ouvrir Allociné.</p>}
  </div>;
}
