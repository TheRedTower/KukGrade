from __future__ import annotations

from django.urls import path

from about import views

urlpatterns = [
    path("about/", views.about, name="about"),
    path("about/documents/<slug:slug>/", views.document, name="about-document"),
    path("about/pledge/", views.pledge, name="about-pledge"),
    path("about/credits/", views.credits, name="about-credits"),
    path("about/credits/notices/", views.credits_notices, name="about-credits-notices"),
]
