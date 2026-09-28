from __future__ import annotations

import pytest
from django.contrib.admin.sites import site
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Model
from django.test import RequestFactory
from rest_framework.test import APIClient

from accounts.models import User
from kukgrade.testing import results
from ranks.models import BeltColour, Rank
from syllabus.models import SyllabusItem, SyllabusRequirement

pytestmark = pytest.mark.django_db

REQUIRED_RANKS = [
    ("WHITE", "White", 1, Rank.Category.COLOURED_BELT),
    ("YELLOW_STRIPE", "Yellow Stripe", 2, Rank.Category.COLOURED_BELT),
    ("YELLOW", "Yellow", 3, Rank.Category.COLOURED_BELT),
    ("BLUE_STRIPE", "Blue Stripe", 4, Rank.Category.COLOURED_BELT),
    ("BLUE", "Blue", 5, Rank.Category.COLOURED_BELT),
    ("RED_STRIPE", "Red Stripe", 6, Rank.Category.COLOURED_BELT),
    ("RED", "Red", 7, Rank.Category.COLOURED_BELT),
    ("BROWN_STRIPE", "Brown Stripe", 8, Rank.Category.COLOURED_BELT),
    ("BROWN", "Brown", 9, Rank.Category.COLOURED_BELT),
    ("BLACK_STRIPE", "Black Stripe", 10, Rank.Category.COLOURED_BELT),
    ("DAHN_BO", "Dahn Bo", 11, Rank.Category.BLACK_BELT_CANDIDATE),
    ("JKN", "JKN", 12, Rank.Category.BLACK_BELT),
    ("KSN", "KSN", 13, Rank.Category.BLACK_BELT),
    ("PSBN", "PSBN", 14, Rank.Category.BLACK_BELT),
    ("SBN", "SBN", 15, Rank.Category.BLACK_BELT),
    ("PKJN", "PKJN", 16, Rank.Category.BLACK_BELT),
]


def rank_kwargs(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "code": "TEST_RANK",
        "name": "Test Rank",
        "order": 99,
        "category": Rank.Category.COLOURED_BELT,
        "belt_colour": BeltColour.WHITE,
    }
    data.update(overrides)
    return data


def test_rank_catalogue_is_seeded_exactly() -> None:
    ranks = list(Rank.objects.values_list("code", "name", "order", "category"))

    assert ranks == REQUIRED_RANKS
    assert Rank.objects.count() == 16


def test_rank_orders_are_unique_and_define_progression_order() -> None:
    orders = list(Rank.objects.values_list("order", flat=True))
    names = list(Rank.objects.values_list("name", flat=True))

    assert orders == list(range(1, 17))
    assert len(orders) == len(set(orders))
    assert names == [name for _code, name, _order, _category in REQUIRED_RANKS]


def test_seeded_ranks_are_active_and_categorised() -> None:
    ranks_by_code = {rank.code: rank for rank in Rank.objects.all()}

    assert all(rank.active for rank in ranks_by_code.values())
    assert ranks_by_code["WHITE"].category == Rank.Category.COLOURED_BELT
    assert ranks_by_code["BLACK_STRIPE"].category == Rank.Category.COLOURED_BELT
    assert ranks_by_code["DAHN_BO"].category == Rank.Category.BLACK_BELT_CANDIDATE
    assert ranks_by_code["JKN"].category == Rank.Category.BLACK_BELT
    assert ranks_by_code["PKJN"].category == Rank.Category.BLACK_BELT
    assert str(ranks_by_code["WHITE"]) == "1. White"


def test_duplicate_rank_code_is_rejected_by_database() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Rank.objects.bulk_create(
            [
                Rank(
                    **rank_kwargs(
                        code="WHITE",
                        name="Duplicate White",
                    ),
                ),
            ],
        )


def test_duplicate_rank_order_is_rejected_by_database() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Rank.objects.bulk_create(
            [
                Rank(
                    **rank_kwargs(
                        code="DUPLICATE_ORDER",
                        name="Duplicate Order",
                        order=1,
                    ),
                ),
            ],
        )


def test_duplicate_rank_name_is_rejected_by_database() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Rank.objects.bulk_create(
            [
                Rank(
                    **rank_kwargs(
                        code="DUPLICATE_NAME",
                        name="White",
                    ),
                ),
            ],
        )


def test_blank_rank_code_is_rejected_by_validation_and_database() -> None:
    rank = Rank(**rank_kwargs(code="   "))

    with pytest.raises(ValidationError) as exc_info:
        rank.full_clean()

    assert "Rank code is required." in exc_info.value.message_dict["code"]

    with pytest.raises(IntegrityError), transaction.atomic():
        Rank.objects.bulk_create([Rank(**rank_kwargs(code=""))])


def test_blank_rank_name_is_rejected_by_validation_and_database() -> None:
    rank = Rank(**rank_kwargs(name="   "))

    with pytest.raises(ValidationError) as exc_info:
        rank.full_clean()

    assert "Rank name is required." in exc_info.value.message_dict["name"]

    with pytest.raises(IntegrityError), transaction.atomic():
        Rank.objects.bulk_create([Rank(**rank_kwargs(name=""))])


def test_non_positive_rank_order_is_rejected_by_validation_and_database() -> None:
    rank = Rank(**rank_kwargs(order=0))

    with pytest.raises(ValidationError) as exc_info:
        rank.full_clean()

    assert "Rank order must be positive." in exc_info.value.message_dict["order"]

    with pytest.raises(IntegrityError), transaction.atomic():
        Rank.objects.bulk_create([Rank(**rank_kwargs(order=0))])


def test_invalid_rank_category_is_rejected_by_validation_and_database() -> None:
    rank = Rank(**rank_kwargs(category="INVALID"))

    with pytest.raises(ValidationError) as exc_info:
        rank.full_clean()

    assert "category" in exc_info.value.message_dict

    with pytest.raises(IntegrityError), transaction.atomic():
        Rank.objects.bulk_create([Rank(**rank_kwargs(category="INVALID"))])


def test_rank_api_requires_authentication() -> None:
    response = APIClient().get("/api/ranks/")

    assert response.status_code == 403


def test_rank_api_returns_active_ranks_in_progression_order() -> None:
    user = User.objects.create_user(email="rank-reader@example.com")
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get("/api/ranks/")

    assert response.status_code == 200
    payload = results(response)
    assert [rank["code"] for rank in payload] == [
        code for code, _name, _order, _category in REQUIRED_RANKS
    ]
    assert payload[0] == {
        "id": Rank.objects.get(code="WHITE").id,
        "code": "WHITE",
        "name": "White",
        "order": 1,
        "category": Rank.Category.COLOURED_BELT,
        "category_display": "Coloured belt",
        "belt_colour": "WHITE",
        "stripe_colour": "",
        "active": True,
        "next_rank": Rank.objects.get(code="YELLOW_STRIPE").id,
    }
    assert payload[-1]["next_rank"] is None


def test_next_rank_skips_inactive_ranks() -> None:
    # The served next rank and the grading services share one rule.
    from gradings.services import get_next_active_rank

    Rank.objects.filter(code="YELLOW_STRIPE").update(active=False)
    white = Rank.objects.get(code="WHITE")
    client = APIClient()
    client.force_authenticate(
        user=User.objects.create_user(email="rank-next@example.com")
    )

    served = results(client.get("/api/ranks/"))[0]["next_rank"]

    assert served == Rank.objects.get(code="YELLOW").id
    next_rank = get_next_active_rank(white)
    assert next_rank is not None and next_rank.id == served


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/ranks/"),
        ("put", "/api/ranks/"),
        ("patch", "/api/ranks/"),
        ("delete", "/api/ranks/"),
    ],
)
def test_rank_api_rejects_write_methods(method: str, path: str) -> None:
    user = User.objects.create_user(email="rank-writer@example.com")
    client = APIClient()
    client.force_authenticate(user=user)

    request = getattr(client, method)
    response = request(
        path,
        rank_kwargs(code="API_RANK", name="API Rank", order=20),
        format="json",
    )

    assert response.status_code == 405


@pytest.mark.parametrize("model", [Rank, SyllabusItem, SyllabusRequirement])
def test_catalogue_is_read_only_in_django_admin(model: type[Model]) -> None:
    # Even a superuser, who otherwise bypasses every permission check, can
    # only view ranks and the syllabus: edits there would change how past
    # records read and would not be audited.
    request = RequestFactory().get("/admin/")
    request.user = User.objects.create_superuser(
        email=f"catalogue-{model.__name__.lower()}@example.com",
        password="a-long-test-password-123",
    )
    model_admin = site._registry[model]

    assert model_admin.has_view_permission(request) is True
    assert model_admin.has_add_permission(request) is False
    assert model_admin.has_change_permission(request) is False
    assert model_admin.has_delete_permission(request) is False


def test_every_coloured_rank_is_the_belt_below_with_a_stripe_towards_the_next() -> None:
    belts = {
        rank.code: (rank.belt_colour, rank.stripe_colour)
        for rank in Rank.objects.filter(category=Rank.Category.COLOURED_BELT)
    }

    assert belts == {
        "WHITE": ("WHITE", ""),
        "YELLOW_STRIPE": ("WHITE", "YELLOW"),
        "YELLOW": ("YELLOW", ""),
        "BLUE_STRIPE": ("YELLOW", "BLUE"),
        "BLUE": ("BLUE", ""),
        "RED_STRIPE": ("BLUE", "RED"),
        "RED": ("RED", ""),
        "BROWN_STRIPE": ("RED", "BROWN"),
        "BROWN": ("BROWN", ""),
        "BLACK_STRIPE": ("BROWN", "BLACK"),
    }


def test_a_stripe_must_differ_from_its_belt() -> None:
    rank = Rank(**rank_kwargs(stripe_colour=BeltColour.WHITE))

    with pytest.raises(ValidationError) as exc_info:
        rank.full_clean()

    assert "stripe_colour" in exc_info.value.message_dict


def test_an_unknown_belt_colour_is_rejected_by_the_database() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        Rank.objects.bulk_create([Rank(**rank_kwargs(belt_colour="PURPLE"))])


def test_the_rank_api_serves_each_belt() -> None:
    client = APIClient()
    client.force_authenticate(user=User.objects.create_user(email="belts@example.com"))

    rows = {row["code"]: row for row in results(client.get("/api/ranks/?page_size=50"))}

    blue_stripe = rows["BLUE_STRIPE"]
    assert blue_stripe["belt_colour"] == "YELLOW"
    assert blue_stripe["stripe_colour"] == "BLUE"
    assert rows["BLUE"]["stripe_colour"] == ""
