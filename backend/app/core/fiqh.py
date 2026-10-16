"""
Fund categories and the spending rules that bind them.

This module is the reason the product exists. Ordinary accounting software
treats money as fungible. Money held by an Islamic institution is not: each
category carries its own ruling on how it may be spent, and mixing them is a
religious problem, not just a bookkeeping one.

The rules here are encoded as data so a mufti or a state religious authority
can review them without reading Python.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class FundCategory(str, Enum):
    """The pots money can sit in. Never merge these."""

    ZAKAT = "zakat"
    SADAQAH = "sadaqah"
    INFAQ = "infaq"
    WAQF_PRINCIPAL = "waqf_principal"
    WAQF_INCOME = "waqf_income"
    NAZAR = "nazar"
    FIDYAH = "fidyah"
    KHAIRAT = "khairat"


class PurposeCode(str, Enum):
    """What money is being spent on. Checked against the fund's rules."""

    # The eight asnaf of Surah At-Tawbah 9:60
    ASNAF_FAKIR = "asnaf_fakir"
    ASNAF_MISKIN = "asnaf_miskin"
    ASNAF_AMIL = "asnaf_amil"
    ASNAF_MUALLAF = "asnaf_muallaf"
    ASNAF_RIQAB = "asnaf_riqab"
    ASNAF_GHARIMIN = "asnaf_gharimin"
    ASNAF_FISABILILLAH = "asnaf_fisabilillah"
    ASNAF_IBNUSSABIL = "asnaf_ibnussabil"

    # General institutional spending
    MOSQUE_MAINTENANCE = "mosque_maintenance"
    UTILITIES = "utilities"
    STAFF_SALARY = "staff_salary"
    EDUCATION = "education"
    ORPHAN_WELFARE = "orphan_welfare"
    FUNERAL_SUPPORT = "funeral_support"
    RAMADAN_PROGRAMME = "ramadan_programme"
    CAPITAL_PROJECT = "capital_project"
    ADMIN_COST = "admin_cost"


ASNAF_PURPOSES = frozenset(
    p for p in PurposeCode if p.value.startswith("asnaf_")
)


@dataclass(frozen=True)
class FundRule:
    """The constraint set for one fund category."""

    category: FundCategory
    label_ms: str
    label_en: str
    allowed_purposes: frozenset[PurposeCode] | None
    spendable: bool = True
    requires_donor_purpose: bool = False
    basis: str = ""
    notes: str = ""
    admin_cost_cap: float | None = None

    def permits(self, purpose: PurposeCode) -> bool:
        if not self.spendable:
            return False
        if self.allowed_purposes is None:
            return True
        return purpose in self.allowed_purposes


_GENERAL_PURPOSES = frozenset(
    {
        PurposeCode.MOSQUE_MAINTENANCE,
        PurposeCode.UTILITIES,
        PurposeCode.STAFF_SALARY,
        PurposeCode.EDUCATION,
        PurposeCode.ORPHAN_WELFARE,
        PurposeCode.FUNERAL_SUPPORT,
        PurposeCode.RAMADAN_PROGRAMME,
        PurposeCode.CAPITAL_PROJECT,
        PurposeCode.ADMIN_COST,
    }
)


FUND_RULES: dict[FundCategory, FundRule] = {
    FundCategory.ZAKAT: FundRule(
        category=FundCategory.ZAKAT,
        label_ms="Zakat",
        label_en="Zakat",
        allowed_purposes=frozenset(ASNAF_PURPOSES),
        basis="Surah At-Tawbah 9:60",
        notes=(
            "Distributable only to the eight asnaf. Cannot fund buildings, "
            "utilities or general administration. In most Malaysian states "
            "collection is the prerogative of the state zakat authority; an "
            "institution holding zakat is usually acting as a collection "
            "point, not the final distributor."
        ),
        admin_cost_cap=0.125,
    ),
    FundCategory.SADAQAH: FundRule(
        category=FundCategory.SADAQAH,
        label_ms="Sedekah am",
        label_en="General sadaqah",
        allowed_purposes=None,
        basis="Voluntary charity, unrestricted",
        notes="The only genuinely flexible pot. Most operating costs land here.",
    ),
    FundCategory.INFAQ: FundRule(
        category=FundCategory.INFAQ,
        label_ms="Infaq bertujuan",
        label_en="Purpose-bound infaq",
        allowed_purposes=None,
        requires_donor_purpose=True,
        basis="Donor intent binds the institution",
        notes=(
            "Unrestricted in category but bound to the purpose the donor "
            "named. The engine checks the declared purpose on the fund "
            "instance, not this rule."
        ),
    ),
    FundCategory.WAQF_PRINCIPAL: FundRule(
        category=FundCategory.WAQF_PRINCIPAL,
        label_ms="Wakaf (modal)",
        label_en="Waqf principal",
        allowed_purposes=frozenset(),
        spendable=False,
        basis="Perpetuity of the endowment",
        notes=(
            "Principal is perpetual and may never be consumed. Only the "
            "usufruct is spendable, and it is booked separately as "
            "waqf_income. This rule is what makes the ledger refuse to let a "
            "committee quietly eat an endowment."
        ),
    ),
    FundCategory.WAQF_INCOME: FundRule(
        category=FundCategory.WAQF_INCOME,
        label_ms="Wakaf (hasil)",
        label_en="Waqf income",
        allowed_purposes=None,
        requires_donor_purpose=True,
        basis="Usufruct of an endowment, bound by the waqif's intent",
        notes="Spendable, but only within the purpose the original waqif set.",
    ),
    FundCategory.NAZAR: FundRule(
        category=FundCategory.NAZAR,
        label_ms="Nazar",
        label_en="Vow offering",
        allowed_purposes=None,
        requires_donor_purpose=True,
        basis="The specific vow made",
        notes="Bound to whatever was vowed. Never general funds.",
    ),
    FundCategory.FIDYAH: FundRule(
        category=FundCategory.FIDYAH,
        label_ms="Fidyah",
        label_en="Fidyah",
        allowed_purposes=frozenset(
            {PurposeCode.ASNAF_FAKIR, PurposeCode.ASNAF_MISKIN}
        ),
        basis="Compensation for missed fasts, fed to the poor",
        notes="Goes to the poor as food or its value. Not general welfare.",
    ),
    FundCategory.KHAIRAT: FundRule(
        category=FundCategory.KHAIRAT,
        label_ms="Khairat kematian",
        label_en="Death benefit fund",
        allowed_purposes=frozenset(
            {PurposeCode.FUNERAL_SUPPORT, PurposeCode.ADMIN_COST}
        ),
        basis="Members' mutual fund",
        notes=(
            "A subscription pool for burial costs. Belongs to the members, "
            "not the institution, and cannot subsidise mosque operations."
        ),
    ),
}


def rule_for(category: FundCategory) -> FundRule:
    return FUND_RULES[category]


@dataclass
class RuleVerdict:
    """The answer the engine gives when asked if a spend is allowed."""

    allowed: bool
    code: str = "ok"
    message_en: str = ""
    message_ms: str = ""
    suggested_funds: list[FundCategory] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.allowed
