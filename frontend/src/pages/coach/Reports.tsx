import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts'
import { reportsApi } from '../../api/client'
import AppShell from '../../components/layout/AppShell'
import { PageHeader } from '../../components/ui'

export default function Reports() {
  const year = new Date().getFullYear()

  const { data: revenue } = useQuery({
    queryKey: ['revenue', year],
    queryFn: () => reportsApi.revenue(year).then(r => r.data),
  })
  const { data: outstanding } = useQuery({
    queryKey: ['outstanding'],
    queryFn: () => reportsApi.outstanding().then(r => r.data),
  })

  const revenueData: any[] = revenue?.monthly || []
  const totalRevenue = revenueData.reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0)

  return (
    <AppShell>
      <PageHeader title="Reports" subtitle={`Revenue & pipeline analytics — ${year}`} />

      <div className="page-body">
        {/* Summary stats */}
        <div className="stat-grid" style={{ marginBottom: 28 }}>
          {[
            { lbl: 'Revenue YTD', val: `$${totalRevenue.toLocaleString()}` },
            { lbl: 'Outstanding', val: `$${(outstanding || []).reduce((s: number, i: any) => s + Number(i.outstanding || 0), 0).toLocaleString()}` },
            { lbl: 'Overdue Invoices', val: (outstanding || []).filter((i: any) => i.status === 'overdue').length },
          ].map(s => (
            <div key={s.lbl} className="stat-card">
              <div className="stat-val">{s.val}</div>
              <div className="stat-lbl">{s.lbl}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Monthly Revenue */}
          <div className="card">
            <div className="card-hdr">Monthly Revenue {year}</div>
            <div className="card-body">
              {revenueData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>No revenue data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={revenueData}>
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#8c8279' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#8c8279' }} tickFormatter={v => `$${v}`} />
                    <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'Revenue']} />
                    <Bar dataKey="amount" fill="var(--ink)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Outstanding Invoices */}
          <div className="card">
            <div className="card-hdr">Outstanding Invoices</div>
            <div className="card-body">
              {(!outstanding || outstanding.length === 0) ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>All invoices are settled ✓</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Invoice', 'Client', 'Status', 'Outstanding'].map(h => (
                        <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(outstanding || []).map((inv: any) => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid #f5f2ec' }}>
                        <td style={{ padding: '8px', fontWeight: 600 }}>{inv.number}</td>
                        <td style={{ padding: '8px' }}>{inv.client}</td>
                        <td style={{ padding: '8px' }}>
                          <span style={{
                            background: inv.status === 'overdue' ? '#fde8dc' : '#ddeaf7',
                            color: inv.status === 'overdue' ? '#a0400d' : '#1d5a88',
                            padding: '2px 8px', fontSize: 11, fontWeight: 600,
                          }}>{inv.status}</span>
                        </td>
                        <td style={{ padding: '8px', fontFamily: 'Cormorant Garamond, serif', fontSize: 16, fontWeight: 600, color: inv.status === 'overdue' ? 'var(--rust)' : 'inherit' }}>
                          ${Number(inv.outstanding || inv.total).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
