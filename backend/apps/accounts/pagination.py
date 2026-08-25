"""CoachOS — shared DRF pagination.

DRF's PageNumberPagination ignores the `page_size` query param unless a
`page_size_query_param` is explicitly set — many pages across the frontend already
pass `page_size` (e.g. `?page_size=200`) expecting it to control the response, but
with the stock class it was silently a no-op and every list endpoint was capped at
the class default (25) regardless. This subclass makes that param actually work.
"""
from rest_framework.pagination import PageNumberPagination


class DefaultPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 1000
