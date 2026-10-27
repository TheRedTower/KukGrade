from __future__ import annotations

import importlib
from collections import Counter

import pytest
from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.models.deletion import ProtectedError
from rest_framework.test import APIClient

from accounts.models import User
from kukgrade.testing import results
from ranks.models import Rank
from syllabus.models import (
    AGE_BAND_DESCRIPTION,
    AGE_BAND_PROGRAMME,
    AgeBand,
    SyllabusItem,
    SyllabusRequirement,
)
from syllabus.services import (
    cumulative_notation,
    effective_syllabus_requirements,
    normalize_chart_notation,
)

pytestmark = pytest.mark.django_db


def yellow_stripe_rank() -> Rank:
    return Rank.objects.get(code="YELLOW_STRIPE")


def item_kwargs(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "code": "TEST_ITEM",
        "name": "Test Item",
        "korean_name": "시험",
        "category": SyllabusItem.Category.TECHNIQUE_SET,
        "description": "",
    }
    data.update(overrides)
    return data


def requirement_kwargs(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "rank": yellow_stripe_rank(),
        "age_band": AgeBand.AGE_9_TO_12,
        "required": True,
        "sequence": 100,
        "start_number": 1,
        "end_number": 5,
        "notes": "",
    }
    if "item" not in overrides:
        data["item"] = SyllabusItem.objects.create(
            **item_kwargs(code=f"REQ_ITEM_{SyllabusItem.objects.count() + 1}"),
        )
    data.update(overrides)
    return data


def auth_client(email: str = "syllabus-reader@example.com") -> APIClient:
    user = User.objects.create_user(email=email)
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_valid_syllabus_item_can_be_created() -> None:
    item = SyllabusItem.objects.create(**item_kwargs())

    assert item.pk is not None
    assert item.code == "TEST_ITEM"
    assert item.name == "Test Item"
    assert item.korean_name == "시험"
    assert item.category == SyllabusItem.Category.TECHNIQUE_SET
    assert item.active is True
    assert item.created_at is not None
    assert item.updated_at is not None
    assert str(item) == "TEST_ITEM: Test Item"


def test_duplicate_syllabus_item_code_is_rejected_by_database() -> None:
    SyllabusItem.objects.create(**item_kwargs())

    with pytest.raises(IntegrityError), transaction.atomic():
        SyllabusItem.objects.bulk_create(
            [SyllabusItem(**item_kwargs(name="Duplicate Test Item"))],
        )


def test_blank_syllabus_item_code_is_rejected_by_validation_and_database() -> None:
    item = SyllabusItem(**item_kwargs(code="   "))

    with pytest.raises(ValidationError) as exc_info:
        item.full_clean()

    assert "Syllabus item code is required." in exc_info.value.message_dict["code"]

    with pytest.raises(IntegrityError), transaction.atomic():
        SyllabusItem.objects.bulk_create([SyllabusItem(**item_kwargs(code=""))])


def test_blank_syllabus_item_name_is_rejected_by_validation_and_database() -> None:
    item = SyllabusItem(**item_kwargs(name="   "))

    with pytest.raises(ValidationError) as exc_info:
        item.full_clean()

    assert "Syllabus item name is required." in exc_info.value.message_dict["name"]

    with pytest.raises(IntegrityError), transaction.atomic():
        SyllabusItem.objects.bulk_create([SyllabusItem(**item_kwargs(name=""))])


def test_invalid_syllabus_item_category_is_rejected_at_database_level() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        SyllabusItem.objects.bulk_create(
            [SyllabusItem(**item_kwargs(category="INVALID"))],
        )


def test_syllabus_item_name_does_not_require_global_uniqueness() -> None:
    SyllabusItem.objects.create(**item_kwargs(code="ITEM_A", name="Repeated Name"))
    SyllabusItem.objects.create(**item_kwargs(code="ITEM_B", name="Repeated Name"))

    assert SyllabusItem.objects.filter(name="Repeated Name").count() == 2


def test_valid_syllabus_requirement_can_be_created() -> None:
    requirement = SyllabusRequirement.objects.create(**requirement_kwargs())

    assert requirement.pk is not None
    assert requirement.rank == yellow_stripe_rank()
    assert requirement.item.code.startswith("REQ_ITEM_")
    assert requirement.age_band == AgeBand.AGE_9_TO_12
    assert requirement.required is True
    assert requirement.sequence == 100
    assert requirement.display_range == "1-5"
    assert requirement.active is True


def test_duplicate_rank_age_item_requirement_is_rejected_by_database() -> None:
    item = SyllabusItem.objects.create(**item_kwargs(code="DUP_REQ_ITEM"))
    SyllabusRequirement.objects.create(**requirement_kwargs(item=item))

    with pytest.raises(IntegrityError), transaction.atomic():
        SyllabusRequirement.objects.bulk_create(
            [SyllabusRequirement(**requirement_kwargs(item=item, sequence=110))],
        )


def test_invalid_requirement_age_band_is_rejected_at_database_level() -> None:
    with pytest.raises(IntegrityError), transaction.atomic():
        SyllabusRequirement.objects.bulk_create(
            [SyllabusRequirement(**requirement_kwargs(age_band="INVALID"))],
        )


def test_requirement_sequence_must_be_positive() -> None:
    requirement = SyllabusRequirement(**requirement_kwargs(sequence=0))

    with pytest.raises(ValidationError) as exc_info:
        requirement.full_clean()

    assert "Sequence must be positive." in exc_info.value.message_dict["sequence"]

    with pytest.raises(IntegrityError), transaction.atomic():
        SyllabusRequirement.objects.bulk_create(
            [SyllabusRequirement(**requirement_kwargs(sequence=0))],
        )


def test_deleting_referenced_rank_is_blocked_by_protect() -> None:
    rank = Rank.objects.create(
        code="PROTECTED_RANK",
        name="Protected Rank",
        order=99,
        category=Rank.Category.COLOURED_BELT,
        belt_colour="WHITE",
    )
    SyllabusRequirement.objects.create(**requirement_kwargs(rank=rank))

    with pytest.raises(ProtectedError):
        rank.delete()


def test_deleting_referenced_item_is_blocked_by_protect() -> None:
    item = SyllabusItem.objects.create(**item_kwargs(code="PROTECTED_ITEM"))
    SyllabusRequirement.objects.create(**requirement_kwargs(item=item))

    with pytest.raises(ProtectedError):
        item.delete()


def test_start_without_end_is_rejected() -> None:
    requirement = SyllabusRequirement(**requirement_kwargs(end_number=None))

    with pytest.raises(ValidationError) as exc_info:
        requirement.full_clean()

    assert (
        "Start and end numbers must be provided together."
        in exc_info.value.message_dict["end_number"]
    )


def test_end_without_start_is_rejected() -> None:
    requirement = SyllabusRequirement(**requirement_kwargs(start_number=None))

    with pytest.raises(ValidationError) as exc_info:
        requirement.full_clean()

    assert (
        "Start and end numbers must be provided together."
        in exc_info.value.message_dict["start_number"]
    )


def test_end_lower_than_start_is_rejected() -> None:
    requirement = SyllabusRequirement(
        **requirement_kwargs(start_number=5, end_number=1)
    )

    with pytest.raises(ValidationError) as exc_info:
        requirement.full_clean()

    assert (
        "End number must be greater than or equal to start number."
        in exc_info.value.message_dict["end_number"]
    )


def test_null_range_is_allowed_for_non_numbered_requirements() -> None:
    requirement = SyllabusRequirement.objects.create(
        **requirement_kwargs(start_number=None, end_number=None),
    )

    assert requirement.display_range == ""


def test_expected_core_syllabus_items_are_seeded_with_hangul() -> None:
    expected = {
        "KI_BOHN_SOO": ("Ki Bohn Soo", "기본수"),
        "SOHN_MOHK_SOO": ("Sohn Mohk Soo", "손목수"),
        "EUE_BOHK_SOO": ("Eue Bohk Soo", "의복수"),
        "JOO_MUHK_MAGA_KI_BON_SOO": ("Joo Muhk Maga Ki Bon Soo", "주먹막아 기본수"),
        "GUHM_MOO_HYUNG": ("Guhm Moo Hyung", "검무형"),
        "BOHNG_DOL_LI_KI": ("Bohng Dol-li-ki", "봉돌리기"),
    }

    items = SyllabusItem.objects.in_bulk(expected.keys(), field_name="code")

    assert set(items) == set(expected)
    for code, (name, korean_name) in expected.items():
        assert items[code].name == name
        assert items[code].korean_name == korean_name


def test_exact_seeded_requirements_exist() -> None:
    expected = [
        ("YELLOW", AgeBand.AGE_8_AND_UNDER, "KI_BOHN_SOO", 1, 5, True),
        ("YELLOW", AgeBand.AGE_9_TO_12, "KI_BOHN_SOO", 1, 10, True),
        ("YELLOW", AgeBand.AGE_13_TO_17, "KI_BOHN_SOO", 1, 15, True),
        ("YELLOW", AgeBand.AGE_18_AND_OVER, "KI_BOHN_SOO", 1, 15, True),
        ("BLACK_STRIPE", AgeBand.AGE_9_TO_12, "MAEK_CHI_KI", 1, 7, True),
        ("BLACK_STRIPE", AgeBand.AGE_18_AND_OVER, "MAEK_CHA_KI", 1, 15, True),
        ("JKN", AgeBand.AGE_8_AND_UNDER, "BOHNG_DOL_LI_KI", 1, 10, True),
        ("JKN", AgeBand.AGE_18_AND_OVER, "BOHNG_DOL_LI_KI", 1, 15, True),
        ("JKN", AgeBand.AGE_13_TO_17, "TOO_KI", 1, 13, True),
        ("JKN", AgeBand.AGE_18_AND_OVER, "BAHNG_TOO_KI", 1, 10, True),
    ]

    for rank_code, age_band, item_code, start, end, required in expected:
        requirement = SyllabusRequirement.objects.get(
            rank__code=rank_code,
            age_band=age_band,
            item__code=item_code,
        )
        assert requirement.start_number == start
        assert requirement.end_number == end
        assert requirement.required is required


def test_no_duplicate_seeded_requirement_mappings_exist() -> None:
    keys = list(
        SyllabusRequirement.objects.values_list("rank_id", "age_band", "item_id"),
    )

    duplicates = [key for key, count in Counter(keys).items() if count > 1]

    assert duplicates == []


def test_all_seeded_requirement_ranks_exist_and_do_not_exceed_pkjn() -> None:
    rank_orders = list(
        Rank.objects.filter(syllabus_requirements__isnull=False)
        .distinct()
        .values_list("order", flat=True),
    )

    assert rank_orders
    assert max(rank_orders) <= Rank.objects.get(code="PKJN").order


def test_all_four_age_bands_are_represented_in_seeded_requirements() -> None:
    assert set(SyllabusRequirement.objects.values_list("age_band", flat=True)) == set(
        AgeBand.values,
    )


def test_ambiguous_optional_black_belt_material_is_not_seeded_as_requirement() -> None:
    optional_codes = ["YAHNG_SOHN_MOHK_SOO", "SSAHNG_SOO", "DAHN_DOH_MAHK_KI"]

    requirements = SyllabusRequirement.objects.filter(
        rank__code="JKN",
        item__code__in=optional_codes,
    )

    assert requirements.count() == 0
    assert SyllabusItem.objects.filter(code__in=optional_codes).count() == 3


# ---------------------------------------------------------------------------
# Cumulative effective requirements
# ---------------------------------------------------------------------------


def test_effective_syllabus_requirement_api_requires_authentication() -> None:
    response = APIClient().get(
        "/api/syllabus/requirements/effective/"
        f"?rank_code=BLUE_STRIPE&age_band={AgeBand.AGE_13_TO_17}",
    )

    assert response.status_code == 403


def test_effective_syllabus_requirement_api_rejects_invalid_parameters() -> None:
    client = auth_client()

    missing = client.get("/api/syllabus/requirements/effective/")
    unknown_rank = client.get(
        "/api/syllabus/requirements/effective/"
        f"?rank_code=NOT_A_RANK&age_band={AgeBand.AGE_13_TO_17}",
    )
    bad_age_band = client.get(
        "/api/syllabus/requirements/effective/?rank_code=BLUE_STRIPE&age_band=nonsense",
    )

    assert missing.status_code == 400
    assert "rank_code" in missing.json()["error"]["fields"]
    assert "age_band" in missing.json()["error"]["fields"]
    assert unknown_rank.status_code == 400
    assert bad_age_band.status_code == 400


def test_effective_syllabus_requirement_blue_stripe_regression() -> None:
    """The exact worked example from the specification, against seeded data.

    Blue Stripe, Adult/Youth 13-17: Sohn Ppae Ki is unchanged since Yellow
    Stripe; Ki Bohn Soo's range was extended at Yellow, so 1-15 (not the
    earlier 1-5) is the effective row; Sohn Mohk Soo and the second part of
    Cho Geup Hyung are introduced at Blue Stripe itself.
    """
    client = auth_client()

    response = client.get(
        "/api/syllabus/requirements/effective/"
        f"?rank_code=BLUE_STRIPE&age_band={AgeBand.AGE_13_TO_17}",
    )

    assert response.status_code == 200
    by_name = {row["item_name"]: row for row in results(response)}

    sohn_ppae_ki = by_name["Sohn Ppae Ki"]
    assert sohn_ppae_ki["display_range"] == "1-5"
    assert sohn_ppae_ki["introduced_rank_code"] == "YELLOW_STRIPE"
    assert sohn_ppae_ki["effective_since_rank_code"] == "YELLOW_STRIPE"
    assert sohn_ppae_ki["is_new_at_rank"] is False

    ki_bohn_soo = by_name["Ki Bohn Soo"]
    assert ki_bohn_soo["display_range"] == "1-15"
    assert ki_bohn_soo["introduced_rank_code"] == "YELLOW_STRIPE"
    assert ki_bohn_soo["effective_since_rank_code"] == "YELLOW"
    assert ki_bohn_soo["is_new_at_rank"] is False

    sohn_mohk_soo = by_name["Sohn Mohk Soo"]
    assert sohn_mohk_soo["display_range"] == "1-5"
    assert sohn_mohk_soo["introduced_rank_code"] == "BLUE_STRIPE"
    assert sohn_mohk_soo["effective_since_rank_code"] == "BLUE_STRIPE"
    assert sohn_mohk_soo["is_new_at_rank"] is True

    cho_geup_hyung = by_name["Cho Geup Hyung"]
    assert cho_geup_hyung["display_range"] == ""
    assert cho_geup_hyung["notation"] == "Part 1 of 2"
    assert cho_geup_hyung["introduced_rank_code"] == "BLUE_STRIPE"
    assert cho_geup_hyung["is_new_at_rank"] is True

    ki_cho_hyung = by_name["Ki Cho Hyung"]
    assert ki_cho_hyung["notation"] == "1-6"
    assert ki_cho_hyung["introduced_rank_code"] == "YELLOW_STRIPE"
    assert ki_cho_hyung["effective_since_rank_code"] == "YELLOW"
    assert ki_cho_hyung["is_new_at_rank"] is False


def ledger(category: str, *rows: tuple[str, str]) -> list[tuple[str, str, str]]:
    return [(category, code, shown) for code, shown in rows]


CORE_AREAS = [
    ("ETIQUETTE", "YEA_EUE", ""),
    ("FUNDAMENTALS", "KI_CHO_JAH_KI", ""),
    ("HAND_TECHNIQUES", "SOO_KI", ""),
    ("KICKING", "JOHK_SOOL", ""),
    ("FALLING", "NAHK_BUP", ""),
    ("BREAKING", "KYUK_PAH", ""),
]
ADULT_COLOURED_BELT_TECHNIQUES = (
    ("SOHN_PPAE_KI", "1-5"),
    ("KI_BOHN_SOO", "1-15"),
    ("SOHN_MOHK_SOO", "1-11"),
    ("EUE_BOHK_SOO", "1-13"),
    ("AHN_SOHN_MOHK_SOO", "1-6"),
    ("MAEK_CHI_KI", "1-15"),
    ("MAEK_CHA_KI", "1-15"),
    ("JOO_MUHK_MAGA_KI_BON_SOO", "1-15"),
)
YOUTH_BLACK_BELT_TECHNIQUES = (
    ("JOONG_GEUP_SOHN_MOHK_SOO", "1-7"),
    ("AHP_EUE_BOHK_SOO", "1-20"),
    ("DEE_EUE_BOHK_SOO", "1-23"),
    ("KWAHN_JUHL_KI", "1-13"),
    ("TOO_KI", "1-13"),
)
JKN_FORMS_AFTER_CHO_GEUP = (
    ("JOONG_GEUP_HYUNG", ""),
    ("GOH_GEUP_HYUNG", ""),
    ("DAE_GEUP_HYUNG", ""),
    ("GUHM_MOO_HYUNG", ""),
)

# Owner decisions of 2026-09-29: every grading assesses everything examinable
# through the testing rank; at JKN adults do all seven black-belt technique
# sets, juniors spin the staff 1-10 and everyone else 1-15. Each row is
# (category, item, range or chart notation as shown), in syllabus order.
WORKED_EXAMPLES = [
    (
        "BLUE_STRIPE",
        AgeBand.AGE_8_AND_UNDER,
        [
            *CORE_AREAS,
            *ledger("TECHNIQUE_SET", ("SOHN_PPAE_KI", "1-5"), ("KI_BOHN_SOO", "1-10")),
            *ledger("FORM", ("KI_CHO_HYUNG", "1-6")),
        ],
    ),
    (
        "BLUE_STRIPE",
        AgeBand.AGE_9_TO_12,
        [
            *CORE_AREAS,
            *ledger("TECHNIQUE_SET", ("SOHN_PPAE_KI", "1-5"), ("KI_BOHN_SOO", "1-15")),
            *ledger("FORM", ("KI_CHO_HYUNG", "1-6"), ("CHO_GEUP_HYUNG", "")),
        ],
    ),
    *[
        (
            "BLUE_STRIPE",
            age_band,
            [
                *CORE_AREAS,
                *ledger(
                    "TECHNIQUE_SET",
                    ("SOHN_PPAE_KI", "1-5"),
                    ("KI_BOHN_SOO", "1-15"),
                    ("SOHN_MOHK_SOO", "1-5"),
                ),
                *ledger(
                    "FORM",
                    ("KI_CHO_HYUNG", "1-6"),
                    ("CHO_GEUP_HYUNG", "Part 1 of 2"),
                ),
            ],
        )
        for age_band in (AgeBand.AGE_13_TO_17, AgeBand.AGE_18_AND_OVER)
    ],
    (
        "JKN",
        AgeBand.AGE_8_AND_UNDER,
        [
            *CORE_AREAS,
            *ledger(
                "TECHNIQUE_SET",
                ("SOHN_PPAE_KI", "1-5"),
                ("KI_BOHN_SOO", "1-15"),
                ("SOHN_MOHK_SOO", "1-11"),
                ("EUE_BOHK_SOO", "1-13"),
                ("AHN_SOHN_MOHK_SOO", "1-6"),
                ("MAEK_CHI_KI", "1-15"),
                ("MAEK_CHA_KI", "1-15"),
                ("JOO_MUHK_MAGA_KI_BON_SOO", "1-15"),
            ),
            *ledger(
                "FORM",
                ("KI_CHO_HYUNG", "1-6"),
                ("CHO_GEUP_HYUNG", "Parts 1-3"),
                *JKN_FORMS_AFTER_CHO_GEUP,
            ),
            *ledger("WEAPONS", ("SWORD_TECHS", "1-5"), ("BOHNG_DOL_LI_KI", "1-10")),
        ],
    ),
    (
        "JKN",
        AgeBand.AGE_9_TO_12,
        [
            *CORE_AREAS,
            *ledger(
                "TECHNIQUE_SET",
                ("SOHN_PPAE_KI", "1-5"),
                ("KI_BOHN_SOO", "1-15"),
                ("SOHN_MOHK_SOO", "1-11"),
                ("EUE_BOHK_SOO", "1-13"),
                ("AHN_SOHN_MOHK_SOO", "1-6"),
                ("MAEK_CHI_KI", "1-15"),
                ("JOONG_GEUP_SOHN_MOHK_SOO", "1-7"),
                ("AHP_EUE_BOHK_SOO", "1-20"),
            ),
            *ledger(
                "FORM",
                ("KI_CHO_HYUNG", "1-6"),
                ("CHO_GEUP_HYUNG", ""),
                *JKN_FORMS_AFTER_CHO_GEUP,
            ),
            *ledger("WEAPONS", ("SWORD_TECHS", "1-5"), ("BOHNG_DOL_LI_KI", "1-10")),
        ],
    ),
    (
        "JKN",
        AgeBand.AGE_13_TO_17,
        [
            *CORE_AREAS,
            *ledger(
                "TECHNIQUE_SET",
                *ADULT_COLOURED_BELT_TECHNIQUES,
                *YOUTH_BLACK_BELT_TECHNIQUES,
            ),
            *ledger(
                "FORM",
                ("KI_CHO_HYUNG", "1-6"),
                ("CHO_GEUP_HYUNG", ""),
                *JKN_FORMS_AFTER_CHO_GEUP,
            ),
            *ledger("WEAPONS", ("SWORD_TECHS", "1-5"), ("BOHNG_DOL_LI_KI", "1-15")),
        ],
    ),
    (
        "JKN",
        AgeBand.AGE_18_AND_OVER,
        [
            *CORE_AREAS,
            *ledger(
                "TECHNIQUE_SET",
                *ADULT_COLOURED_BELT_TECHNIQUES,
                *YOUTH_BLACK_BELT_TECHNIQUES,
                ("MOHK_JOH_LEU_KI", "1-5"),
                ("BAHNG_TOO_KI", "1-10"),
            ),
            *ledger(
                "FORM",
                ("KI_CHO_HYUNG", "1-6"),
                ("CHO_GEUP_HYUNG", ""),
                *JKN_FORMS_AFTER_CHO_GEUP,
            ),
            *ledger("WEAPONS", ("SWORD_TECHS", "1-5"), ("BOHNG_DOL_LI_KI", "1-15")),
        ],
    ),
]


@pytest.mark.parametrize(("rank_code", "age_band", "expected"), WORKED_EXAMPLES)
def test_effective_syllabus_is_everything_examinable_through_the_rank(
    rank_code: str,
    age_band: str,
    expected: list[tuple[str, str, str]],
) -> None:
    response = auth_client().get(
        "/api/syllabus/requirements/effective/",
        {"rank_code": rank_code, "age_band": age_band, "page_size": "200"},
    )

    assert response.status_code == 200
    rows = results(response)
    assert [
        (row["category"], row["item_code"], row["display_range"] or row["notation"])
        for row in rows
    ] == expected
    # Which rows are core areas is served, not kept in the browser (F-31).
    assert {row["category"] for row in rows if row["category_is_core"]} == {
        "ETIQUETTE",
        "FUNDAMENTALS",
        "HAND_TECHNIQUES",
        "KICKING",
        "FALLING",
        "BREAKING",
    }
    assert all(row["required"] for row in rows)


@pytest.mark.parametrize("rank_code", ["WHITE", "KSN", "PKJN"])
@pytest.mark.parametrize("age_band", AgeBand.values)
def test_effective_syllabus_is_empty_for_a_rank_with_no_recorded_syllabus(
    rank_code: str,
    age_band: str,
) -> None:
    # KSN and above have no syllabus recorded yet. Serving everything through
    # JKN for them would present it as their whole curriculum.
    response = auth_client().get(
        "/api/syllabus/requirements/effective/",
        {"rank_code": rank_code, "age_band": age_band},
    )

    assert response.status_code == 200
    assert results(response) == []


def test_effective_syllabus_serves_each_category_label() -> None:
    response = auth_client().get(
        "/api/syllabus/requirements/effective/",
        {"rank_code": "JKN", "age_band": AgeBand.AGE_18_AND_OVER, "page_size": "200"},
    )

    labels = {row["category"]: row["category_display"] for row in results(response)}
    assert labels == {
        category: label
        for category, label in SyllabusItem.Category.choices
        if category != SyllabusItem.Category.OTHER
    }


def test_syllabus_items_endpoint_is_gone() -> None:
    # The effective view serves every category, the core areas included.
    assert auth_client().get("/api/syllabus/items/").status_code == 404


def test_effective_syllabus_requirement_is_isolated_by_age_band() -> None:
    client = auth_client()

    junior = client.get(
        "/api/syllabus/requirements/effective/"
        f"?rank_code=YELLOW&age_band={AgeBand.AGE_9_TO_12}",
    )
    adult = client.get(
        "/api/syllabus/requirements/effective/"
        f"?rank_code=YELLOW&age_band={AgeBand.AGE_18_AND_OVER}",
    )

    assert junior.status_code == 200
    assert adult.status_code == 200
    # Different age bands are seeded independently, so at least the presence
    # or exact content of items is not required to match row-for-row - this
    # only proves the parameter actually scopes the query rather than being
    # ignored.
    assert results(junior) != results(adult)


def test_effective_syllabus_requirement_ordering_is_deterministic() -> None:
    client = auth_client()

    response = client.get(
        "/api/syllabus/requirements/effective/"
        f"?rank_code=BLUE_STRIPE&age_band={AgeBand.AGE_13_TO_17}",
    )

    assert response.status_code == 200
    served = [(row["category"], row["item_name"]) for row in results(response)]
    rank = Rank.objects.get(code="BLUE_STRIPE")
    expected = [
        (row.requirement.item.category, row.requirement.item.name)
        for row in effective_syllabus_requirements(
            rank=rank, age_band=AgeBand.AGE_13_TO_17
        )
    ]
    assert served == expected


def test_effective_syllabus_requirement_domain_function_matches_api() -> None:
    """Same worked example, called directly against the service function."""
    rank = Rank.objects.get(code="BLUE_STRIPE")

    rows = effective_syllabus_requirements(rank=rank, age_band=AgeBand.AGE_13_TO_17)

    by_name = {row.requirement.item.name: row for row in rows}
    assert by_name["Ki Bohn Soo"].requirement.display_range == "1-15"
    assert by_name["Ki Bohn Soo"].introduced_rank.code == "YELLOW_STRIPE"
    assert by_name["Ki Bohn Soo"].effective_since_rank.code == "YELLOW"
    assert by_name["Ki Bohn Soo"].is_new_at_rank is False
    assert by_name["Sohn Mohk Soo"].is_new_at_rank is True


@pytest.mark.parametrize(
    ("notes", "expected"),
    [
        ("Chart notation: (1/2).", "Part 1 of 2"),
        ("Chart notation: (pt.1).", "Part 1"),
        ("Chart notation: (1-3).", "1-3"),
        ("Chart notation: (1 & 2).", "1 & 2"),
        ("Required for Black Belt Promotion for Age 13-17.", ""),
        ("", ""),
    ],
)
def test_normalize_chart_notation(notes: str, expected: str) -> None:
    assert normalize_chart_notation(notes) == expected


# 8-and-under Cho Geup Hyung is taught in parts: 1 at Blue, 2 at Red stripe,
# 3 at Red. Every part taught so far is examinable, so the cumulative row
# names them all (2026-10-18, audit F-09).
@pytest.mark.parametrize(
    ("rank_code", "expected"),
    [
        ("BLUE", "Part 1"),
        ("RED_STRIPE", "Parts 1-2"),
        ("RED", "Parts 1-3"),
        ("BROWN", "Parts 1-3"),
    ],
)
def test_a_form_taught_in_parts_names_every_part_taught_so_far(
    rank_code: str,
    expected: str,
) -> None:
    rows = effective_syllabus_requirements(
        rank=Rank.objects.get(code=rank_code),
        age_band=AgeBand.AGE_8_AND_UNDER,
    )

    by_code = {row.requirement.item.code: row for row in rows}
    assert by_code["CHO_GEUP_HYUNG"].notation == expected


@pytest.mark.parametrize(
    ("notes", "expected"),
    [
        # Half the form, then the whole form: the whole form stands.
        (["Chart notation: (1/2).", ""], ""),
        (["Chart notation: (1/2)."], "Part 1 of 2"),
        (["Chart notation: (1/2).", "Chart notation: (2/2)."], "Parts 1-2 of 2"),
        (["Chart notation: (pt.1).", "Chart notation: (pt.3)."], "Parts 1, 3"),
        # A range is cumulative already; the latest stands.
        (["Chart notation: (1-3).", "Chart notation: (1-6)."], "1-6"),
    ],
)
def test_cumulative_notation(notes: list[str], expected: str) -> None:
    mappings = [SyllabusRequirement(notes=note) for note in notes]

    assert cumulative_notation(mappings) == expected


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/syllabus/requirements/effective/"),
        ("put", "/api/syllabus/requirements/effective/"),
        ("patch", "/api/syllabus/requirements/effective/"),
        ("delete", "/api/syllabus/requirements/effective/"),
        ("post", "/api/syllabus/age-bands/"),
    ],
)
def test_syllabus_api_rejects_write_methods(method: str, path: str) -> None:
    client = auth_client("syllabus-writer@example.com")

    response = getattr(client, method)(path, {"code": "API_ITEM"}, format="json")

    assert response.status_code == 405


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_syllabus_migrations_apply_from_zero_and_seed_deterministic_records() -> None:
    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()

    try:
        executor.migrate([("syllabus", None)])
        rank_seed_migration = importlib.import_module(
            "ranks.migrations.0002_seed_rank_catalogue",
        )
        rank_seed_migration.seed_rank_catalogue(apps, None)
        executor = MigrationExecutor(connection)
        executor.migrate(
            [
                ("ranks", "0003_belt_colours"),
                ("syllabus", "0002_seed_wksa_2014_syllabus"),
            ],
        )
        state_apps = executor.loader.project_state(
            [("syllabus", "0002_seed_wksa_2014_syllabus")],
        ).apps
        HistoricalItem = state_apps.get_model("syllabus", "SyllabusItem")
        HistoricalRequirement = state_apps.get_model(
            "syllabus",
            "SyllabusRequirement",
        )

        assert HistoricalItem.objects.count() == 32
        assert HistoricalRequirement.objects.count() == 373
        assert HistoricalRequirement.objects.filter(
            rank__code="YELLOW",
            age_band=AgeBand.AGE_9_TO_12,
            item__code="KI_BOHN_SOO",
            start_number=1,
            end_number=10,
        ).exists()
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_syllabus_seed_reverse_targets_only_exact_seeded_rows() -> None:
    rank_seed_migration = importlib.import_module(
        "ranks.migrations.0002_seed_rank_catalogue",
    )
    seed_migration = importlib.import_module(
        "syllabus.migrations.0002_seed_wksa_2014_syllabus",
    )
    rank_seed_migration.seed_rank_catalogue(apps, None)
    seed_migration.seed_wksa_2014_syllabus(apps, None)

    requirement = SyllabusRequirement.objects.get(
        rank__code="YELLOW",
        age_band=AgeBand.AGE_9_TO_12,
        item__code="KI_BOHN_SOO",
    )
    requirement.notes = "User changed note"
    requirement.save()

    seed_migration.unseed_wksa_2014_syllabus(apps, None)

    assert SyllabusRequirement.objects.filter(notes="User changed note").exists()
    assert not SyllabusRequirement.objects.filter(
        rank__code="YELLOW",
        age_band=AgeBand.AGE_13_TO_17,
        item__code="KI_BOHN_SOO",
    ).exists()


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_adult_jkn_technique_sets_migration_reverses_to_the_seed() -> None:
    def adult_jkn_technique_sets() -> list[tuple[str, int]]:
        return list(
            SyllabusRequirement.objects.filter(
                rank__code="JKN",
                age_band=AgeBand.AGE_18_AND_OVER,
                item__category=SyllabusItem.Category.TECHNIQUE_SET,
            )
            .order_by("sequence")
            .values_list("item__code", "sequence"),
        )

    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()
    assert adult_jkn_technique_sets() == [
        ("JOONG_GEUP_SOHN_MOHK_SOO", 100),
        ("AHP_EUE_BOHK_SOO", 110),
        ("DEE_EUE_BOHK_SOO", 120),
        ("KWAHN_JUHL_KI", 130),
        ("TOO_KI", 140),
        ("MOHK_JOH_LEU_KI", 150),
        ("BAHNG_TOO_KI", 160),
    ]

    try:
        executor.migrate([("syllabus", "0002_seed_wksa_2014_syllabus")])
        assert adult_jkn_technique_sets() == [
            ("MOHK_JOH_LEU_KI", 100),
            ("BAHNG_TOO_KI", 110),
        ]
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(final_targets)

    assert len(adult_jkn_technique_sets()) == 7


def test_seed_migration_has_no_duplicate_in_memory_tuples() -> None:
    seed_migration = importlib.import_module(
        "syllabus.migrations.0002_seed_wksa_2014_syllabus",
    )
    keys = [
        (rank_code, age_band, item_code)
        for rank_code, age_band, item_code, *_rest in seed_migration.REQUIREMENTS
    ]

    assert len(keys) == len(set(keys))


def test_age_bands_are_served_in_order_with_their_programme() -> None:
    response = auth_client("age-bands@example.com").get("/api/syllabus/age-bands/")

    assert response.status_code == 200
    assert results(response) == [
        {
            "code": "AGE_8_AND_UNDER",
            "name": "8 and under",
            "description": "Little Dragon ages 8 and under",
            "programme": "JUNIOR",
            "programme_display": "Junior & Little Dragon",
        },
        {
            "code": "AGE_9_TO_12",
            "name": "9-12",
            "description": "Junior ages 9-12",
            "programme": "JUNIOR",
            "programme_display": "Junior & Little Dragon",
        },
        {
            "code": "AGE_13_TO_17",
            "name": "13-17",
            "description": "Youth ages 13-17",
            "programme": "ADULT",
            "programme_display": "Adult & Youth",
        },
        {
            "code": "AGE_18_AND_OVER",
            "name": "18+",
            "description": "Adult ages 18+",
            "programme": "ADULT",
            "programme_display": "Adult & Youth",
        },
    ]


def test_every_age_band_has_a_programme_and_description() -> None:
    assert set(AGE_BAND_PROGRAMME) == set(AgeBand.values)
    assert set(AGE_BAND_DESCRIPTION) == set(AgeBand.values)
