"""The WKSA black belt requirement charts as written on the sheets (0004).

The expected lists below are read from the sheets themselves, not from the
migration, so a transcription slip in the migration fails here.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from accounts.models import User
from syllabus.models import AgeBand, SyllabusRequirement

# (item name as printed, printed range or None), in reading order, per sheet.
LEVELS = [
    ("Basic", None),
    ("Elementary", None),
    ("Middle Level", None),
    ("High Level", None),
    ("Advanced Level", None),
    ("Teaching Experience", None),
]
KICKS = [
    ("Riul Cha Ki", None),
    ("Neun Cha Ki", None),
    ("Yahng Bahl", None),
    ("Ssang Bahl", None),
    ("Wuhl Jahng Cha Ki", None),
    ("Jang Hae Mool Cha Ki", None),
    ("Yuhn Sohk Cha Ki", None),
    ("Ee Dahn Cha Ki", None),
]
KSN_ADULT = [
    *LEVELS,
    ("Ki Cho Bong", None),
    ("Ki Cho Juhng Guhm", None),
    ("Ki Cho Dahn Bohn", None),
    ("Ki Cho Yuhk Guhm", None),
    ("Ki Bohn Bohn", "1-10"),
    ("Gahk Doh Bup", "1-10"),
    ("Juhn Hwahn Bup", "1-10"),
    ("Juhng Guhm Hyung", None),
    ("Joong Bong Il Hyung", None),
    ("Dahn Bong Hyung", None),
    ("Goh Geup Sohn Mohk Soo", "1-15"),
    ("Goh Geup Eue Bohk Soo", "1-15"),
    ("Bong Dae Ryuhn", "1-5"),
    ("Keun Dae Ryuhn", "1-8"),
    ("Johk Bahng Uh Sool", "1-15"),
    ("Jahp Ki", "1-20"),
    ("Jah Yu Dae Ryuhn", None),
    ("Jah Ki", "1-15"),
    ("Wah Ki", "1-15"),
    ("Ee In Jeh Ahp Sool", "1-10"),
    *KICKS,
    ("Baek Pahl Ki Hyung", None),
    ("WKSA Pledge", None),
]
KSN_YOUTH = [
    *LEVELS,
    ("Ki Cho Bong", None),
    ("Ki Cho Juhng Guhm", None),
    ("Ki Cho Dahn Bohn", None),
    ("Ki Cho Yuhk Guhm", None),
    ("Yahng Sohn Mohk Soo", "1-15"),
    ("Ssahng Soo", "1-15"),  # the chart prints "Ssang Soo"
    ("Juhng Guhm Hyung", None),
    ("Joong Bong Il Hyung", None),
    ("Dahn Bong Hyung", None),
    ("Ki Bohn Bohn", "1-10"),
    ("Gahk Doh Bup", "1-10"),
    ("Juhn Hwahn Bup", "1-10"),
    ("Dahn Doh Mahk Ki", "1-15"),
    ("Bong Dae Ryuhn", "1-5"),
    ("Keun Dae Ryuhn", "1-8"),
    ("Johk Bahng Uh Sool", "1-15"),
    ("Jahp Ki", "1-20"),
    ("Jah Yu Dae Ryuhn", None),
    ("Goh Geup Sohn Mohk Soo", "1-15"),
    ("Goh Geup Eue Bohk Soo", "1-15"),
    *KICKS,
    ("Baek Pahl Ki Hyung", None),
    ("WKSA Pledge", None),
]
PSBN = [
    *LEVELS,
    ("Ki Bohn Bohn", None),
    ("Gahk Doh Bup", None),
    ("Juhn Hwahn Bup", None),
    ("Goh Geup Sohn Mohk Soo", None),
    ("Goh Geup Eue Bohk Soo", None),
    ("Jah Ki", None),
    ("Wah Ki", None),
    ("Ee In Jeh Ahp Sool", None),
    ("Jee Ahp Sool", "1-10"),
    ("Yuhn Heng Sool", "1-10"),
    ("Poh Bahk Sool", "1-10"),
    ("Jee Peng Ee Sool", "1-10"),
    *KICKS,
    ("Kyuhk Pah Hyung", None),
    ("Juhng Guhm Hyung", None),
    ("Joong Bong Il Hyung", None),
    ("Dahn Bong Hyung", None),
    ("Baek Pahl Ki Hyung", None),
    ("Bong Dae Ryuhn", None),
    ("Keun Dae Ryuhn", None),
    ("Johk Bahng Uh Sool", None),
    ("Jahp Ki", None),
    ("Jah Yu Dae Ryuhn", None),
    ("Sahm Sah In Dae Ryuhn", None),
    ("Yuhk Guhm Hyung", None),
    ("Dahn Ssahng Bohng Hyung", None),
    ("Pyuhng Soo", None),
    ("Kwahn Soo", None),
    ("Il Jee Kwuhn", None),
    ("Ee Jee Kwuhn", None),
    ("Ddi Uh Ee Joong Cha Ki", None),
    ("Sahm Bahng Cho Cha Ki", None),
    ("Sahm Joong Cha Ki", None),
    ("WKSA Pledge", None),
]
SBN = [
    *LEVELS,
    ("Ki Bohn Bohn", None),
    ("Gahk Doh Bup", None),
    ("Juhn Hwahn Bup", None),
    ("Goh Geup Sohn Mohk Soo", None),
    ("Goh Geup Eue Bohk Soo", None),
    ("Jah Ki", None),
    ("Wah Ki", None),
    ("Ee In Jeh Ahp Sool", None),
    ("Jee Ahp Sool", None),
    ("Yuhn Heng Sool", None),
    ("Poh Bahk Sool", None),
    ("Jee Peng Ee Sool", None),
    ("Bahk Sool", "1-10"),
    ("Pyuhng Soo", "1-10"),
    ("Bu Chae Sool", "1-10"),
    ("Ki Yuhn Seup Kwa Jung", None),
    ("Ki Kong Bup", None),
    ("Nae Kong", None),
    ("Wea Kong", None),
    ("Sahm Bahng Cho Il Hyung", None),
    ("Juhng Guhm Hyung", None),
    ("Joong Bong Il Hyung", None),
    ("Dahn Bong Hyung", None),
    ("Baek Pahl Ki Hyung", None),
    ("Kyuhk Pah Hyung", None),
    ("Yuhk Guhm Hyung", None),
    ("Dahn Ssahng Bohng Hyung", None),
    ("Bong Dae Ryuhn", None),
    ("Keun Dae Ryuhn", None),
    ("Johk Bahng Uh Sool", None),
    ("Jahp Ki", None),
    ("Jah Yu Dae Ryuhn", None),
    ("Sahm Sah In Dae Ryuhn", None),
    ("Chahng Dae Ryuhn", None),
    ("Dahn Ssahng Guhm Hyung", None),
    ("Chahng Hyung", None),
    ("Kuk Sool Wohl Lee", None),
    ("Kuk Sool Yuhk Sah", None),
    ("Kuk Sool Sahm Dae Moo Yea", None),
    ("Sah Doh Moo Sool", None),
    ("Bool Kyoh Moo Sool", None),
    ("Goong Joong Moo Soo", None),
    ("WKSA Pledge", None),
]

CHARTS = [
    ("KSN", AgeBand.AGE_18_AND_OVER, KSN_ADULT),
    ("KSN", AgeBand.AGE_13_TO_17, KSN_YOUTH),
    ("PSBN", AgeBand.AGE_18_AND_OVER, PSBN),
    ("SBN", AgeBand.AGE_18_AND_OVER, SBN),
]


def recorded(rank_code: str, age_band: str) -> list[tuple[str, str | None]]:
    rows = SyllabusRequirement.objects.filter(
        rank__code=rank_code, age_band=age_band
    ).order_by("sequence")
    return [(row.item.name, row.display_range or None) for row in rows]


@pytest.mark.django_db
@pytest.mark.parametrize(("rank_code", "age_band", "chart"), CHARTS)
def test_each_chart_is_recorded_line_for_line(
    rank_code: str, age_band: str, chart: list[tuple[str, str | None]]
) -> None:
    assert recorded(rank_code, age_band) == chart


@pytest.mark.django_db
def test_the_charts_have_the_printed_number_of_lines() -> None:
    assert [len(chart) for _, _, chart in CHARTS] == [36, 36, 47, 49]


@pytest.mark.django_db
def test_the_chart_s_own_notes_are_kept_verbatim() -> None:
    def note(rank: str, band: str, item: str) -> str:
        return SyllabusRequirement.objects.get(
            rank__code=rank, age_band=band, item__name=item
        ).notes

    assert (
        note("KSN", AgeBand.AGE_13_TO_17, "Dahn Doh Mahk Ki")
        == "*Must be taught AFTER age of 18 y.o."
    )
    assert (
        note("KSN", AgeBand.AGE_18_AND_OVER, "Dahn Bong Hyung")
        == "Chart notation: (4 DIRECTIONAL)."
    )
    assert (
        note("PSBN", AgeBand.AGE_18_AND_OVER, "Ddi Uh Ee Joong Cha Ki")
        == "Chart notation: (AHP, YUHP, BAHL DEUNG)."
    )
    assert "실습경력" in note("SBN", AgeBand.AGE_18_AND_OVER, "Teaching Experience")


@pytest.mark.django_db
def test_nothing_is_recorded_for_the_age_bands_the_charts_do_not_cover() -> None:
    for rank_code in ("KSN", "PSBN", "SBN", "PKJN"):
        for age_band in (AgeBand.AGE_8_AND_UNDER, AgeBand.AGE_9_TO_12):
            assert recorded(rank_code, age_band) == []
    assert recorded("PSBN", AgeBand.AGE_13_TO_17) == []
    assert recorded("SBN", AgeBand.AGE_13_TO_17) == []
    assert recorded("PKJN", AgeBand.AGE_18_AND_OVER) == []


@pytest.mark.django_db
def test_the_syllabus_screen_serves_a_black_belt_chart() -> None:
    client = APIClient()
    client.force_authenticate(User.objects.create_user(email="reader@example.com"))

    response = client.get(
        "/api/syllabus/requirements/effective/",
        {"rank_code": "KSN", "age_band": AgeBand.AGE_18_AND_OVER, "page_size": "200"},
    )

    assert response.status_code == 200
    names = [row["item_name"] for row in response.json()["results"]]
    # Every chart line is served, with the grading's earlier ranks beneath it.
    assert {name for name, _ in KSN_ADULT} <= set(names)
    assert "Joong Geup Sohn Mohk Soo" in names
