import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { reportsApi, invoicesApi, clientsApi, activitiesApi, pipelineApi } from "../../api/client"
import { useAuthStore } from "../../store/auth"
import AppShell from "../../components/layout/AppShell"
import { PageHeader, StatusBadge } from "../../components/ui"

function fmtDatetime(d: string) {
  if (!d) return "—"
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

export default function Dashboard() {
  const { user, workspace } = useAuthStore()
  const navigate = useNavigate()
  const today = new Date().toISOString().split("T")[0]

  const { data: outstanding } = useQuery({ queryKey: ["outstanding"], queryFn: () => reportsApi.outstanding().then(r => r.data) })
  const { data: clients }     = useQuery({ queryKey: ["clients-summary"], queryFn: () => clientsApi.list({ page_size: 1 }).then(r => r.data) })
  const { data: upcoming }    = useQuery({ queryKey: ["activities-upcoming"], queryFn: () => activitiesApi.list({ start: today, status: "scheduled", page_size: 4 }).then(r => r.data) })
  const { data: dealsData }   = useQuery({ queryKey: ["pipeline-summary"], queryFn: () => pipelineApi.deals({ page_size: 100 }).then(r => r.data) })
  const { data: invoiceData } = useQuery({ queryKey: ["invoices-summary"], queryFn: () => invoicesApi.list({ page_size: 200 }).then(r => r.data) })

  const allInvoices: any[] = invoiceData?.results || invoiceData || []
  const outstandingList: any[] = outstanding || []
  const upcomingList: any[] = upcoming?.results || upcoming || []
  const deals: any[] = dealsData?.results || dealsData || []
  const activeDeals = deals.filter((d: any) => !["closed_lost"].includes(d.stage))
  const pipelineValue = activeDeals.reduce((s: number, d: any) => s + Number(d.deal_value || 0), 0)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  return (
    <AppShell>
      <PageHeader
        title={`${greeting}, ${user?.full_name?.split(" ")[0]}`}
        subtitle={workspace?.name || ""}
        action={
          <button className="btn btn-dark" onClick={() => navigate("/clients?new=1")}>
            + New Client
          </button>
        }
      />

      <div className="page-body">
        {/* Stat Cards */}
        <div className="stat-grid">
          {[
            { lbl: "Active Clients",    val: clients?.count          ?? "—", link: "/clients"  },
            { lbl: "Pipeline Value",    val: `$${pipelineValue.toLocaleString()}`, link: "/pipeline" },
            { lbl: "Upcoming Sessions", val: upcomingList.length     ?? "—", link: "/calendar" },
            { lbl: "Outstanding",       val: allInvoices.filter((i: any) => ["sent","overdue","partially_paid"].includes(i.status)).length, link: "/invoices" },
          ].map(s => (
            <div key={s.lbl} className="stat-card" onClick={() => navigate(s.link)} style={{ cursor: "pointer" }}>
              <div className="stat-val">{s.val}</div>
              <div className="stat-lbl">{s.lbl}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 20, alignItems: "start" }}>
          {/* Upcoming Sessions */}
          <div className="card">
            <div className="card-hdr">
              Upcoming Sessions
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("/calendar")}>View all →</button>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {upcomingList.length === 0 ? (
                <div style={{ padding: "24px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No upcoming sessions</div>
              ) : upcomingList.map((a: any) => (
                <div key={a.id} style={{ padding: "11px 18px", borderBottom: "1px solid #f5f2ec", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{a.client_name || ""}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontSize: 12 }}>{fmtDatetime(a.start_at)}</div>
                    <div style={{ display: "inline-block", background: "var(--cream)", padding: "1px 8px", fontSize: 10, marginTop: 3, textTransform: "capitalize" }}>{a.activity_type}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Outstanding Invoices */}
          <div className="card">
            <div className="card-hdr">
              Outstanding
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("/invoices")}>View all →</button>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {outstandingList.length === 0 ? (
                <div style={{ padding: "24px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>All invoices settled ✓</div>
              ) : outstandingList.slice(0, 4).map((inv: any) => (
                <div key={inv.id} style={{ padding: "11px 18px", borderBottom: "1px solid #f5f2ec", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={() => navigate("/invoices")}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{inv.number}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{inv.client}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 16, fontWeight: 600 }}>${Number(inv.outstanding || inv.total).toFixed(0)}</div>
                    <StatusBadge status={inv.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pipeline Snapshot */}
          <div className="card">
            <div className="card-hdr">
              Pipeline
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("/pipeline")}>View board →</button>
            </div>
            <div className="card-body" style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {["lead_new","discovery_scheduled","proposal_sent","verbal_yes","active_client"].map(stage => {
                const count = deals.filter((d: any) => d.stage === stage).length
                return (
                  <div key={stage} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", background: "var(--paper)", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".07em" }}>
                      {stage.replace(/_/g, " ")}
                    </div>
                    <div style={{ fontSize: 18, fontFamily: "Cormorant Garamond, serif", fontWeight: 600 }}>{count}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
