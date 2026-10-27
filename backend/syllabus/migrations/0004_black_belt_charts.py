from __future__ import annotations

from typing import Any

from django.db import migrations

# The WKSA Official Black Belt Requirement Charts, as written on the sheets:
#   KSN (2nd degree)   adult chart -> 18+, youth chart -> 13-17 (WKSA Version 2-1)
#   PSBN (3rd degree)  one chart   -> 18+                       (WKSA Version 3-1)
#   SBN (4th degree)   one chart   -> 18+                       (WKSA Version 4-1)
# Every line the chart names is a requirement, in the chart's reading order (the
# left column from the top, then the right), with the range the chart prints for
# it where it prints one, and the chart's own wording in its notes. An item an
# earlier migration already made (the same technique, however spelled on the
# chart) is reused, so a rank restating it extends it as the cumulative syllabus
# expects. Nothing on the charts is added to, left out of, or reworded.

ADULT = "AGE_18_AND_OVER"
YOUTH = "AGE_13_TO_17"

TECHNIQUE_SET = "TECHNIQUE_SET"
FORM = "FORM"
WEAPONS = "WEAPONS"
OTHER = "OTHER"

# (code, name, korean_name, category): only items no earlier migration made.
NEW_ITEMS = [
    ("BASIC", "Basic", "기초", OTHER),
    ("ELEMENTARY", "Elementary", "초급", OTHER),
    ("MIDDLE_LEVEL", "Middle Level", "중급", OTHER),
    ("HIGH_LEVEL", "High Level", "고급", OTHER),
    ("ADVANCED_LEVEL", "Advanced Level", "대급", OTHER),
    ("TEACHING_EXPERIENCE", "Teaching Experience", "실습경험", OTHER),
    ("KI_CHO_BONG", "Ki Cho Bong", "기초봉", WEAPONS),
    ("KI_CHO_JUHNG_GUHM", "Ki Cho Juhng Guhm", "기초정검", WEAPONS),
    ("KI_CHO_DAHN_BOHN", "Ki Cho Dahn Bohn", "기초단봉", WEAPONS),
    ("KI_CHO_YUHK_GUHM", "Ki Cho Yuhk Guhm", "기초역검", WEAPONS),
    ("KI_BOHN_BOHN", "Ki Bohn Bohn", "기본본", TECHNIQUE_SET),
    ("GAHK_DOH_BUP", "Gahk Doh Bup", "각도법", TECHNIQUE_SET),
    ("JUHN_HWAHN_BUP", "Juhn Hwahn Bup", "전환법", TECHNIQUE_SET),
    ("GOH_GEUP_SOHN_MOHK_SOO", "Goh Geup Sohn Mohk Soo", "고급손목수", TECHNIQUE_SET),
    ("GOH_GEUP_EUE_BOHK_SOO", "Goh Geup Eue Bohk Soo", "고급의복수", TECHNIQUE_SET),
    ("JAH_KI", "Jah Ki", "좌기", TECHNIQUE_SET),
    ("WAH_KI", "Wah Ki", "와기", TECHNIQUE_SET),
    ("EE_IN_JEH_AHP_SOOL", "Ee In Jeh Ahp Sool", "이인제압술", TECHNIQUE_SET),
    ("JEE_AHP_SOOL", "Jee Ahp Sool", "지압술", TECHNIQUE_SET),
    ("YUHN_HENG_SOOL", "Yuhn Heng Sool", "연행술", TECHNIQUE_SET),
    ("POH_BAHK_SOOL", "Poh Bahk Sool", "포박술", TECHNIQUE_SET),
    ("JEE_PENG_EE_SOOL", "Jee Peng Ee Sool", "지팡이술", TECHNIQUE_SET),
    ("BAHK_SOOL", "Bahk Sool", "박술", TECHNIQUE_SET),
    ("PYUHNG_SOO", "Pyuhng Soo", "평수", TECHNIQUE_SET),
    ("BU_CHAE_SOOL", "Bu Chae Sool", "부채술", TECHNIQUE_SET),
    ("JUHNG_GUHM_HYUNG", "Juhng Guhm Hyung", "정검형", FORM),
    ("JOONG_BONG_IL_HYUNG", "Joong Bong Il Hyung", "중봉일형", FORM),
    ("DAHN_BONG_HYUNG", "Dahn Bong Hyung", "단봉 18 동작", FORM),
    ("BAEK_PAHL_KI_HYUNG", "Baek Pahl Ki Hyung", "108 기형", FORM),
    ("YUHK_GUHM_HYUNG", "Yuhk Guhm Hyung", "역검형", FORM),
    ("DAHN_SSAHNG_BOHNG_HYUNG", "Dahn Ssahng Bohng Hyung", "단쌍봉형", FORM),
    ("KYUHK_PAH_HYUNG", "Kyuhk Pah Hyung", "격파형", FORM),
    ("DAHN_SSAHNG_GUHM_HYUNG", "Dahn Ssahng Guhm Hyung", "단쌍검형", FORM),
    ("CHAHNG_HYUNG", "Chahng Hyung", "창형", FORM),
    ("SAHM_BAHNG_CHO_IL_HYUNG", "Sahm Bahng Cho Il Hyung", "삼방초 1 형", FORM),
    ("BONG_DAE_RYUHN", "Bong Dae Ryuhn", "봉대련", OTHER),
    ("KEUN_DAE_RYUHN", "Keun Dae Ryuhn", "근대련", OTHER),
    ("JOHK_BAHNG_UH_SOOL", "Johk Bahng Uh Sool", "족방어술", TECHNIQUE_SET),
    ("JAHP_KI", "Jahp Ki", "잡기", TECHNIQUE_SET),
    ("JAH_YU_DAE_RYUHN", "Jah Yu Dae Ryuhn", "자유대련", OTHER),
    ("SAHM_SAH_IN_DAE_RYUHN", "Sahm Sah In Dae Ryuhn", "삼사인대련", OTHER),
    ("CHAHNG_DAE_RYUHN", "Chahng Dae Ryuhn", "창대련", OTHER),
    ("RIUL_CHA_KI", "Riul Cha Ki", "“ㄹ”차기", TECHNIQUE_SET),
    ("NEUN_CHA_KI", "Neun Cha Ki", "“ㄴ”차기", TECHNIQUE_SET),
    ("YAHNG_BAHL", "Yahng Bahl", "양발", TECHNIQUE_SET),
    ("SSANG_BAHL", "Ssang Bahl", "쌍발", TECHNIQUE_SET),
    ("WUHL_JAHNG_CHA_KI", "Wuhl Jahng Cha Ki", "월장차기", TECHNIQUE_SET),
    ("JANG_HAE_MOOL_CHA_KI", "Jang Hae Mool Cha Ki", "장애물 차기", TECHNIQUE_SET),
    ("YUHN_SOHK_CHA_KI", "Yuhn Sohk Cha Ki", "연속차기", TECHNIQUE_SET),
    ("EE_DAHN_CHA_KI", "Ee Dahn Cha Ki", "이단차기", TECHNIQUE_SET),
    ("KWAHN_SOO", "Kwahn Soo", "관수", TECHNIQUE_SET),
    ("IL_JEE_KWUHN", "Il Jee Kwuhn", "일지권", TECHNIQUE_SET),
    ("EE_JEE_KWUHN", "Ee Jee Kwuhn", "이지권", TECHNIQUE_SET),
    (
        "DDI_UH_EE_JOONG_CHA_KI",
        "Ddi Uh Ee Joong Cha Ki",
        "뛰어이중차기 (앞, 옆, 발등)",
        TECHNIQUE_SET,
    ),
    ("SAHM_BAHNG_CHO_CHA_KI", "Sahm Bahng Cho Cha Ki", "삼방초차기", TECHNIQUE_SET),
    ("SAHM_JOONG_CHA_KI", "Sahm Joong Cha Ki", "삼중차기", TECHNIQUE_SET),
    ("KI_YUHN_SEUP_KWA_JUNG", "Ki Yuhn Seup Kwa Jung", "기 연습과정", OTHER),
    ("KI_KONG_BUP", "Ki Kong Bup", "기공법", OTHER),
    ("NAE_KONG", "Nae Kong", "내공", OTHER),
    ("WEA_KONG", "Wea Kong", "외공", OTHER),
    ("KUK_SOOL_WOHL_LEE", "Kuk Sool Wohl Lee", "국술 원리", OTHER),
    ("KUK_SOOL_YUHK_SAH", "Kuk Sool Yuhk Sah", "국술 역사", OTHER),
    ("KUK_SOOL_SAHM_DAE_MOO_YEA", "Kuk Sool Sahm Dae Moo Yea", "국술 3 대 무예", OTHER),
    ("SAH_DOH_MOO_SOOL", "Sah Doh Moo Sool", "사도무술", OTHER),
    ("BOOL_KYOH_MOO_SOOL", "Bool Kyoh Moo Sool", "불교무술", OTHER),
    ("GOONG_JOONG_MOO_SOO", "Goong Joong Moo Soo", "궁중무술", OTHER),
    ("WKSA_PLEDGE", "WKSA Pledge", "세계국술협회 회원 맹세", OTHER),
]

LEVELS = ("BASIC", "ELEMENTARY", "MIDDLE_LEVEL", "HIGH_LEVEL", "ADVANCED_LEVEL")
KI_CHO_MOO_KI = (
    "KI_CHO_BONG",
    "KI_CHO_JUHNG_GUHM",
    "KI_CHO_DAHN_BOHN",
    "KI_CHO_YUHK_GUHM",
)
KICKS = (
    "RIUL_CHA_KI", "NEUN_CHA_KI", "YAHNG_BAHL", "SSANG_BAHL", "WUHL_JAHNG_CHA_KI",
    "JANG_HAE_MOOL_CHA_KI", "YUHN_SOHK_CHA_KI", "EE_DAHN_CHA_KI",
)  # fmt: skip
CHART_KICKS = "Chart notation: (AHP, YUHP, DEE, BAHL DEUNG)."
FOUR_DIRECTIONAL = "Chart notation: (4 DIRECTIONAL)."
# The chart's own note, verbatim.
AFTER_18 = "*Must be taught AFTER age of 18 y.o."


def line(
    code: str, end: int | None = None, note: str = ""
) -> tuple[str, int | None, str]:
    return code, end, note


def section(title: str, *lines: tuple[str, int | None, str]) -> tuple[str, list]:
    return title, list(lines)


def levels(teaching_note: str) -> tuple[str, list]:
    return section(
        "Under Black Belt Curriculum 유급과정",
        *[line(code) for code in LEVELS],
        line("TEACHING_EXPERIENCE", None, teaching_note),
    )


KSN_ADULT = [
    levels(""),
    section("Ki Cho Moo Ki Sool 기초 무기술", *[line(c) for c in KI_CHO_MOO_KI]),
    section(
        "You Dahn Soo 유단수",
        line("KI_BOHN_BOHN", 10),
        line("GAHK_DOH_BUP", 10),
        line("JUHN_HWAHN_BUP", 10),
    ),
    section(
        "Moo Ki Hyung 무기형",
        line("JUHNG_GUHM_HYUNG"),
        line("JOONG_BONG_IL_HYUNG"),
        line("DAHN_BONG_HYUNG", None, FOUR_DIRECTIONAL),
    ),
    section(
        "Goh Geup Soo 고급수",
        line("GOH_GEUP_SOHN_MOHK_SOO", 15),
        line("GOH_GEUP_EUE_BOHK_SOO", 15),
    ),
    section(
        "Dae Ryuhn 대련",
        line("BONG_DAE_RYUHN", 5),
        line("KEUN_DAE_RYUHN", 8),
        line("JOHK_BAHNG_UH_SOOL", 15),
        line("JAHP_KI", 20),
        line("JAH_YU_DAE_RYUHN"),
    ),
    section(
        "Dae Geup Soo 대급수",
        line("JAH_KI", 15),
        line("WAH_KI", 15),
        line("EE_IN_JEH_AHP_SOOL", 10),
    ),
    section(
        "Teuk Soo Johk Sool & Kyuhk Pah 특수 족술 및 격파",
        *[line(c, None, CHART_KICKS if c == "EE_DAHN_CHA_KI" else "") for c in KICKS],
    ),
    section("Hyung 형", line("BAEK_PAHL_KI_HYUNG")),
    section("WKSA Pledge", line("WKSA_PLEDGE")),
]

KSN_YOUTH = [
    levels(""),
    section("Ki Cho Moo Ki Sool 기초 무기술", *[line(c) for c in KI_CHO_MOO_KI]),
    section(
        "You Dahn Soo 유단수",
        line("YAHNG_SOHN_MOHK_SOO", 15),
        line("SSAHNG_SOO", 15),
    ),
    section(
        "Moo Ki Hyung 무기형",
        line("JUHNG_GUHM_HYUNG"),
        line("JOONG_BONG_IL_HYUNG"),
        line("DAHN_BONG_HYUNG", None, FOUR_DIRECTIONAL),
    ),
    section(
        "Goh Geup Soo 고급수",
        line("KI_BOHN_BOHN", 10),
        line("GAHK_DOH_BUP", 10),
        line("JUHN_HWAHN_BUP", 10),
        line("DAHN_DOH_MAHK_KI", 15, AFTER_18),
    ),
    section(
        "Dae Ryuhn 대련",
        line("BONG_DAE_RYUHN", 5),
        line("KEUN_DAE_RYUHN", 8),
        line("JOHK_BAHNG_UH_SOOL", 15),
        line("JAHP_KI", 20),
        line("JAH_YU_DAE_RYUHN"),
    ),
    section(
        "Dae Geup Soo 대급수",
        line("GOH_GEUP_SOHN_MOHK_SOO", 15),
        line("GOH_GEUP_EUE_BOHK_SOO", 15),
    ),
    section(
        "Teuk Soo Johk Sool & Kyuhk Pah 특수 족술 및 격파",
        *[line(c, None, CHART_KICKS if c == "EE_DAHN_CHA_KI" else "") for c in KICKS],
    ),
    section("Hyung 형", line("BAEK_PAHL_KI_HYUNG")),
    section("WKSA Pledge", line("WKSA_PLEDGE")),
]

PSBN = [
    levels("Written 실습경력 on this chart."),
    section(
        "You Dahn Soo 유단 수",
        line("KI_BOHN_BOHN"),
        line("GAHK_DOH_BUP"),
        line("JUHN_HWAHN_BUP"),
        line("GOH_GEUP_SOHN_MOHK_SOO"),
        line("GOH_GEUP_EUE_BOHK_SOO"),
        line("JAH_KI"),
        line("WAH_KI"),
        line("EE_IN_JEH_AHP_SOOL"),
    ),
    section(
        "Ee Dahn Soo 이단 수",
        line("JEE_AHP_SOOL", 10),
        line("YUHN_HENG_SOOL", 10),
        line("POH_BAHK_SOOL", 10),
        line("JEE_PENG_EE_SOOL", 10),
    ),
    section(
        "Teuk Soo Johk Sool & Kyuhk Pah (I) 특수 족술 및 격파",
        *[line(c, None, CHART_KICKS if c == "EE_DAHN_CHA_KI" else "") for c in KICKS],
    ),
    section("Hyung 형", line("KYUHK_PAH_HYUNG")),
    section(
        "You Dahn Hyung 유단 형",
        line("JUHNG_GUHM_HYUNG"),
        line("JOONG_BONG_IL_HYUNG"),
        line("DAHN_BONG_HYUNG", None, FOUR_DIRECTIONAL),
        line("BAEK_PAHL_KI_HYUNG"),
    ),
    section(
        "Dae Ryuhn 대련",
        line("BONG_DAE_RYUHN"),
        line("KEUN_DAE_RYUHN"),
        line("JOHK_BAHNG_UH_SOOL"),
        line("JAHP_KI"),
        line("JAH_YU_DAE_RYUHN"),
        line("SAHM_SAH_IN_DAE_RYUHN"),
    ),
    section(
        "Ee Dahn Moo Ki Hyung 이단 무기형",
        line("YUHK_GUHM_HYUNG"),
        line("DAHN_SSAHNG_BOHNG_HYUNG"),
    ),
    section(
        "Teuk Soo Soo Ki, Johk Sool & Kyuhk Pah (II) 특수 수기, 족술 및 격파",
        line("PYUHNG_SOO"),
        line("KWAHN_SOO"),
        line("IL_JEE_KWUHN"),
        line("EE_JEE_KWUHN"),
        line(
            "DDI_UH_EE_JOONG_CHA_KI", None, "Chart notation: (AHP, YUHP, BAHL DEUNG)."
        ),
        line("SAHM_BAHNG_CHO_CHA_KI"),
        line("SAHM_JOONG_CHA_KI"),
    ),
    section("WKSA Pledge", line("WKSA_PLEDGE")),
]

SBN = [
    levels("Written 실습경력 on this chart."),
    section(
        "You Dahn Soo 유단 수",
        line("KI_BOHN_BOHN"),
        line("GAHK_DOH_BUP"),
        line("JUHN_HWAHN_BUP"),
        line("GOH_GEUP_SOHN_MOHK_SOO"),
        line("GOH_GEUP_EUE_BOHK_SOO"),
        line("JAH_KI"),
        line("WAH_KI"),
        line("EE_IN_JEH_AHP_SOOL"),
        line("JEE_AHP_SOOL"),
        line("YUHN_HENG_SOOL"),
        line("POH_BAHK_SOOL"),
        line("JEE_PENG_EE_SOOL"),
    ),
    section(
        "Sahm Dahn Soo 삼단 수",
        line("BAHK_SOOL", 10),
        line("PYUHNG_SOO", 10),
        line("BU_CHAE_SOOL", 10),
    ),
    section(
        "Study of Ki 기 학",
        line("KI_YUHN_SEUP_KWA_JUNG"),
        line("KI_KONG_BUP"),
        line("NAE_KONG"),
        line("WEA_KONG"),
    ),
    section("Hyung 형", line("SAHM_BAHNG_CHO_IL_HYUNG")),
    section(
        "You Dahn Hyung 유단 형",
        line("JUHNG_GUHM_HYUNG"),
        line("JOONG_BONG_IL_HYUNG"),
        line("DAHN_BONG_HYUNG"),
        line("BAEK_PAHL_KI_HYUNG"),
        line("KYUHK_PAH_HYUNG"),
        line("YUHK_GUHM_HYUNG"),
        line("DAHN_SSAHNG_BOHNG_HYUNG"),
    ),
    section(
        "Dae Ryuhn 대련",
        line("BONG_DAE_RYUHN"),
        line("KEUN_DAE_RYUHN"),
        line("JOHK_BAHNG_UH_SOOL"),
        line("JAHP_KI"),
        line("JAH_YU_DAE_RYUHN"),
        line("SAHM_SAH_IN_DAE_RYUHN"),
        line("CHAHNG_DAE_RYUHN"),
    ),
    section(
        "Sahm Dahn Moo Ki Hyung 삼단 무기형",
        line("DAHN_SSAHNG_GUHM_HYUNG"),
        line("CHAHNG_HYUNG"),
    ),
    section(
        "Study of Kuk Sool 국술 학",
        line("KUK_SOOL_WOHL_LEE"),
        line("KUK_SOOL_YUHK_SAH"),
        line("KUK_SOOL_SAHM_DAE_MOO_YEA"),
        line("SAH_DOH_MOO_SOOL"),
        line("BOOL_KYOH_MOO_SOOL"),
        line("GOONG_JOONG_MOO_SOO"),
    ),
    section("WKSA Pledge", line("WKSA_PLEDGE")),
]

CHARTS = [
    ("KSN", ADULT, KSN_ADULT),
    ("KSN", YOUTH, KSN_YOUTH),
    ("PSBN", ADULT, PSBN),
    ("SBN", ADULT, SBN),
]
FIRST_SEQUENCE = 100
STEP = 10


def rows(chart: list) -> list[tuple[str, int | None, str, int]]:
    """(item code, end number, notes, sequence) for every line of a chart."""
    result = []
    sequence = FIRST_SEQUENCE
    for title, lines in chart:
        for code, end, note in lines:
            # A note that is the chart's own parenthesis or asterisk stands
            # alone (the syllabus reads `Chart notation: (...)` for display);
            # any other line says which section of the chart it is in.
            if note.startswith(("Chart notation:", "*")):
                notes = note
            else:
                notes = f"{title}. {note}".strip() if note else f"{title}."
            result.append((code, end, notes, sequence))
            sequence += STEP
    return result


def add_charts(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    SyllabusItem = apps.get_model("syllabus", "SyllabusItem")
    SyllabusRequirement = apps.get_model("syllabus", "SyllabusRequirement")
    for code, name, korean_name, category in NEW_ITEMS:
        SyllabusItem.objects.create(
            code=code,
            name=name,
            korean_name=korean_name,
            category=category,
            description="WKSA Official Black Belt Requirement Chart.",
            active=True,
        )
    for rank_code, age_band, chart in CHARTS:
        rank = Rank.objects.get(code=rank_code)
        for code, end, notes, sequence in rows(chart):
            SyllabusRequirement.objects.create(
                rank=rank,
                age_band=age_band,
                item=SyllabusItem.objects.get(code=code),
                required=True,
                sequence=sequence,
                start_number=1 if end else None,
                end_number=end,
                notes=notes,
                active=True,
            )


def remove_charts(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    SyllabusItem = apps.get_model("syllabus", "SyllabusItem")
    SyllabusRequirement = apps.get_model("syllabus", "SyllabusRequirement")
    for rank_code, age_band, _chart in CHARTS:
        SyllabusRequirement.objects.filter(
            rank_id=Rank.objects.get(code=rank_code).pk, age_band=age_band
        ).delete()
    SyllabusItem.objects.filter(code__in=[item[0] for item in NEW_ITEMS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("syllabus", "0003_adult_jkn_technique_sets"),
        ("ranks", "0003_belt_colours"),
    ]

    operations = [migrations.RunPython(add_charts, remove_charts)]
