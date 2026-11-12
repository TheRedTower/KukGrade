"""Shared pagination for the KukGrade API.

Every list endpoint is paginated, including small reference collections such
as ranks and syllabus items. Uniformity is deliberate: the frontend needs one
unwrap helper rather than a table of which endpoints are enveloped, and no
endpoint can quietly start returning an unbounded result set as data grows.
"""

from __future__ import annotations

from rest_framework.pagination import PageNumberPagination


class DefaultPagination(PageNumberPagination):
    # The default page. A screen that needs a whole list, such as an
    # assessment's items, asks for pages of up to max_page_size and reads
    # every page.
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
