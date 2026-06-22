from __future__ import annotations

from typing import Any

from django.db import migrations

ITEMS = [
    (
        "YEA_EUE",
        "Yea Eue",
        "예의",
        "ETIQUETTE",
        "WKSA Version 2014 chart header.",
        True,
    ),
    (
        "KI_CHO_JAH_KI",
        "Ki Cho Jah Ki",
        "기초짜기",
        "FUNDAMENTALS",
        "WKSA Version 2014 chart header.",
        True,
    ),
    (
        "SOO_KI",
        "Soo Ki",
        "수기",
        "HAND_TECHNIQUES",
        "WKSA Version 2014 chart header.",
        True,
    ),
    (
        "JOHK_SOOL",
        "Johk Sool",
        "족술",
        "KICKING",
        "WKSA Version 2014 chart header.",
        True,
    ),
    (
        "NAHK_BUP",
        "Nahk Bup",
        "낙법",
        "FALLING",
        "WKSA Version 2014 chart header.",
        True,
    ),
    (
        "KYUK_PAH",
        "Kyuk Pah",
        "격파",
        "BREAKING",
        "WKSA Version 2014 chart header.",
        True,
    ),
    ("SOHN_PPAE_KI", "Sohn Ppae Ki", "", "TECHNIQUE_SET", "", True),
    ("KI_BOHN_SOO", "Ki Bohn Soo", "기본수", "TECHNIQUE_SET", "", True),
    ("SOHN_MOHK_SOO", "Sohn Mohk Soo", "손목수", "TECHNIQUE_SET", "", True),
    ("EUE_BOHK_SOO", "Eue Bohk Soo", "의복수", "TECHNIQUE_SET", "", True),
    ("AHN_SOHN_MOHK_SOO", "Ahn Sohn Mohk Soo", "안손목수", "TECHNIQUE_SET", "", True),
    ("MAEK_CHI_KI", "Maek Chi Ki", "맥치기", "TECHNIQUE_SET", "", True),
    ("MAEK_CHA_KI", "Maek Cha Ki", "맥차기", "TECHNIQUE_SET", "", True),
    (
        "JOO_MUHK_MAGA_KI_BON_SOO",
        "Joo Muhk Maga Ki Bon Soo",
        "주먹막아 기본수",
        "TECHNIQUE_SET",
        "",
        True,
    ),
    (
        "JOONG_GEUP_SOHN_MOHK_SOO",
        "Joong Geup Sohn Mohk Soo",
        "중급손목수",
        "TECHNIQUE_SET",
        "",
        True,
    ),
    ("AHP_EUE_BOHK_SOO", "Ahp Eue Bohk Soo", "앞의복수", "TECHNIQUE_SET", "", True),
    ("DEE_EUE_BOHK_SOO", "Dee Eue Bohk Soo", "뒤의복수", "TECHNIQUE_SET", "", True),
    ("KWAHN_JUHL_KI", "Kwahn Juhl Ki", "관절기", "TECHNIQUE_SET", "", True),
    ("TOO_KI", "Too Ki", "투기", "TECHNIQUE_SET", "", True),
    ("MOHK_JOH_LEU_KI", "Mohk Joh Leu Ki", "목조르기", "TECHNIQUE_SET", "", True),
    ("BAHNG_TOO_KI", "Bahng Too Ki", "방투기", "TECHNIQUE_SET", "", True),
    (
        "YAHNG_SOHN_MOHK_SOO",
        "Yahng Sohn Mohk Soo",
        "양손목수",
        "TECHNIQUE_SET",
        "",
        True,
    ),
    ("SSAHNG_SOO", "Ssahng Soo", "쌍수", "TECHNIQUE_SET", "", True),
    ("DAHN_DOH_MAHK_KI", "Dahn Doh Mahk Ki", "단도막기", "TECHNIQUE_SET", "", True),
    ("KI_CHO_HYUNG", "Ki Cho Hyung", "기초형", "FORM", "", True),
    ("CHO_GEUP_HYUNG", "Cho Geup Hyung", "초급형", "FORM", "", True),
    ("JOONG_GEUP_HYUNG", "Joong Geup Hyung", "중급형", "FORM", "", True),
    ("GOH_GEUP_HYUNG", "Goh Geup Hyung", "고급형", "FORM", "", True),
    ("DAE_GEUP_HYUNG", "Dae Geup Hyung", "대급형", "FORM", "", True),
    ("GUHM_MOO_HYUNG", "Guhm Moo Hyung", "검무형", "FORM", "", True),
    ("SWORD_TECHS", "Sword Techs", "기초검", "WEAPONS", "", True),
    ("BOHNG_DOL_LI_KI", "Bohng Dol-li-ki", "봉돌리기", "WEAPONS", "", True),
]

GENERAL_REQUIREMENTS = [
    ("YEA_EUE", 10),
    ("KI_CHO_JAH_KI", 20),
    ("SOO_KI", 30),
    ("JOHK_SOOL", 40),
    ("NAHK_BUP", 50),
    ("KYUK_PAH", 60),
]

AGE_BANDS = [
    "AGE_8_AND_UNDER",
    "AGE_9_TO_12",
    "AGE_13_TO_17",
    "AGE_18_AND_OVER",
]

SEEDED_RANK_CODES = [
    "YELLOW_STRIPE",
    "YELLOW",
    "BLUE_STRIPE",
    "BLUE",
    "RED_STRIPE",
    "RED",
    "BROWN_STRIPE",
    "BROWN",
    "BLACK_STRIPE",
    "DAHN_BO",
    "JKN",
]

ADULT_YOUTH_UNDER_BLACK_BELT = [
    (
        "YELLOW_STRIPE",
        [
            ("SOHN_PPAE_KI", 100, 1, 5, ""),
            ("KI_BOHN_SOO", 110, 1, 5, ""),
            ("KI_CHO_HYUNG", 200, None, None, "Chart notation: (1-3)."),
        ],
    ),
    (
        "YELLOW",
        [
            ("KI_BOHN_SOO", 100, 1, 15, ""),
            ("KI_CHO_HYUNG", 200, None, None, "Chart notation: (1-6)."),
        ],
    ),
    (
        "BLUE_STRIPE",
        [
            ("SOHN_MOHK_SOO", 100, 1, 5, ""),
            ("CHO_GEUP_HYUNG", 200, None, None, "Chart notation: (1/2)."),
        ],
    ),
    (
        "BLUE",
        [
            ("SOHN_MOHK_SOO", 100, 1, 11, ""),
            ("CHO_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "RED_STRIPE",
        [
            ("EUE_BOHK_SOO", 100, 1, 6, ""),
            ("JOONG_GEUP_HYUNG", 200, None, None, "Chart notation: (1/2)."),
        ],
    ),
    (
        "RED",
        [
            ("EUE_BOHK_SOO", 100, 1, 13, ""),
            ("JOONG_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "BROWN_STRIPE",
        [
            ("AHN_SOHN_MOHK_SOO", 100, 1, 6, ""),
            ("GOH_GEUP_HYUNG", 200, None, None, "Chart notation: (1/2)."),
        ],
    ),
    (
        "BROWN",
        [
            ("MAEK_CHI_KI", 100, 1, 15, ""),
            ("GOH_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "BLACK_STRIPE",
        [
            ("MAEK_CHA_KI", 100, 1, 15, ""),
            ("DAE_GEUP_HYUNG", 200, None, None, "Chart notation: (1/2)."),
        ],
    ),
    (
        "DAHN_BO",
        [
            ("JOO_MUHK_MAGA_KI_BON_SOO", 100, 1, 15, ""),
            ("DAE_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
]

JUNIOR_UNDER_BLACK_BELT = [
    (
        "YELLOW_STRIPE",
        "AGE_9_TO_12",
        [
            ("SOHN_PPAE_KI", 100, 1, 5, ""),
            ("KI_BOHN_SOO", 110, 1, 5, ""),
            ("KI_CHO_HYUNG", 200, None, None, "Chart notation: (1-3)."),
        ],
    ),
    (
        "YELLOW_STRIPE",
        "AGE_8_AND_UNDER",
        [
            ("SOHN_PPAE_KI", 100, 1, 5, ""),
            ("KI_CHO_HYUNG", 200, None, None, "Chart notation: (1 & 2)."),
        ],
    ),
    (
        "YELLOW",
        "AGE_9_TO_12",
        [
            ("KI_BOHN_SOO", 100, 1, 10, ""),
            ("KI_CHO_HYUNG", 200, None, None, "Chart notation: (1-6)."),
        ],
    ),
    (
        "YELLOW",
        "AGE_8_AND_UNDER",
        [
            ("KI_BOHN_SOO", 100, 1, 5, ""),
            ("KI_CHO_HYUNG", 200, None, None, "Chart notation: (1-4)."),
        ],
    ),
    (
        "BLUE_STRIPE",
        "AGE_9_TO_12",
        [
            ("KI_BOHN_SOO", 100, 1, 15, ""),
            ("CHO_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "BLUE_STRIPE",
        "AGE_8_AND_UNDER",
        [
            ("KI_BOHN_SOO", 100, 1, 10, ""),
            ("KI_CHO_HYUNG", 200, None, None, "Chart notation: (1-6)."),
        ],
    ),
    (
        "BLUE",
        "AGE_9_TO_12",
        [
            ("SOHN_MOHK_SOO", 100, 1, 5, ""),
            ("CHO_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "BLUE",
        "AGE_8_AND_UNDER",
        [
            ("KI_BOHN_SOO", 100, 1, 15, ""),
            ("CHO_GEUP_HYUNG", 200, None, None, "Chart notation: (pt.1)."),
        ],
    ),
    (
        "RED_STRIPE",
        "AGE_9_TO_12",
        [
            ("SOHN_MOHK_SOO", 100, 1, 11, ""),
            ("JOONG_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "RED_STRIPE",
        "AGE_8_AND_UNDER",
        [
            ("SOHN_MOHK_SOO", 100, 1, 5, ""),
            ("CHO_GEUP_HYUNG", 200, None, None, "Chart notation: (pt.2)."),
        ],
    ),
    (
        "RED",
        "AGE_9_TO_12",
        [
            ("EUE_BOHK_SOO", 100, 1, 6, ""),
            ("JOONG_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "RED",
        "AGE_8_AND_UNDER",
        [
            ("SOHN_MOHK_SOO", 100, 1, 11, ""),
            ("CHO_GEUP_HYUNG", 200, None, None, "Chart notation: (pt.3)."),
        ],
    ),
    (
        "BROWN_STRIPE",
        "AGE_9_TO_12",
        [
            ("EUE_BOHK_SOO", 100, 1, 13, ""),
            ("GOH_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "BROWN_STRIPE",
        "AGE_8_AND_UNDER",
        [
            ("EUE_BOHK_SOO", 100, 1, 6, ""),
            ("JOONG_GEUP_HYUNG", 200, None, None, "Chart notation: (1/2)."),
        ],
    ),
    (
        "BROWN",
        "AGE_9_TO_12",
        [
            ("AHN_SOHN_MOHK_SOO", 100, 1, 6, ""),
            ("GOH_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "BROWN",
        "AGE_8_AND_UNDER",
        [
            ("EUE_BOHK_SOO", 100, 1, 13, ""),
            ("JOONG_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "BLACK_STRIPE",
        "AGE_9_TO_12",
        [
            ("MAEK_CHI_KI", 100, 1, 7, ""),
            ("DAE_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "BLACK_STRIPE",
        "AGE_8_AND_UNDER",
        [
            ("AHN_SOHN_MOHK_SOO", 100, 1, 6, ""),
            ("GOH_GEUP_HYUNG", 200, None, None, "Chart notation: (1/2)."),
        ],
    ),
    (
        "DAHN_BO",
        "AGE_9_TO_12",
        [
            ("MAEK_CHI_KI", 100, 1, 15, ""),
            ("DAE_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
    (
        "DAHN_BO",
        "AGE_8_AND_UNDER",
        [
            ("MAEK_CHI_KI", 100, 1, 7, ""),
            ("GOH_GEUP_HYUNG", 200, None, None, ""),
        ],
    ),
]

JKN_REQUIREMENTS = [
    (
        "AGE_8_AND_UNDER",
        [
            (
                "MAEK_CHI_KI",
                True,
                100,
                1,
                15,
                "Promotion requirements for Age 8 & Under.",
            ),
            (
                "MAEK_CHA_KI",
                True,
                110,
                1,
                15,
                "Promotion requirements for Age 8 & Under.",
            ),
            (
                "JOO_MUHK_MAGA_KI_BON_SOO",
                True,
                120,
                1,
                15,
                "Promotion requirements for Age 8 & Under.",
            ),
            ("DAE_GEUP_HYUNG", True, 200, None, None, ""),
            ("GUHM_MOO_HYUNG", True, 210, None, None, ""),
            ("SWORD_TECHS", True, 300, 1, 5, ""),
            ("BOHNG_DOL_LI_KI", True, 310, 1, 10, ""),
        ],
    ),
    (
        "AGE_9_TO_12",
        [
            (
                "JOONG_GEUP_SOHN_MOHK_SOO",
                True,
                100,
                1,
                7,
                "Promotion requirements for Age 9-12.",
            ),
            (
                "AHP_EUE_BOHK_SOO",
                True,
                110,
                1,
                20,
                "Promotion requirements for Age 9-12.",
            ),
            ("DAE_GEUP_HYUNG", True, 200, None, None, ""),
            ("GUHM_MOO_HYUNG", True, 210, None, None, ""),
            ("SWORD_TECHS", True, 300, 1, 5, ""),
            ("BOHNG_DOL_LI_KI", True, 310, 1, 10, ""),
        ],
    ),
    (
        "AGE_13_TO_17",
        [
            (
                "JOONG_GEUP_SOHN_MOHK_SOO",
                True,
                100,
                1,
                7,
                "Required for Black Belt Promotion for Age 13-17.",
            ),
            (
                "AHP_EUE_BOHK_SOO",
                True,
                110,
                1,
                20,
                "Required for Black Belt Promotion for Age 13-17.",
            ),
            (
                "DEE_EUE_BOHK_SOO",
                True,
                120,
                1,
                23,
                "Required for Black Belt Promotion for Age 13-17.",
            ),
            (
                "KWAHN_JUHL_KI",
                True,
                130,
                1,
                13,
                "Required for Black Belt Promotion for Age 13-17.",
            ),
            (
                "TOO_KI",
                True,
                140,
                1,
                13,
                "Required for Black Belt Promotion for Age 13-17.",
            ),
            ("GUHM_MOO_HYUNG", True, 200, None, None, ""),
            ("SWORD_TECHS", True, 300, 1, 5, ""),
            ("BOHNG_DOL_LI_KI", True, 310, 1, 15, ""),
        ],
    ),
    (
        "AGE_18_AND_OVER",
        [
            (
                "MOHK_JOH_LEU_KI",
                True,
                100,
                1,
                5,
                "Required for Black Belt Promotion for Adults.",
            ),
            (
                "BAHNG_TOO_KI",
                True,
                110,
                1,
                10,
                "Required for Black Belt Promotion for Adults.",
            ),
            ("GUHM_MOO_HYUNG", True, 200, None, None, ""),
            ("SWORD_TECHS", True, 300, 1, 5, ""),
            ("BOHNG_DOL_LI_KI", True, 310, 1, 15, ""),
        ],
    ),
]


def requirement_tuples() -> list[
    tuple[str, str, str, bool, int, int | None, int | None, str, bool]
]:
    requirements: list[
        tuple[str, str, str, bool, int, int | None, int | None, str, bool]
    ] = []

    for rank_code in SEEDED_RANK_CODES:
        for age_band in AGE_BANDS:
            for item_code, sequence in GENERAL_REQUIREMENTS:
                requirements.append(
                    (
                        rank_code,
                        age_band,
                        item_code,
                        True,
                        sequence,
                        None,
                        None,
                        "",
                        True,
                    ),
                )

    for rank_code, under_black_entries in ADULT_YOUTH_UNDER_BLACK_BELT:
        for age_band in ["AGE_13_TO_17", "AGE_18_AND_OVER"]:
            for item_code, sequence, start, end, notes in under_black_entries:
                requirements.append(
                    (
                        rank_code,
                        age_band,
                        item_code,
                        True,
                        sequence,
                        start,
                        end,
                        notes,
                        True,
                    ),
                )

    for rank_code, age_band, junior_entries in JUNIOR_UNDER_BLACK_BELT:
        for item_code, sequence, start, end, notes in junior_entries:
            requirements.append(
                (
                    rank_code,
                    age_band,
                    item_code,
                    True,
                    sequence,
                    start,
                    end,
                    notes,
                    True,
                ),
            )

    for age_band, jkn_entries in JKN_REQUIREMENTS:
        for item_code, required, sequence, start, end, notes in jkn_entries:
            requirements.append(
                (
                    "JKN",
                    age_band,
                    item_code,
                    required,
                    sequence,
                    start,
                    end,
                    notes,
                    True,
                ),
            )

    return requirements


REQUIREMENTS = requirement_tuples()


def seed_wksa_2014_syllabus(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    SyllabusItem = apps.get_model("syllabus", "SyllabusItem")
    SyllabusRequirement = apps.get_model("syllabus", "SyllabusRequirement")

    ranks_by_code = {
        rank.code: rank for rank in Rank.objects.filter(code__in=SEEDED_RANK_CODES)
    }

    items_by_code = {}
    for code, name, korean_name, category, description, active in ITEMS:
        item, _created = SyllabusItem.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "korean_name": korean_name,
                "category": category,
                "description": description,
                "active": active,
            },
        )
        items_by_code[code] = item

    for (
        rank_code,
        age_band,
        item_code,
        required,
        sequence,
        start_number,
        end_number,
        notes,
        active,
    ) in REQUIREMENTS:
        SyllabusRequirement.objects.update_or_create(
            rank=ranks_by_code[rank_code],
            age_band=age_band,
            item=items_by_code[item_code],
            defaults={
                "required": required,
                "sequence": sequence,
                "start_number": start_number,
                "end_number": end_number,
                "notes": notes,
                "active": active,
            },
        )


def unseed_wksa_2014_syllabus(apps: Any, _schema_editor: Any) -> None:
    Rank = apps.get_model("ranks", "Rank")
    SyllabusItem = apps.get_model("syllabus", "SyllabusItem")
    SyllabusRequirement = apps.get_model("syllabus", "SyllabusRequirement")

    ranks_by_code = {
        rank.code: rank for rank in Rank.objects.filter(code__in=SEEDED_RANK_CODES)
    }
    items_by_code = {
        item.code: item
        for item in SyllabusItem.objects.filter(code__in=[item[0] for item in ITEMS])
    }

    for (
        rank_code,
        age_band,
        item_code,
        required,
        sequence,
        start_number,
        end_number,
        notes,
        active,
    ) in reversed(REQUIREMENTS):
        rank = ranks_by_code.get(rank_code)
        item = items_by_code.get(item_code)
        if rank is None or item is None:
            continue

        SyllabusRequirement.objects.filter(
            rank=rank,
            age_band=age_band,
            item=item,
            required=required,
            sequence=sequence,
            start_number=start_number,
            end_number=end_number,
            notes=notes,
            active=active,
        ).delete()

    for code, name, korean_name, category, description, active in reversed(ITEMS):
        SyllabusItem.objects.filter(
            code=code,
            name=name,
            korean_name=korean_name,
            category=category,
            description=description,
            active=active,
            requirements__isnull=True,
        ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("syllabus", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_wksa_2014_syllabus, unseed_wksa_2014_syllabus),
    ]
