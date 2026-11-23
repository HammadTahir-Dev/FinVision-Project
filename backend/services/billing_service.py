"""
services/billing_service.py — Subscription plans, usage limits and (demo) payments.

How it fits together:
  • Plans live in the `subscription_plans` table. The defaults below are only
    inserted when a plan code is missing, so prices/limits edited by the
    supervisor are never overwritten on restart.
  • Every user has one row in `subscriptions` (created on first use, on the
    default Free plan).
  • Limits are per calendar month (UTC) and reset on the 1st. Usage is counted
    in `usage_counters`, so deleting chats/files/reports doesn't reset it.
  • Supervisors are never limited.
  • PAYMENT_PROVIDER=demo activates paid plans instantly and records a demo
    invoice. To take real money, implement `_charge()` for your gateway.
"""
from __future__ import annotations

import logging
from calendar import monthrange
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from config import get_settings
from models.db_models import (
    User, UserRole, SubscriptionPlan, Subscription, Payment, UsageCounter,
)

logger   = logging.getLogger(__name__)
settings = get_settings()

UNLIMITED = -1
METRICS = {
    "uploads":      "file uploads",
    "chat_queries": "AI chat questions",
    "forecasts":    "forecasts",
    "reports":      "reports",
}

# Starting prices — change them later from the Supervisor → Plans & Pricing page.
DEFAULT_PLANS = [
    {
        "code": "free", "name": "Free", "sort_order": 1, "is_default": True,
        "tagline": "Try FinVision on your own data",
        "price_monthly": 0, "price_yearly": 0, "currency": "USD",
        "limits": {"uploads": 10, "chat_queries": 50, "forecasts": 5, "reports": 2, "max_file_mb": 10},
        "features": ["10 file uploads / month", "50 AI chat questions / month", "5 forecasts / month",
                     "2 PDF & Excel reports / month", "Files up to 10 MB", "Chat history saved"],
    },
    {
        "code": "pro", "name": "Pro", "sort_order": 2, "highlighted": True,
        "tagline": "For analysts working with data every day",
        "price_monthly": 19, "price_yearly": 190, "currency": "USD",
        "limits": {"uploads": 100, "chat_queries": 1000, "forecasts": 50, "reports": 30, "max_file_mb": 50},
        "features": ["100 file uploads / month", "1,000 AI chat questions / month", "50 forecasts / month",
                     "30 reports / month", "Files up to 50 MB", "Everything in Free"],
    },
    {
        "code": "business", "name": "Business", "sort_order": 3,
        "tagline": "For teams and heavy workloads",
        "price_monthly": 49, "price_yearly": 490, "currency": "USD",
        "limits": {"uploads": UNLIMITED, "chat_queries": UNLIMITED, "forecasts": UNLIMITED,
                   "reports": UNLIMITED, "max_file_mb": 100},
        "features": ["Unlimited uploads", "Unlimited AI chat questions", "Unlimited forecasts",
                     "Unlimited reports", "Files up to 100 MB", "Everything in Pro"],
    },
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def current_period(now: Optional[datetime] = None) -> str:
    return (now or utcnow()).strftime("%Y-%m")


def next_reset(now: Optional[datetime] = None) -> datetime:
    now = now or utcnow()
    y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return datetime(y, m, 1, tzinfo=timezone.utc)


def add_months(dt: datetime, months: int) -> datetime:
    m = dt.month - 1 + months
    y, m = dt.year + m // 12, m % 12 + 1
    return dt.replace(year=y, month=m, day=min(dt.day, monthrange(y, m)[1]))


# ── Plans ─────────────────────────────────────────────────────────────────────

def seed_plans(db: Session) -> None:
    """Insert default plans that don't exist yet (never overwrites edits)."""
    existing = {p.code for p in db.query(SubscriptionPlan.code).all()}
    added = 0
    for spec in DEFAULT_PLANS:
        if spec["code"] not in existing:
            db.add(SubscriptionPlan(**spec))
            added += 1
    if added:
        db.commit()
        logger.info(f"💳 Seeded {added} subscription plan(s)")


def default_plan(db: Session) -> SubscriptionPlan:
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.is_default == True).first()  # noqa: E712
    if not plan:
        seed_plans(db)
        plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.is_default == True).first()  # noqa: E712
    return plan


def plan_dict(p: SubscriptionPlan) -> dict:
    return {
        "id": p.id, "code": p.code, "name": p.name, "tagline": p.tagline,
        "price_monthly": float(p.price_monthly or 0), "price_yearly": float(p.price_yearly or 0),
        "currency": p.currency, "limits": p.limits or {}, "features": p.features or [],
        "is_default": bool(p.is_default), "is_active": bool(p.is_active),
        "highlighted": bool(p.highlighted), "sort_order": p.sort_order or 0,
    }


def is_free(plan: SubscriptionPlan) -> bool:
    return float(plan.price_monthly or 0) == 0 and float(plan.price_yearly or 0) == 0


# ── Subscriptions ─────────────────────────────────────────────────────────────

def get_subscription(db: Session, user: User) -> Subscription:
    """The user's subscription, created on the default plan if missing and
    rolled over / downgraded when a paid period has ended."""
    sub = db.query(Subscription).filter(Subscription.user_id == user.id).first()
    if not sub:
        sub = Subscription(user_id=user.id, plan_id=default_plan(db).id, billing_cycle="monthly",
                           status="active", current_period_start=utcnow())
        db.add(sub)
        db.commit()
        db.refresh(sub)
        return sub

    end = _aware(sub.current_period_end)
    now = utcnow()
    if end and end <= now:
        if sub.cancel_at_period_end or sub.status == "canceled" or not sub.plan.is_active:
            # Paid period over → back to the free plan
            sub.plan_id              = default_plan(db).id
            sub.billing_cycle        = "monthly"
            sub.status               = "active"
            sub.current_period_start = now
            sub.current_period_end   = None
            sub.cancel_at_period_end = False
            logger.info(f"Subscription for user {user.id} ended → moved to free plan")
        else:
            # Renew for another period (demo provider charges nothing)
            while end <= now:
                start = end
                end = add_months(start, 12 if sub.billing_cycle == "yearly" else 1)
                _record_payment(db, user, sub.plan, sub.billing_cycle, start, end)
            sub.current_period_start = start
            sub.current_period_end   = end
        db.commit()
        db.refresh(sub)
    return sub


def _charge(user: User, plan: SubscriptionPlan, cycle: str, amount: float) -> str:
    """Take the payment. Returns the provider name. Plug a real gateway in here."""
    provider = (settings.payment_provider or "demo").lower()
    if provider == "demo":
        return "demo"
    raise HTTPException(
        status_code=501,
        detail=f"Payment provider '{provider}' is not set up yet. Set PAYMENT_PROVIDER=demo in backend/.env.",
    )


def _record_payment(db: Session, user: User, plan: SubscriptionPlan, cycle: str,
                    start: datetime, end: datetime, provider: str = "demo") -> Payment:
    amount = float(plan.price_yearly if cycle == "yearly" else plan.price_monthly)
    pay = Payment(user_id=user.id, plan_code=plan.code, plan_name=plan.name, billing_cycle=cycle,
                  amount=amount, currency=plan.currency, status="paid", provider=provider,
                  reference="pending", period_start=start, period_end=end)
    db.add(pay)
    db.flush()
    pay.reference = f"FV-{utcnow():%Y%m%d}-{pay.id:05d}"
    return pay


def change_plan(db: Session, user: User, plan_code: str, cycle: str) -> tuple[Subscription, Optional[Payment]]:
    if cycle not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="Billing cycle must be 'monthly' or 'yearly'.")
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.code == plan_code,
                                             SubscriptionPlan.is_active == True).first()  # noqa: E712
    if not plan:
        raise HTTPException(status_code=404, detail="That plan is not available.")

    sub = get_subscription(db, user)
    if is_free(plan):
        if is_free(sub.plan):
            raise HTTPException(status_code=400, detail="You are already on the free plan.")
        # Downgrade happens at the end of the period the user already paid for
        sub.cancel_at_period_end = True
        db.commit()
        db.refresh(sub)
        return sub, None

    if sub.plan_id == plan.id and sub.billing_cycle == cycle and not sub.cancel_at_period_end:
        raise HTTPException(status_code=400, detail=f"You are already on {plan.name} ({cycle}).")

    if sub.plan_id == plan.id and sub.billing_cycle == cycle and sub.cancel_at_period_end:
        sub.cancel_at_period_end = False          # just resume, no new charge
        db.commit()
        db.refresh(sub)
        return sub, None

    now = utcnow()
    end = add_months(now, 12 if cycle == "yearly" else 1)
    amount = float(plan.price_yearly if cycle == "yearly" else plan.price_monthly)
    provider = _charge(user, plan, cycle, amount)
    pay = _record_payment(db, user, plan, cycle, now, end, provider)
    sub.plan_id              = plan.id
    sub.billing_cycle        = cycle
    sub.status               = "active"
    sub.current_period_start = now
    sub.current_period_end   = end
    sub.cancel_at_period_end = False
    db.commit()
    db.refresh(sub)
    db.refresh(pay)
    return sub, pay


# ── Usage & limits ────────────────────────────────────────────────────────────

def _counter(db: Session, user_id: int, metric: str, period: str) -> Optional[UsageCounter]:
    return db.query(UsageCounter).filter(UsageCounter.user_id == user_id, UsageCounter.period == period,
                                         UsageCounter.metric == metric).first()


def usage_for(db: Session, user: User) -> dict[str, int]:
    rows = db.query(UsageCounter).filter(UsageCounter.user_id == user.id,
                                         UsageCounter.period == current_period()).all()
    used = {m: 0 for m in METRICS}
    for r in rows:
        used[r.metric] = r.count
    return used


def check_limit(db: Session, user: User, metric: str, amount: int = 1) -> None:
    """Raise HTTP 402 if this action would go over the plan's monthly limit."""
    if user.role == UserRole.supervisor:
        return
    sub = get_subscription(db, user)
    limit = int((sub.plan.limits or {}).get(metric, UNLIMITED))
    if limit == UNLIMITED:
        return
    row = _counter(db, user.id, metric, current_period())
    used = row.count if row else 0
    if used + amount > limit:
        raise HTTPException(
            status_code=402,
            detail=(f"You've used all {limit} {METRICS.get(metric, metric)} included in the "
                    f"{sub.plan.name} plan this month. Upgrade your plan to continue, or wait until "
                    f"{next_reset():%d %b} when your limits reset."),
        )


def record_usage(db: Session, user: User, metric: str, amount: int = 1) -> None:
    period = current_period()
    try:
        row = _counter(db, user.id, metric, period)
        if row:
            row.count = (row.count or 0) + amount
        else:
            db.add(UsageCounter(user_id=user.id, period=period, metric=metric, count=amount))
        db.commit()
    except Exception as e:   # two requests created the row at once — retry once
        db.rollback()
        row = _counter(db, user.id, metric, period)
        if row:
            row.count = (row.count or 0) + amount
            db.commit()
        else:
            logger.warning(f"Could not record usage {metric} for user {user.id}: {e}")


def max_file_mb(db: Session, user: User, hard_cap: float) -> float:
    if user.role == UserRole.supervisor:
        return hard_cap
    limit = (get_subscription(db, user).plan.limits or {}).get("max_file_mb", hard_cap)
    if limit is None or float(limit) == UNLIMITED:
        return hard_cap
    return min(float(limit), hard_cap)


def summary(db: Session, user: User) -> dict:
    sub  = get_subscription(db, user)
    used = usage_for(db, user)
    limits = sub.plan.limits or {}
    return {
        "plan": plan_dict(sub.plan),
        "subscription": {
            "billing_cycle":        sub.billing_cycle,
            "status":               sub.status,
            "current_period_start": _aware(sub.current_period_start),
            "current_period_end":   _aware(sub.current_period_end),
            "cancel_at_period_end": bool(sub.cancel_at_period_end),
        },
        "usage": {m: {"used": used.get(m, 0), "limit": int(limits.get(m, UNLIMITED))} for m in METRICS},
        "max_file_mb": limits.get("max_file_mb"),
        "resets_at": next_reset(),
        "unlimited_role": user.role == UserRole.supervisor,
        "payment_provider": (settings.payment_provider or "demo").lower(),
    }
