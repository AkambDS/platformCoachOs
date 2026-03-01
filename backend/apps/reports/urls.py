from django.urls import path
from . import views

urlpatterns = [
    path("revenue/",    views.RevenueReportView.as_view(),    name="report-revenue"),
    path("outstanding/",views.OutstandingReportView.as_view(),name="report-outstanding"),
    path("export.csv",  views.ExportCSVView.as_view(),        name="report-export"),
]
