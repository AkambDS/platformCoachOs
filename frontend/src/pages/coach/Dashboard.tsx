import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { reportsApi, invoicesApi, clientsApi, activitiesApi, pipelineApi } from "../../api/client"
import { useAuthStore } from "../../store/auth"
import AppShell from "../../components/layout/AppShell"
import { PageHeader, StatusBadge } from "../../components/ui"
import WelcomeModal from "../../components/WelcomeModal"
import { useTour } from "../../hooks/useTour"

function fmtDatetime(d: string) {
  if (!d) return "—"
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
function fmt$(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

const STAGE_LABELS: Record<string, string> = {
  lead_new: "Lead – New", discovery_scheduled: "Discovery Scheduled",
  discovery_completed: "Discovery Completed", proposal_sent: "Proposal Sent",
  verbal_yes: "Verbal Yes", active_client: "Active Client",
  on_hold: "On Hold", closed_lost: "Closed – Lost",
}

// ── Owner Dashboard ────────────────────────────────────────────────────────────
function OwnerDashboard() {
  const navigate = useNavigate()
  const today = new Date().toISOString().split("T")[0]
  const thisYear = new Date().getFullYear()
  const thisMonth = new Date().getMonth()

  const { data: outstanding }  = useQuery({ queryKey: ["outstanding"],         queryFn: () => reportsApi.outstanding().then(r => r.data) })
  const { data: clients }      = useQuery({ queryKey: ["clients-summary"],      queryFn: () => clientsApi.list({ page_size: 1, active_flag: true }).then(r => r.data) })
  const { data: upcoming }     = useQuery({ queryKey: ["activities-upcoming"],  queryFn: () => activitiesApi.list({ start: today, status: "scheduled", page_size: 5 }).then(r => r.data) })
  const { data: dealsData }    = useQuery({ queryKey: ["pipeline-summary"],     queryFn: () => pipelineApi.deals({ page_size: 100 }).then(r => r.data) })
  const { data: invoiceData }  = useQuery({ queryKey: ["invoices-summary"],     queryFn: () => invoicesApi.list({ page_size: 200 }).then(r => r.data) })
  const { data: revenueData }  = useQuery({ queryKey: ["revenue", thisYear],    queryFn: () => reportsApi.revenue(thisYear).then(r => r.data) })

  const allInvoices: any[]     = invoiceData?.results || invoiceData || []
  const outstandingList: any[] = outstanding || []
  const upcomingList: any[]    = upcoming?.results || upcoming || []
  const deals: any[]           = dealsData?.results || dealsData || []
  const activeDeals            = deals.filter((d: any) => !["closed_lost"].includes(d.stage))
  const pipelineValue          = activeDeals.reduce((s: number, d: any) => s + Number(d.deal_value || 0), 0)

  const revenueMonths: any[] = revenueData?.monthly || []
  const ytdRevenue  = Number(revenueData?.total || 0)
  const mtdRevenue  = Number(
    revenueMonths.find((m: any) => new Date(m.month + "-01").getMonth() === thisMonth)?.revenue || 0
  )

  const overdueCount      = allInvoices.filter((i: any) => i.status === "overdue").length
  const outstandingAmount = outstandingList.reduce((s: number, i: any) => s + Number(i.outstanding || i.total || 0), 0)

  const ACTIVE_STAGES = ["lead_new","discovery_scheduled","discovery_completed","proposal_sent","verbal_yes","active_client","on_hold"]
  const stageMap = ACTIVE_STAGES.reduce((m, stage) => {
    const stageDeals = deals.filter((d: any) => d.stage === stage)
    m[stage] = { count: stageDeals.length, value: stageDeals.reduce((s: number, d: any) => s + Number(d.deal_value || 0), 0) }
    return m
  }, {} as Record<string, { count: number; value: number }>)

  return (
    <>
      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { lbl: "Active Clients",  val: clients?.count ?? "—",  sub: "total in CRM",            link: "/clients",   accent: "#c8a96a" },
          { lbl: "Pipeline Value",  val: fmt$(pipelineValue),    sub: `${activeDeals.length} active deals`, link: "/pipeline",  accent: "#2d6a9f" },
          { lbl: "Revenue YTD",     val: fmt$(ytdRevenue),       sub: `${fmt$(mtdRevenue)} this month`,    link: "/invoices",  accent: "#4a7c59" },
          { lbl: "Outstanding",     val: fmt$(outstandingAmount), sub: overdueCount > 0 ? `⚠ ${overdueCount} overdue` : `${outstandingList.length} invoices`, link: "/invoices", accent: overdueCount > 0 ? "#e67e22" : "#1a1714" },
        ].map(s => (
          <div key={s.lbl} className="stat-card" onClick={() => navigate(s.link)}
            style={{ cursor: "pointer", borderTop: `3px solid ${s.accent}`, paddingTop: 14 }}>
            <div className="stat-val">{s.val}</div>
            <div className="stat-lbl">{s.lbl}</div>
            <div style={{ fontSize: 11, color: s.lbl === "Outstanding" && overdueCount > 0 ? "#e67e22" : "var(--muted)", marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          { label: "+ New Invoice",      link: "/invoices/new" },
          { label: "+ Schedule Session", link: "/calendar" },
          { label: "+ New Deal",         link: "/pipeline/new" },
          { label: "View Reports",       link: "/reports" },
        ].map(a => (
          <button key={a.label} className="btn btn-outline btn-sm" onClick={() => navigate(a.link)}
            style={{ fontSize: 12, letterSpacing: ".04em" }}>
            {a.label}
          </button>
        ))}
      </div>

      {/* 3-col layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 20, alignItems: "start" }}>

        {/* Upcoming Sessions */}
        <div className="card">
          <div className="card-hdr">
            Upcoming Sessions
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/calendar")}>View all →</button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {upcomingList.length === 0 ? (
              <div style={{ padding: "28px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                No upcoming sessions
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => navigate("/calendar")} style={{ fontSize: 11 }}>Schedule one →</button>
                </div>
              </div>
            ) : upcomingList.slice(0, 5).map((a: any) => (
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
              <div style={{ padding: "28px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>All invoices settled ✓</div>
            ) : outstandingList.slice(0, 5).map((inv: any) => (
              <div key={inv.id}
                style={{ padding: "10px 18px", borderBottom: "1px solid #f5f2ec", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                onClick={() => navigate("/invoices")}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{inv.number}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{inv.client}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
                  <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 15, fontWeight: 600, color: inv.status === "overdue" ? "#e67e22" : "var(--ink)" }}>
                    ${Number(inv.outstanding || inv.total).toFixed(0)}
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
              </div>
            ))}
            {outstandingAmount > 0 && (
              <div style={{ padding: "10px 18px", background: "var(--paper)", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)" }}>
                <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>TOTAL OUTSTANDING</span>
                <span style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 17, fontWeight: 700, color: overdueCount > 0 ? "#e67e22" : "var(--ink)" }}>
                  ${outstandingAmount.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Pipeline */}
        <div className="card">
          <div className="card-hdr">
            Pipeline
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/pipeline")}>View board →</button>
          </div>
          <div className="card-body" style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
            {ACTIVE_STAGES.map(stage => {
              const { count, value } = stageMap[stage]
              if (count === 0) return null
              const pct = pipelineValue > 0 ? (value / pipelineValue) * 100 : 0
              return (
                <div key={stage} style={{ padding: "8px 12px", background: "var(--paper)", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>
                      {STAGE_LABELS[stage] || stage.replace(/_/g, " ")}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 15, fontWeight: 600 }}>{count}</span>
                      {value > 0 && <span style={{ fontSize: 11, color: "#4a7c59" }}>{fmt$(value)}</span>}
                    </div>
                  </div>
                  {pct > 0 && (
                    <div style={{ background: "#e9e5df", borderRadius: 2, height: 3 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "#c8a96a", borderRadius: 2 }} />
                    </div>
                  )}
                </div>
              )
            })}
            {activeDeals.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: "20px 0" }}>
                No active deals
                <div style={{ marginTop: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => navigate("/pipeline/new")} style={{ fontSize: 11 }}>Add one →</button>
                </div>
              </div>
            )}
            {pipelineValue > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px 2px", borderTop: "1px solid var(--border)", marginTop: 4 }}>
                <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>TOTAL</span>
                <span style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 16, fontWeight: 700 }}>{fmt$(pipelineValue)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Coach Dashboard ────────────────────────────────────────────────────────────
function CoachDashboard() {
  const navigate = useNavigate()
  const today     = new Date().toISOString().split("T")[0]
  const thisYear  = new Date().getFullYear()
  const thisMonth = new Date().getMonth()

  const { data: clients }     = useQuery({ queryKey: ["clients-summary"],     queryFn: () => clientsApi.list({ page_size: 1 }).then(r => r.data) })
  const { data: upcoming }    = useQuery({ queryKey: ["activities-upcoming"], queryFn: () => activitiesApi.list({ start: today, status: "scheduled", page_size: 5 }).then(r => r.data) })
  const { data: outstanding } = useQuery({ queryKey: ["outstanding"],         queryFn: () => reportsApi.outstanding().then(r => r.data) })
  const { data: revenueData } = useQuery({ queryKey: ["revenue", thisYear],   queryFn: () => reportsApi.revenue(thisYear).then(r => r.data) })
  const { data: recentClients } = useQuery({ queryKey: ["clients-recent"],    queryFn: () => clientsApi.list({ page_size: 5 }).then(r => r.data) })

  const upcomingList: any[]    = upcoming?.results || upcoming || []
  const outstandingList: any[] = outstanding || []
  const recentClientList: any[] = recentClients?.results || recentClients || []

  const outstandingAmount = outstandingList.reduce((s: number, i: any) => s + Number(i.outstanding || 0), 0)
  const overdueCount      = outstandingList.filter((i: any) => i.status === "overdue").length

  const revenueMonths: any[] = revenueData?.monthly || []
  const mtdRevenue = Number(
    revenueMonths.find((m: any) => new Date(m.month + "-01").getMonth() === thisMonth)?.revenue || 0
  )

  return (
    <>
      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 24 }}>
        {[
          { lbl: "My Clients",    val: clients?.count ?? "—",   sub: "total clients",                  link: "/clients",   accent: "#c8a96a" },
          { lbl: "Outstanding",   val: fmt$(outstandingAmount),  sub: overdueCount > 0 ? `⚠ ${overdueCount} overdue` : `${outstandingList.length} unpaid`, link: "/invoices", accent: overdueCount > 0 ? "#e67e22" : "#1a1714" },
          { lbl: "Collected MTD", val: fmt$(mtdRevenue),         sub: "this month",                     link: "/invoices",  accent: "#4a7c59" },
        ].map(s => (
          <div key={s.lbl} className="stat-card" onClick={() => navigate(s.link)}
            style={{ cursor: "pointer", borderTop: `3px solid ${s.accent}`, paddingTop: 14 }}>
            <div className="stat-val">{s.val}</div>
            <div className="stat-lbl">{s.lbl}</div>
            <div style={{ fontSize: 11, color: s.lbl === "Outstanding" && overdueCount > 0 ? "#e67e22" : "var(--muted)", marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {[
          { label: "+ Schedule Session", link: "/calendar" },
          { label: "+ New Invoice",      link: "/invoices/new" },
        ].map(a => (
          <button key={a.label} className="btn btn-outline btn-sm" onClick={() => navigate(a.link)}
            style={{ fontSize: 12, letterSpacing: ".04em" }}>
            {a.label}
          </button>
        ))}
      </div>

      {/* 2-col layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, alignItems: "start" }}>

        {/* Upcoming Sessions */}
        <div className="card">
          <div className="card-hdr">
            Upcoming Sessions
            <button className="btn btn-ghost btn-sm" onClick={() => navigate("/calendar")}>View all →</button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {upcomingList.length === 0 ? (
              <div style={{ padding: "28px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                No upcoming sessions
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => navigate("/calendar")} style={{ fontSize: 11 }}>Schedule one →</button>
                </div>
              </div>
            ) : upcomingList.slice(0, 5).map((a: any) => (
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

        {/* Right col: Outstanding + My Clients */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Outstanding Invoices */}
          <div className="card">
            <div className="card-hdr">
              Outstanding Invoices
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("/invoices")}>View all →</button>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {outstandingList.length === 0 ? (
                <div style={{ padding: "20px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>All invoices settled ✓</div>
              ) : outstandingList.slice(0, 4).map((inv: any) => (
                <div key={inv.id}
                  style={{ padding: "10px 18px", borderBottom: "1px solid #f5f2ec", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{inv.number}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{inv.client}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 15, fontWeight: 600, color: inv.status === "overdue" ? "#e67e22" : "var(--ink)" }}>
                      ${Number(inv.outstanding || inv.total).toFixed(0)}
                    </div>
                    <StatusBadge status={inv.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* My Clients */}
          <div className="card">
            <div className="card-hdr">
              My Clients
              <button className="btn btn-ghost btn-sm" onClick={() => navigate("/clients")}>View all →</button>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {recentClientList.length === 0 ? (
                <div style={{ padding: "20px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>No clients yet</div>
              ) : recentClientList.map((c: any) => (
                <div key={c.id}
                  style={{ padding: "10px 18px", borderBottom: "1px solid #f5f2ec", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                  onClick={() => navigate(`/clients/${c.id}`)}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%", background: "#c8a96a22",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 600, color: "#c8a96a", flexShrink: 0,
                  }}>
                    {(c.first_name?.[0] || "?").toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.first_name} {c.last_name}</div>
                    {c.company && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{c.company}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, workspace } = useAuthStore()
  const navigate = useNavigate()
  const isOwner = user?.role === "business_owner"
  const { startTour } = useTour()
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  return (
    <AppShell>
      <WelcomeModal onStartTour={startTour} />
      <PageHeader
        title={`${greeting}, ${user?.full_name?.split(" ")[0]}`}
        subtitle={workspace?.name || ""}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {isOwner && (
              <button className="btn btn-ghost btn-sm" onClick={startTour} style={{ fontSize: 12 }}>
                🗺 Take a Tour
              </button>
            )}
            {isOwner && (
              <button className="btn btn-dark" onClick={() => navigate("/clients?new=1")}>
                + New Client
              </button>
            )}
          </div>
        }
      />

      <div className="page-body">
        {isOwner ? <OwnerDashboard /> : <CoachDashboard />}
      </div>
    </AppShell>
  )
}
