import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import API from "../services/api";

export default function ProtectedRoute({ children }) {
  const [status, setStatus] = useState(() =>
    sessionStorage.getItem("token") ? "checking" : "fail"
  );

  useEffect(() => {
    if (status !== "checking") return;
    const token = sessionStorage.getItem("token");
    if (!token) return;
    API.get("/verify-token")
      .then(() => setStatus("ok"))
      .catch(() => setStatus("fail"));
  }, [status]);

  if (status === "checking") return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"var(--bg-primary)", color:"var(--text-secondary)", fontSize:13 }}>
      Verifying session…
    </div>
  );

  if (status === "fail") return <Navigate to="/" replace />;
  return children;
}
