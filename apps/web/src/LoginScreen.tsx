import { useState } from "react";
import { auth } from "./api/client";

export default function LoginScreen({ onConnecte }: { onConnecte: (u: any) => void }) {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErreur(null);
    try {
      const u = await auth.connexion(email, motDePasse);
      onConnecte(u);
    } catch (err: any) {
      setErreur(err?.message || "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--v2-page-bg, #F6F6F3)" }}>
      <form onSubmit={handleSubmit} style={{ background: "#fff", border: "1px solid #D9D9D2", borderRadius: 14, padding: 32, width: 340, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>Belvie <span style={{ color: "#1F5F5B" }}>ERP</span></h2>
        <p style={{ fontSize: 13, color: "#6B6B62", margin: "0 0 20px" }}>Connexion</p>
        <label style={{ display: "block", fontSize: 12.5, marginBottom: 4 }}>Email</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: "9px 10px", marginBottom: 14, border: "1px solid #D9D9D2", borderRadius: 8, boxSizing: "border-box" }} />
        <label style={{ display: "block", fontSize: 12.5, marginBottom: 4 }}>Mot de passe</label>
        <input type="password" required value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
          style={{ width: "100%", padding: "9px 10px", marginBottom: 18, border: "1px solid #D9D9D2", borderRadius: 8, boxSizing: "border-box" }} />
        {erreur && <p style={{ color: "#C0392B", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
        <button type="submit" disabled={busy} style={{ width: "100%", padding: "10px", background: "#1F5F5B", color: "#fff", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
          {busy ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
