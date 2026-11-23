"""
routers/billing.py — Subscription plans, current plan & usage, checkout, invoices,
and supervisor endpoints to edit plans and prices.
"""
import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models.db_models import User, SubscriptionPlan, Subscription, Payment, LogLevel
from routers.auth import get_current_user, require_supervisor, log_event
from services import billing_service as billing

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["Billing"])

LIMIT_KEYS = ("uploads", "chat_queries", "forecasts", "reports", "max_file_mb")


# ── Schemas ───────────────────────────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    plan_code:     str
    billing_cycle: str = "monthly"


class PlanUpdate(BaseModel):
    name:          Optional[str]   = None
    tagline:       Optional[str]   = None
    price_monthly: Optional[float] = None
    price_yearly:  Optional[float] = None
    currency:      Optional[str]   = None
    limits:        Optional[dict]  = None
    features:      Optional[list[str]] = None
    is_active:     Optional[bool]  = None
    highlighted:   Optional[bool]  = None
    sort_order:    Optional[int]   = None


class PlanCreate(PlanUpdate):
    code: str
    name: str


def _payment_dict(p: Payment) -> dict:
    return {
        "id": p.id, "reference": p.reference, "plan_code": p.plan_code, "plan_name": p.plan_name,
        "billing_cycle": p.billing_cycle, "amount": float(p.amount), "currency": p.currency,
        "status": p.status, "provider": p.provider, "period_start": p.period_start,
        "period_end": p.period_end, "created_at": p.created_at,
    }


# ── Public / user endpoints ──────────────────────────────────────────────────

@router.get("/plans")
def list_plans(db: Session = Depends(get_db)):
    """Active plans shown on the pricing page (no login needed)."""
    plans = (db.query(SubscriptionPlan).filter(SubscriptionPlan.is_active == True)  # noqa: E712
             .order_by(SubscriptionPlan.sort_order, SubscriptionPlan.id).all())
    return [billing.plan_dict(p) for p in plans]


@router.get("/me")
def my_subscription(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Current plan, renewal date and this month's usage against the limits."""
    return billing.summary(db, current_user)


@router.post("/checkout")
def checkout(payload: CheckoutRequest, db: Session = Depends(get_db),
             current_user: User = Depends(get_current_user)):
    """Switch plan. Paid plans are charged through the configured provider (demo by default)."""
    sub, payment = billing.change_plan(db, current_user, payload.plan_code.strip().lower(),
                                       payload.billing_cycle.strip().lower())
    if payment:
        log_event(db, f"Subscribed to {payment.plan_name} ({payment.billing_cycle}) — "
                      f"{payment.currency} {payment.amount:.2f} [{payment.provider}]",
                  LogLevel.success, current_user, metadata={"payment": payment.reference})
    else:
        log_event(db, f"Subscription updated: {sub.plan.name}"
                      f"{' (cancels at period end)' if sub.cancel_at_period_end else ''}",
                  LogLevel.info, current_user)
    return {"summary": billing.summary(db, current_user),
            "payment": _payment_dict(payment) if payment else None}


@router.post("/cancel")
def cancel(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Cancel a paid plan. It stays active until the end of the paid period."""
    sub = billing.get_subscription(db, current_user)
    if billing.is_free(sub.plan):
        raise HTTPException(status_code=400, detail="You are on the free plan — there is nothing to cancel.")
    if sub.cancel_at_period_end:
        raise HTTPException(status_code=400, detail="Your plan is already set to cancel.")
    sub.cancel_at_period_end = True
    db.commit()
    log_event(db, f"Subscription to {sub.plan.name} canceled (active until period end)", LogLevel.warn, current_user)
    return billing.summary(db, current_user)


@router.post("/resume")
def resume(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Undo a cancellation before the period ends."""
    sub = billing.get_subscription(db, current_user)
    if not sub.cancel_at_period_end:
        raise HTTPException(status_code=400, detail="Your plan is not set to cancel.")
    sub.cancel_at_period_end = False
    db.commit()
    log_event(db, f"Subscription to {sub.plan.name} resumed", LogLevel.info, current_user)
    return billing.summary(db, current_user)


@router.get("/payments")
def my_payments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (db.query(Payment).filter(Payment.user_id == current_user.id)
            .order_by(Payment.created_at.desc(), Payment.id.desc()).limit(50).all())
    return [_payment_dict(p) for p in rows]


# ── Supervisor endpoints ─────────────────────────────────────────────────────

def _validate(data: dict) -> dict:
    for key in ("price_monthly", "price_yearly"):
        if key in data and data[key] is not None:
            if data[key] < 0 or data[key] > 1_000_000:
                raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ')} must be between 0 and 1,000,000.")
            data[key] = round(float(data[key]), 2)
    if data.get("currency") is not None:
        cur = data["currency"].strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", cur):
            raise HTTPException(status_code=400, detail="Currency must be a 3-letter code, e.g. USD or PKR.")
        data["currency"] = cur
    if data.get("limits") is not None:
        clean = {}
        for k, v in data["limits"].items():
            if k not in LIMIT_KEYS:
                raise HTTPException(status_code=400, detail=f"Unknown limit '{k}'. Allowed: {', '.join(LIMIT_KEYS)}.")
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"Limit '{k}' must be a whole number (-1 = unlimited).")
            if v < -1:
                raise HTTPException(status_code=400, detail=f"Limit '{k}' must be -1 (unlimited) or more.")
            clean[k] = v
        data["limits"] = clean
    if data.get("features") is not None:
        data["features"] = [f.strip() for f in data["features"] if f and f.strip()][:12]
    if data.get("name") is not None and not data["name"].strip():
        raise HTTPException(status_code=400, detail="Plan name cannot be empty.")
    return data


@router.get("/admin/plans")
def admin_plans(db: Session = Depends(get_db), _: User = Depends(require_supervisor)):
    counts = dict(db.query(Subscription.plan_id, func.count(Subscription.id)).group_by(Subscription.plan_id).all())
    plans = db.query(SubscriptionPlan).order_by(SubscriptionPlan.sort_order, SubscriptionPlan.id).all()
    return [{**billing.plan_dict(p), "subscribers": int(counts.get(p.id, 0))} for p in plans]


@router.put("/admin/plans/{plan_id}")
def admin_update_plan(plan_id: int, payload: PlanUpdate, db: Session = Depends(get_db),
                      supervisor: User = Depends(require_supervisor)):
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found.")
    data = _validate(payload.model_dump(exclude_unset=True))
    if data.get("is_active") is False and plan.is_default:
        raise HTTPException(status_code=400, detail="The default (free) plan can't be hidden — new users start on it.")
    if "limits" in data:
        data["limits"] = {**(plan.limits or {}), **data["limits"]}
    for k, v in data.items():
        setattr(plan, k, v)
    db.commit()
    db.refresh(plan)
    log_event(db, f"Plan '{plan.name}' updated by supervisor", LogLevel.info, supervisor,
              metadata={"plan": plan.code, "changes": list(data)})
    return billing.plan_dict(plan)


@router.post("/admin/plans", status_code=201)
def admin_create_plan(payload: PlanCreate, db: Session = Depends(get_db),
                      supervisor: User = Depends(require_supervisor)):
    code = payload.code.strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{2,40}", code):
        raise HTTPException(status_code=400, detail="Plan code must be 2–40 lowercase letters, numbers, - or _.")
    if db.query(SubscriptionPlan).filter(SubscriptionPlan.code == code).first():
        raise HTTPException(status_code=400, detail=f"A plan with code '{code}' already exists.")
    data = _validate(payload.model_dump(exclude_unset=True))
    data["code"] = code
    data.setdefault("limits", {k: billing.UNLIMITED for k in LIMIT_KEYS if k != "max_file_mb"} | {"max_file_mb": 50})
    data.setdefault("features", [])
    data.setdefault("price_monthly", 0)
    data.setdefault("price_yearly", 0)
    data.setdefault("currency", "USD")
    data.setdefault("sort_order", (db.query(func.max(SubscriptionPlan.sort_order)).scalar() or 0) + 1)
    plan = SubscriptionPlan(**data)
    db.add(plan)
    db.commit()
    db.refresh(plan)
    log_event(db, f"Plan '{plan.name}' created by supervisor", LogLevel.info, supervisor)
    return billing.plan_dict(plan)


@router.get("/admin/stats")
def admin_stats(db: Session = Depends(get_db), _: User = Depends(require_supervisor)):
    """Subscribers per plan, monthly recurring revenue and revenue this month."""
    subs = db.query(Subscription).all()
    mrr: dict[str, float] = {}
    paying = 0
    for s in subs:
        if billing.is_free(s.plan) or s.status != "active":
            continue
        paying += 1
        monthly = (s.plan.price_yearly / 12) if s.billing_cycle == "yearly" else s.plan.price_monthly
        mrr[s.plan.currency] = round(mrr.get(s.plan.currency, 0) + float(monthly), 2)
    start = billing.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    revenue: dict[str, float] = {}
    for cur, total in (db.query(Payment.currency, func.sum(Payment.amount))
                       .filter(Payment.status == "paid", Payment.created_at >= start)
                       .group_by(Payment.currency).all()):
        revenue[cur] = round(float(total or 0), 2)
    return {"total_subscriptions": len(subs), "paying": paying, "mrr": mrr,
            "revenue_this_month": revenue, "payment_provider": billing.settings.payment_provider}
