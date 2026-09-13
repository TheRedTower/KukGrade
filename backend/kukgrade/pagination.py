"""Shared pagination for the KukGrade API.

Every list endpoint is paginated, including small reference collections such
as ranks and syllabus items. Uniformity is deliberate: the frontend needs one
unwrap helper rather than a table of which endpoints are enveloped, and no
endpoint can quietly start returning an unbounded result set as data grows.
"""

from __future__ import annotations

from rest_framework.pagination import PageNumberPagination


class DefaultPagination(PageNumberPagination):
    # 50 is chosen so a single candidate's assessment, typically around 40
    # snapshot items, fits on one page.
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
