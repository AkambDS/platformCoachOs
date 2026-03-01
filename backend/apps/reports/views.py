"""CoachOS — reports/views.py (FR-REP-*)"""
import csv
from django.db.models import Sum, Count
from django.db.models.functions import TruncMonth
from django.http import StreamingHttpResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from apps.accounts.permissions import IsCoachOrAbove
from apps.invoicing.models import Invoice


class RevenueReportView(APIView):
    """GET /api/reports/revenue/?year=2026 — monthly revenue (FR-REP-01/02)"""
    permission_classes = [IsCoachOrAbove]

    def get(self, request):
        year    = int(request.query_params.get("year", 2026))
        qs      = Invoice.objects.filter(
            workspace=request.user.workspace,
            status__in=[Invoice.Status.PAID, Invoice.Status.PARTIALLY_PAID],
            paid_at__year=year,
        )
        # Business Owner can filter by coach
        if request.user.role != "business_owner":
            qs = qs.filter(coach=request.user)

        monthly = (qs.annotate(month=TruncMonth("paid_at"))
                     .values("month")
                     .annotate(revenue=Sum("amount_paid"), count=Count("id"))
                     .order_by("month"))

        return Response({
            "year":    year,
            "monthly": [{"month": r["month"].strftime("%Y-%m"),
                         "revenue": str(r["revenue"]),
                         "invoices": r["count"]} for r in monthly],
            "total":   str(qs.aggregate(t=Sum("amount_paid"))["t"] or 0),
        })


class OutstandingReportView(APIView):
    """GET /api/reports/outstanding/ — overdue + unpaid invoices (FR-REP-03)"""
    permission_classes = [IsCoachOrAbove]

    def get(self, request):
        qs = Invoice.objects.filter(
            workspace=request.user.workspace,
            status__in=[Invoice.Status.SENT, Invoice.Status.OVERDUE,
                        Invoice.Status.PARTIALLY_PAID],
        ).select_related("client")

        return Response([{
            "id":        str(i.id),
            "number":    i.number,
            "client":    i.client.full_name,
            "status":    i.status,
            "total":     str(i.total),
            "amount_paid": str(i.amount_paid),
            "outstanding": str(i.total - i.amount_paid),
            "due_date":  str(i.due_date) if i.due_date else None,
        } for i in qs])


class ExportCSVView(APIView):
    """GET /api/reports/export.csv — streaming CSV export (FR-REP-05)"""
    permission_classes = [IsCoachOrAbove]

    def get(self, request):
        qs = Invoice.objects.filter(workspace=request.user.workspace) \
                            .select_related("client").order_by("-created_at")

        def rows():
            yield ["Number","Client","Status","Type","Total","Paid","Due Date","Created"]
            for i in qs:
                yield [i.number, i.client.full_name, i.status, i.invoice_type,
                       str(i.total), str(i.amount_paid),
                       str(i.due_date) if i.due_date else "",
                       str(i.created_at.date())]

        def stream():
            for row in rows():
                yield ",".join(f'"{v}"' for v in row) + "\r\n"

        response = StreamingHttpResponse(stream(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="coachos-invoices.csv"'
        return response
