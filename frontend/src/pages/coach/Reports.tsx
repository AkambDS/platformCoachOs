import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { reportsApi, invoicesApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader } from '../../components/ui'

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

const STATUS_COLORS: Record<string, string> = {
  draft:              '#94a3b8',
  sent:               '#3b82f6',
  paid:               '#22c55e',
  partially_paid:     '#e67e22',
  overdue:            '#ef4444',
  void:               '#cbd5e1',
  refunded:           '#8b5cf6',
  partially_refunded: '#a78bfa',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', paid: 'Paid', partially_paid: 'Partial',
  overdue: 'Overdue', void: 'Void', refunded: 'Refunded', partially_refunded: 'Part. Refunded',
}

export default function Reports() {
  const navigate = useNavigate()
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [downloading, setDownloading] = useState(false)

  const { data: revenue } = useQuery({
    queryKey: ['revenue', year],
    queryFn: () => reportsApi.revenue(year).then(r => r.data),
  })
  const { data: outstanding } = useQuery({
    queryKey: ['outstanding'],
    queryFn: () => reportsApi.outstanding().then(r => r.data),
  })
  const { data: invoiceData } = useQuery({
    queryKey: ['invoices-report'],
    queryFn: () => invoicesApi.list({ page_size: 500 }).then(r => r.data),
  })

  const allInvoices: any[] = invoiceData?.results || invoiceData || []
  const outstandingList: any[] = outstanding || []

  // Revenue chart data — fill all 12 months
  const revenueByMonth: Record<string, number> = {}
  ;(revenue?.monthly || []).forEach((m: any) => {
    const monthNum = parseInt(m.month.split('-')[1]) - 1
    revenueByMonth[monthNum] = Number(m.revenue || 0)
  })
  const revenueChartData = MONTH_ABBR.map((label, i) => ({
    month: label,
    revenue: revenueByMonth[i] || 0,
  }))

  // Summary stats
  const ytdRevenue      = Number(revenue?.total || 0)
  const outstandingTotal = outstandingList.reduce((s, i) => s + Number(i.outstanding || 0), 0)
  const overdueCount    = outstandingList.filter(i => i.status === 'overdue').length
  const overdueTotal    = outstandingList.filter(i => i.status === 'overdue').reduce((s, i) => s + Number(i.outstanding || 0), 0)
  const totalInvoiced   = allInvoices.reduce((s, i) => s + Number(i.total || 0), 0)
  const paidCount       = allInvoices.filter(i => i.status === 'paid').length
  const collectionRate  = allInvoices.length > 0 ? (paidCount / allInvoices.length) * 100 : 0
  const avgInvoice      = allInvoices.length > 0 ? totalInvoiced / allInvoices.length : 0
  const thisMonth       = new Date().getMonth()
  const mtdRevenue      = revenueByMonth[thisMonth] || 0

  // Invoice status breakdown for pie
  const statusCounts: Record<string, number> = {}
  allInvoices.forEach(inv => {
    statusCounts[inv.status] = (statusCounts[inv.status] || 0) + 1
  })
  const pieData = Object.entries(statusCounts)
    .filter(([, n]) => n > 0)
    .map(([status, value]) => ({ name: STATUS_LABELS[status] || status, value, status }))

  // Top clients by revenue (paid invoices only)
  const clientRevenue: Record<string, number> = {}
  allInvoices.forEach(inv => {
    if (Number(inv.amount_paid) > 0) {
      const name = inv.client_name || 'Unknown'
      clientRevenue[name] = (clientRevenue[name] || 0) + Number(inv.amount_paid)
    }
  })
  const topClients = Object.entries(clientRevenue)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([name, revenue]) => ({ name, revenue }))

  // Invoice count by month (from all invoices created)
  const invoicesByMonth: Record<number, number> = {}
  allInvoices.forEach(inv => {
    const m = new Date(inv.created_at || inv.issue_date || '').getMonth()
    if (!isNaN(m)) invoicesByMonth[m] = (invoicesByMonth[m] || 0) + 1
  })
  const invoiceVolumeData = MONTH_ABBR.map((label, i) => ({
    month: label, count: invoicesByMonth[i] || 0,
  }))

  const handleDownloadCsv = async () => {
    setDownloading(true)
    try {
      const res = await reportsApi.exportCsv()
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `invoices-${year}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally { setDownloading(false) }
  }

  const handleDownloadRevenueCsv = () => {
    const rows = [
      ['Month', 'Revenue'],
      ...revenueChartData.map(r => [r.month, r.revenue.toFixed(2)]),
      ['TOTAL', ytdRevenue.toFixed(2)],
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `revenue-${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadOutstandingCsv = () => {
    const rows = [
      ['Invoice', 'Client', 'Status', 'Total', 'Outstanding', 'Due Date'],
      ...outstandingList.map(i => [i.number, i.client, i.status, i.total, i.outstanding, i.due_date || '']),
    ]
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `outstanding-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell>
      <PageHeader
        title="Reports"
        subtitle={`Revenue & pipeline analytics — ${year}`}
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              style={{ padding: '6px 12px', border: '1px solid var(--border)', background: 'var(--white)', fontSize: 13, borderRadius: 4, cursor: 'pointer' }}
            >
              {[thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              className="btn btn-outline btn-sm"
              onClick={handleDownloadRevenueCsv}
              style={{ fontSize: 11, letterSpacing: '.04em' }}
            >
              ↓ Revenue CSV
            </button>
            <button
              className="btn btn-dark"
              onClick={handleDownloadCsv}
              disabled={downloading}
              style={{ fontSize: 11, letterSpacing: '.04em' }}
            >
              {downloading ? 'Exporting…' : '↓ Export All Invoices'}
            </button>
          </div>
        }
      />

      <div className="page-body">
        {/* ── Stat Cards ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { lbl: 'Revenue YTD',       val: fmt$(ytdRevenue),        accent: '#c8a96a', sub: `${fmt$(mtdRevenue)} this month` },
            { lbl: 'Total Invoiced',    val: fmt$(totalInvoiced),     accent: '#2d6a9f', sub: `${allInvoices.length} invoices` },
            { lbl: 'Outstanding',       val: fmt$(outstandingTotal),  accent: '#e67e22', sub: `${outstandingList.length} unpaid` },
            { lbl: 'Overdue',           val: fmt$(overdueTotal),      accent: '#ef4444', sub: `${overdueCount} invoices` },
            { lbl: 'Collection Rate',   val: `${collectionRate.toFixed(0)}%`, accent: '#4a7c59', sub: `${paidCount} of ${allInvoices.length} paid` },
            { lbl: 'Avg Invoice',       val: fmt$(avgInvoice),        accent: '#7c4d9f', sub: 'per invoice' },
          ].map(s => (
            <div key={s.lbl} className="stat-card" style={{ borderTop: `3px solid ${s.accent}`, paddingTop: 14 }}>
              <div className="stat-val" style={{ fontSize: 22 }}>{s.val}</div>
              <div className="stat-lbl">{s.lbl}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Row 1: Revenue chart + Status pie ────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 20, marginBottom: 20 }}>
          {/* Monthly Revenue */}
          <div className="card">
            <div className="card-hdr">
              Monthly Revenue {year}
              <button className="btn btn-ghost btn-sm" onClick={handleDownloadRevenueCsv} style={{ fontSize: 11 }}>↓ CSV</button>
            </div>
            <div className="card-body">
              {revenueChartData.every(d => d.revenue === 0) ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>No revenue recorded in {year}</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={revenueChartData} barSize={28}>
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#8c8279' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#8c8279' }} tickFormatter={v => fmt$(v)} axisLine={false} tickLine={false} width={60} />
                    <Tooltip
                      formatter={(v: any) => [`$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'Revenue']}
                      contentStyle={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 4 }}
                    />
                    <Bar dataKey="revenue" fill="#c8a96a" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Invoice Status Breakdown */}
          <div className="card">
            <div className="card-hdr">Invoice Status Breakdown</div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              {pieData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>No invoices yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                        dataKey="value" paddingAngle={2}>
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={STATUS_COLORS[entry.status] || '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any, n: any) => [v, n]} contentStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center' }}>
                    {pieData.map(d => (
                      <div key={d.status} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)' }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLORS[d.status] || '#94a3b8', flexShrink: 0 }} />
                        {d.name} ({d.value})
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Row 2: Top Clients + Invoice Volume ──────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          {/* Top Clients by Revenue */}
          <div className="card">
            <div className="card-hdr">Top Clients by Revenue</div>
            <div className="card-body" style={{ padding: 0 }}>
              {topClients.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>No payments recorded yet</div>
              ) : topClients.map((c, i) => {
                const pct = topClients[0].revenue > 0 ? (c.revenue / topClients[0].revenue) * 100 : 0
                return (
                  <div key={c.name} style={{ padding: '10px 18px', borderBottom: '1px solid #f5f2ec' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)', width: 16 }}>#{i + 1}</span>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                      </div>
                      <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600, color: '#4a7c59' }}>
                        {fmt$(c.revenue)}
                      </span>
                    </div>
                    <div style={{ background: '#e9e5df', borderRadius: 2, height: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#c8a96a', borderRadius: 2 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Invoice Volume by Month */}
          <div className="card">
            <div className="card-hdr">Invoice Volume by Month {year}</div>
            <div className="card-body">
              {invoiceVolumeData.every(d => d.count === 0) ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>No invoices created in {year}</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={invoiceVolumeData} barSize={22}>
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#8c8279' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#8c8279' }} allowDecimals={false} axisLine={false} tickLine={false} width={28} />
                    <Tooltip
                      formatter={(v: any) => [v, 'Invoices']}
                      contentStyle={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 4 }}
                    />
                    <Bar dataKey="count" fill="#2d6a9f" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* ── Row 3: Outstanding Invoices table ────────────────── */}
        <div className="card">
          <div className="card-hdr">
            Outstanding Invoices
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={handleDownloadOutstandingCsv} style={{ fontSize: 11 }}>↓ CSV</button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/invoices')} style={{ fontSize: 11 }}>View all →</button>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {outstandingList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>All invoices are settled ✓</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Invoice', 'Client', 'Status', 'Total', 'Paid', 'Outstanding', 'Due Date'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {outstandingList.map((inv: any) => (
                    <tr
                      key={inv.id}
                      style={{ borderBottom: '1px solid #f5f2ec', cursor: 'pointer' }}
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{inv.number}</td>
                      <td style={{ padding: '10px 14px' }}>{inv.client}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          background: inv.status === 'overdue' ? '#fde8dc' : inv.status === 'partially_paid' ? '#fef3c7' : '#ddeaf7',
                          color: inv.status === 'overdue' ? '#a0400d' : inv.status === 'partially_paid' ? '#92400e' : '#1d5a88',
                          padding: '2px 8px', fontSize: 11, fontWeight: 600, borderRadius: 3,
                        }}>
                          {STATUS_LABELS[inv.status] || inv.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>${Number(inv.total).toFixed(2)}</td>
                      <td style={{ padding: '10px 14px', color: '#4a7c59' }}>${Number(inv.amount_paid).toFixed(2)}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 700, color: inv.status === 'overdue' ? '#ef4444' : '#e67e22' }}>
                        ${Number(inv.outstanding).toFixed(2)}
                      </td>
                      <td style={{ padding: '10px 14px', color: inv.status === 'overdue' ? '#ef4444' : 'var(--muted)', fontWeight: inv.status === 'overdue' ? 600 : 400 }}>
                        {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--paper)', borderTop: '1.5px solid var(--border)' }}>
                    <td colSpan={5} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--muted)' }}>TOTAL OUTSTANDING</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'Cormorant Garamond, serif', fontSize: 18, fontWeight: 700, color: overdueTotal > 0 ? '#ef4444' : '#e67e22' }}>
                      ${outstandingTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
