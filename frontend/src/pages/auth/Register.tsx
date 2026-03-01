import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { authApi } from "../../api/client"
import { useAuthStore } from "../../store/auth"

export default function Register() {
  const [form, setForm] = useState({ workspace_name: "", full_name: "", email: "", password: "" })
  const [error, setError]   = useState("")
  const [loading, setLoading] = useState(false)
  const login    = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const update = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError("")
    try {
      const { data } = await authApi.register(form)
      login({ access: data.access, refresh: data.refresh }, data.user, data.workspace)
      navigate("/dashboard")
    } catch (err: any) {
      setError(err.response?.data?.email?.[0] || err.response?.data?.detail || "Registration failed.")
    } finally { setLoading(false) }
  }

  const field = (label: string, key: string, type = "text") => (
    <label style={{ display: "block", marginBottom: "1rem" }}>
      <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#1B3A6B" }}>{label}</span>
      <input type={type} value={(form as any)[key]} onChange={update(key)} required
        style={{ display: "block", width: "100%", marginTop: "0.35rem", padding: "0.65rem 0.85rem",
                 border: "1.5px solid #D8D4CC", borderRadius: "8px", fontSize: "0.95rem", boxSizing: "border-box" }} />
    </label>
  )

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8F6F1" }}>
      <div style={{ background: "#fff", padding: "2.5rem", borderRadius: "12px", width: "420px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <h1 style={{ color: "#1B3A6B", marginBottom: "0.25rem", fontSize: "1.75rem", fontWeight: 700 }}>CoachOS</h1>
        <p style={{ color: "#6B6976", marginBottom: "2rem" }}>Create your coaching workspace</p>
        {error && <div style={{ background: "#FAF0EC", color: "#C04E28", padding: "0.75rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "0.9rem" }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          {field("Workspace Name", "workspace_name")}
          {field("Your Full Name", "full_name")}
          {field("Email", "email", "email")}
          {field("Password (min 10 chars)", "password", "password")}
          <button type="submit" disabled={loading}
            style={{ width: "100%", padding: "0.75rem", background: "#1B3A6B", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 600, fontSize: "1rem", cursor: "pointer", marginTop: "0.5rem" }}>
            {loading ? "Creating workspace..." : "Create Workspace"}
          </button>
        </form>
        <p style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.85rem", color: "#6B6976" }}>
          Already have an account? <a href="/login" style={{ color: "#C04E28" }}>Sign in</a>
        </p>
      </div>
    </div>
  )
}
