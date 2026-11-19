"""Invoice amounts ↔ Stripe amounts (one-time-pay.md, P5).

Stripe takes and returns every amount as a whole number in the currency's smallest unit:
cents for USD ($300.00 → 30000), but yen have no smaller unit (¥5,000 → 5000, not 500000)
and a few currencies have three decimals (KWD 12.340 → 12340). A plain ×100 / ÷100 charges
a yen invoice 100× too much and records 1/100 of what was paid. Everything that sends an
amount to Stripe or reads one back goes through these two functions, with Decimal maths
only (no floats).
"""
from decimal import ROUND_HALF_UP, Decimal

# https://docs.stripe.com/currencies#zero-decimal
ZERO_DECIMAL = {"BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
                "UGX", "VND", "VUV", "XAF", "XOF", "XPF"}
# https://docs.stripe.com/currencies#three-decimal — sent ×1000, and the last digit must be 0
THREE_DECIMAL = {"BHD", "JOD", "KWD", "OMR", "TND"}


def smallest_unit(currency: str) -> Decimal:
    """The smallest amount that can actually be charged in this currency."""
    return Decimal("1") if (currency or "").upper() in ZERO_DECIMAL else Decimal("0.01")


def to_minor(amount, currency: str) -> int:
    """Decimal amount → Stripe integer. Rounds half up to what the currency can charge."""
    cur = (currency or "").upper()
    rounded = Decimal(amount).quantize(smallest_unit(cur), rounding=ROUND_HALF_UP)
    if cur in ZERO_DECIMAL:
        return int(rounded)
    return int(rounded * (1000 if cur in THREE_DECIMAL else 100))


def from_minor(value, currency: str) -> Decimal:
    """Stripe integer → Decimal amount."""
    cur = (currency or "").upper()
    exponent = 0 if cur in ZERO_DECIMAL else 3 if cur in THREE_DECIMAL else 2
    return Decimal(int(value or 0)).scaleb(-exponent)


def is_chargeable(amount, currency: str) -> bool:
    """False if `amount` has more decimals than the currency can charge (e.g. ¥10.50, $1.005)."""
    return Decimal(amount) == Decimal(amount).quantize(smallest_unit(currency))
