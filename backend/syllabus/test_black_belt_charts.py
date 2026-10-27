# ruff: noqa: E501
"""The WKSA black belt requirement charts as written on the sheets (0004).

The expected lists below are read from the sheets themselves, not from the
migration, so a transcription slip in the migration fails here.
"""

from __future__ import annotations

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.test import APIClient

from accounts.models import User
from ranks.models import Rank
from syllabus.models import AgeBand, SyllabusItem, SyllabusRequirement

# The Korean each item is printed with, as read from the sheets.
KOREAN = {
    "Basic": "기초", "Elementary": "초급", "Middle Level": "중급",
    "High Level": "고급", "Advanced Level": "대급", "Teaching Experience": "실습경험",
    "Ki Cho Bong": "기초봉", "Ki Cho Juhng Guhm": "기초정검",
    "Ki Cho Dahn Bohn": "기초단봉", "Ki Cho Yuhk Guhm": "기초역검",
    "Ki Bohn Bohn": "기본본", "Gahk Doh Bup": "각도법", "Juhn Hwahn Bup": "전환법",
    "Yahng Sohn Mohk Soo": "양손목수", "Ssahng Soo": "쌍수",
    "Dahn Doh Mahk Ki": "단도막기",
    "Juhng Guhm Hyung": "정검형", "Joong Bong Il Hyung": "중봉일형",
    "Dahn Bong Hyung": "단봉 18 동작", "Baek Pahl Ki Hyung": "108 기형",
    "Goh Geup Sohn Mohk Soo": "고급손목수", "Goh Geup Eue Bohk Soo": "고급의복수",
    "Bong Dae Ryuhn": "봉대련", "Keun Dae Ryuhn": "근대련",
    "Johk Bahng Uh Sool": "족방어술", "Jahp Ki": "잡기", "Jah Yu Dae Ryuhn": "자유대련",
    "Jah Ki": "좌기", "Wah Ki": "와기", "Ee In Jeh Ahp Sool": "이인제압술",
    "Riul Cha Ki": "“ㄹ”차기", "Neun Cha Ki": "“ㄴ”차기", "Yahng Bahl": "양발",
    "Ssang Bahl": "쌍발", "Wuhl Jahng Cha Ki": "월장차기",
    "Jang Hae Mool Cha Ki": "장애물 차기", "Yuhn Sohk Cha Ki": "연속차기",
    "Ee Dahn Cha Ki": "이단차기", "WKSA Pledge": "세계국술협회 회원 맹세",
    "Jee Ahp Sool": "지압술", "Yuhn Heng Sool": "연행술", "Poh Bahk Sool": "포박술",
    "Jee Peng Ee Sool": "지팡이술", "Kyuhk Pah Hyung": "격파형",
    "Sahm Sah In Dae Ryuhn": "삼사인대련", "Yuhk Guhm Hyung": "역검형",
    "Dahn Ssahng Bohng Hyung": "단쌍봉형", "Pyuhng Soo": "평수", "Kwahn Soo": "관수",
    "Il Jee Kwuhn": "일지권", "Ee Jee Kwuhn": "이지권",
    "Ddi Uh Ee Joong Cha Ki": "뛰어이중차기 (앞, 옆, 발등)",
    "Sahm Bahng Cho Cha Ki": "삼방초차기", "Sahm Joong Cha Ki": "삼중차기",
    "Bahk Sool": "박술", "Bu Chae Sool": "부채술",
    "Ki Yuhn Seup Kwa Jung": "기 연습과정", "Ki Kong Bup": "기공법",
    "Nae Kong": "내공", "Wea Kong": "외공",
    "Sahm Bahng Cho Il Hyung": "삼방초 1 형", "Chahng Dae Ryuhn": "창대련",
    "Dahn Ssahng Guhm Hyung": "단쌍검형", "Chahng Hyung": "창형",
    "Kuk Sool Wohl Lee": "국술 원리", "Kuk Sool Yuhk Sah": "국술 역사",
    "Kuk Sool Sahm Dae Moo Yea": "국술 3 대 무예", "Sah Doh Moo Sool": "사도무술",
    "Bool Kyoh Moo Sool": "불교무술", "Goong Joong Moo Soo": "궁중무술",
}  # fmt: skip

UNDER = "Under Black Belt Curriculum 유급과정"
LEVELS = [("Basic", None), ("Elementary", None), ("Middle Level", None),
          ("High Level", None), ("Advanced Level", None)]  # fmt: skip
KICKS = [
    ("Riul Cha Ki", None), ("Neun Cha Ki", None), ("Yahng Bahl", None),
    ("Ssang Bahl", None), ("Wuhl Jahng Cha Ki", None),
    ("Jang Hae Mool Cha Ki", None), ("Yuhn Sohk Cha Ki", None),
    ("Ee Dahn Cha Ki", None),
]  # fmt: skip
KICKS_NOTE = {"Ee Dahn Cha Ki": "Chart notation: (AHP, YUHP, DEE, BAHL DEUNG)."}
KI_CHO = [("Ki Cho Bong", None), ("Ki Cho Juhng Guhm", None),
          ("Ki Cho Dahn Bohn", None), ("Ki Cho Yuhk Guhm", None)]  # fmt: skip
MOO_KI = [("Juhng Guhm Hyung", None), ("Joong Bong Il Hyung", None),
          ("Dahn Bong Hyung", None)]  # fmt: skip
FOUR_WAY = {"Dahn Bong Hyung": "Chart notation: (4 DIRECTIONAL)."}
DAE_RYUHN = [("Bong Dae Ryuhn", "1-5"), ("Keun Dae Ryuhn", "1-8"),
             ("Johk Bahng Uh Sool", "1-15"), ("Jahp Ki", "1-20"),
             ("Jah Yu Dae Ryuhn", None)]  # fmt: skip
KICKS_TITLE = "Teuk Soo Johk Sool & Kyuhk Pah 특수 족술 및 격파"


def under(teaching: str) -> tuple[str, list, dict[str, str]]:
    return (
        UNDER,
        [*LEVELS, ("Teaching Experience", None)],
        {"Teaching Experience": teaching},
    )


# A chart is its sections in the order the sheet is read (down the left column,
# then the right): (section title, [(item, range)], notes some lines carry).
KSN_ADULT = [
    under(""),
    ("You Dahn Soo 유단수", [("Ki Bohn Bohn", "1-10"), ("Gahk Doh Bup", "1-10"),
                            ("Juhn Hwahn Bup", "1-10")], {}),
    ("Goh Geup Soo 고급수", [("Goh Geup Sohn Mohk Soo", "1-15"),
                            ("Goh Geup Eue Bohk Soo", "1-15")], {}),
    ("Dae Geup Soo 대급수", [("Jah Ki", "1-15"), ("Wah Ki", "1-15"),
                            ("Ee In Jeh Ahp Sool", "1-10")], {}),
    ("Hyung 형", [("Baek Pahl Ki Hyung", None)], {}),
    ("Ki Cho Moo Ki Sool 기초 무기술", KI_CHO, {}),
    ("Moo Ki Hyung 무기형", MOO_KI, FOUR_WAY),
    ("Dae Ryuhn 대련", DAE_RYUHN, {}),
    (KICKS_TITLE, KICKS, KICKS_NOTE),
    ("WKSA Pledge", [("WKSA Pledge", None)], {}),
]  # fmt: skip
KSN_YOUTH = [
    under(""),
    ("You Dahn Soo 유단수", [("Yahng Sohn Mohk Soo", "1-15"),
                            ("Ssahng Soo", "1-15")], {}),  # the chart prints "Ssang Soo"
    ("Goh Geup Soo 고급수", [("Ki Bohn Bohn", "1-10"), ("Gahk Doh Bup", "1-10"),
                            ("Juhn Hwahn Bup", "1-10"), ("Dahn Doh Mahk Ki", "1-15")],
     {"Dahn Doh Mahk Ki": "*Must be taught AFTER age of 18 y.o."}),
    ("Dae Geup Soo 대급수", [("Goh Geup Sohn Mohk Soo", "1-15"),
                            ("Goh Geup Eue Bohk Soo", "1-15")], {}),
    ("Hyung 형", [("Baek Pahl Ki Hyung", None)], {}),
    ("Ki Cho Moo Ki Sool 기초 무기술", KI_CHO, {}),
    ("Moo Ki Hyung 무기형", MOO_KI, FOUR_WAY),
    ("Dae Ryuhn 대련", DAE_RYUHN, {}),
    (KICKS_TITLE, KICKS, KICKS_NOTE),
    ("WKSA Pledge", [("WKSA Pledge", None)], {}),
]  # fmt: skip
YOU_DAHN_SOO = [
    ("Ki Bohn Bohn", None), ("Gahk Doh Bup", None), ("Juhn Hwahn Bup", None),
    ("Goh Geup Sohn Mohk Soo", None), ("Goh Geup Eue Bohk Soo", None),
    ("Jah Ki", None), ("Wah Ki", None), ("Ee In Jeh Ahp Sool", None),
]  # fmt: skip
EE_DAHN_SOO = [("Jee Ahp Sool", None), ("Yuhn Heng Sool", None),
               ("Poh Bahk Sool", None), ("Jee Peng Ee Sool", None)]  # fmt: skip
DAE_RYUHN_LOWER = [("Bong Dae Ryuhn", None), ("Keun Dae Ryuhn", None),
                   ("Johk Bahng Uh Sool", None), ("Jahp Ki", None),
                   ("Jah Yu Dae Ryuhn", None), ("Sahm Sah In Dae Ryuhn", None)]  # fmt: skip
PSBN = [
    under("실습경력"),
    ("You Dahn Soo 유단 수", YOU_DAHN_SOO, {}),
    ("Ee Dahn Soo 이단 수", [(n, "1-10") for n, _ in EE_DAHN_SOO], {}),
    ("Teuk Soo Johk Sool & Kyuhk Pah (I) 특수 족술 및 격파", KICKS, KICKS_NOTE),
    ("Hyung 형", [("Kyuhk Pah Hyung", None)], {}),
    ("You Dahn Hyung 유단 형", [*MOO_KI, ("Baek Pahl Ki Hyung", None)], FOUR_WAY),
    ("Dae Ryuhn 대련", DAE_RYUHN_LOWER, {}),
    ("Ee Dahn Moo Ki Hyung 이단 무기형", [("Yuhk Guhm Hyung", None),
                                         ("Dahn Ssahng Bohng Hyung", None)], {}),
    ("Teuk Soo Soo Ki, Johk Sool & Kyuhk Pah (II) 특수 수기, 족술 및 격파",
     [("Pyuhng Soo", None), ("Kwahn Soo", None), ("Il Jee Kwuhn", None),
      ("Ee Jee Kwuhn", None), ("Ddi Uh Ee Joong Cha Ki", None),
      ("Sahm Bahng Cho Cha Ki", None), ("Sahm Joong Cha Ki", None)],
     {"Ddi Uh Ee Joong Cha Ki": "Chart notation: (AHP, YUHP, BAHL DEUNG)."}),
    ("WKSA Pledge", [("WKSA Pledge", None)], {}),
]  # fmt: skip
SBN = [
    under("실습경력"),
    ("You Dahn Soo 유단 수", [*YOU_DAHN_SOO, *EE_DAHN_SOO], {}),
    ("Sahm Dahn Soo 삼단 수", [("Bahk Sool", "1-10"), ("Pyuhng Soo", "1-10"),
                              ("Bu Chae Sool", "1-10")], {}),
    ("Study of Ki 기 학", [("Ki Yuhn Seup Kwa Jung", None), ("Ki Kong Bup", None),
                          ("Nae Kong", None), ("Wea Kong", None)], {}),
    ("Hyung 형", [("Sahm Bahng Cho Il Hyung", None)], {}),
    ("You Dahn Hyung 유단 형", [*MOO_KI[:2], ("Dahn Bong Hyung", None),
                               ("Baek Pahl Ki Hyung", None), ("Kyuhk Pah Hyung", None),
                               ("Yuhk Guhm Hyung", None),
                               ("Dahn Ssahng Bohng Hyung", None)], {}),
    ("Dae Ryuhn 대련", [*DAE_RYUHN_LOWER, ("Chahng Dae Ryuhn", None)], {}),
    ("Sahm Dahn Moo Ki Hyung 삼단 무기형", [("Dahn Ssahng Guhm Hyung", None),
                                           ("Chahng Hyung", None)], {}),
    ("Study of Kuk Sool 국술 학", [("Kuk Sool Wohl Lee", None), ("Kuk Sool Yuhk Sah", None),
                                 ("Kuk Sool Sahm Dae Moo Yea", None),
                                 ("Sah Doh Moo Sool", None),
                                 ("Bool Kyoh Moo Sool", None),
                                 ("Goong Joong Moo Soo", None)], {}),
    ("WKSA Pledge", [("WKSA Pledge", None)], {}),
]  # fmt: skip

CHARTS = [
    ("KSN", AgeBand.AGE_18_AND_OVER, KSN_ADULT),
    ("KSN", AgeBand.AGE_13_TO_17, KSN_YOUTH),
    ("PSBN", AgeBand.AGE_18_AND_OVER, PSBN),
    ("SBN", AgeBand.AGE_18_AND_OVER, SBN),
]
# Items the earlier syllabus already had, whose Korean this migration leaves alone.
EXISTING = {"Yahng Sohn Mohk Soo", "Ssahng Soo", "Dahn Doh Mahk Ki"}


def expected(chart: list) -> list[tuple[str, str | None, str]]:
    """(item, range, note) for every line, in order."""
    result = []
    for title, lines, notes in chart:
        for name, printed_range in lines:
            note = notes.get(name)
            if not note:
                note = f"{title}."
            elif not note.startswith(("Chart notation:", "*")):
                note = f"{title}. {note}"
            result.append((name, printed_range, note))
    return result


def recorded(rank_code: str, age_band: str) -> list[tuple[str, str | None, str]]:
    rows = SyllabusRequirement.objects.filter(
        rank__code=rank_code, age_band=age_band
    ).order_by("sequence")
    return [(row.item.name, row.display_range or None, row.notes) for row in rows]


@pytest.mark.django_db
@pytest.mark.parametrize(("rank_code", "age_band", "chart"), CHARTS)
def test_each_chart_is_recorded_line_for_line_with_its_notes(
    rank_code: str, age_band: str, chart: list
) -> None:
    assert recorded(rank_code, age_band) == expected(chart)


@pytest.mark.django_db
def test_the_charts_have_the_printed_number_of_lines() -> None:
    assert [len(expected(chart)) for _, _, chart in CHARTS] == [36, 36, 47, 49]


@pytest.mark.django_db
def test_every_item_carries_the_korean_the_sheet_prints() -> None:
    names = {
        name for _, _, chart in CHARTS for _, lines, _ in chart for name, _ in lines
    }
    assert names <= set(KOREAN)
    for name in names - EXISTING:
        item = SyllabusItem.objects.get(name=name)
        assert item.korean_name == KOREAN[name], name
    # Techniques the syllabus already held keep their items and their Korean.
    for name in EXISTING:
        assert SyllabusItem.objects.get(name=name).korean_name == KOREAN[name], name


@pytest.mark.django_db
def test_no_item_is_made_twice_under_one_name() -> None:
    names = list(SyllabusItem.objects.values_list("name", flat=True))
    assert len(names) == len(set(names))


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
    assert {name for _, lines, _ in KSN_ADULT for name, _ in lines} <= set(names)
    assert "Joong Geup Sohn Mohk Soo" in names


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_reversing_the_migration_removes_only_what_it_wrote() -> None:
    kept = SyllabusRequirement.objects.get(
        rank__code="KSN", age_band=AgeBand.AGE_18_AND_OVER, item__name="Jah Ki"
    )
    kept.notes = "Edited by someone since."
    kept.save()
    other = SyllabusItem.objects.create(
        code="LATER_ITEM", name="Later Item", category=SyllabusItem.Category.OTHER
    )
    SyllabusRequirement.objects.create(
        rank=Rank.objects.get(code="SBN"),
        age_band=AgeBand.AGE_18_AND_OVER,
        item=other,
        sequence=5000,
    )

    executor = MigrationExecutor(connection)
    final_targets = executor.loader.graph.leaf_nodes()
    try:
        executor.migrate([("syllabus", "0003_adult_jkn_technique_sets")])
        # The chart's other lines and its own items are gone; the edited line,
        # the later requirement and the item they keep are not.
        assert (
            SyllabusRequirement.objects.filter(
                rank__code="KSN", age_band=AgeBand.AGE_18_AND_OVER
            ).count()
            == 1
        )
        assert SyllabusRequirement.objects.filter(rank__code="SBN", item=other).exists()
        assert SyllabusItem.objects.filter(code="JAH_KI").exists()
        assert not SyllabusItem.objects.filter(code="BASIC").exists()
    finally:
        MigrationExecutor(connection).migrate(final_targets)

    # Applying it again fills in what is missing and restores the edited line.
    assert recorded("KSN", AgeBand.AGE_18_AND_OVER) == expected(KSN_ADULT)
    assert recorded("SBN", AgeBand.AGE_18_AND_OVER)[: len(expected(SBN))] == expected(
        SBN
    )
