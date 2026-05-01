from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AlertRule
from deps import get_db

router = APIRouter(prefix="/alertrules", tags=["alertrules"])


class AlertRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    enabled: bool = True
    trigger_type: Literal["geofence_entry", "severity_threshold", "entity_type"]
    rule_filter: dict[str, Any] | None = None
    action_type: Literal["webhook_post", "log"] = "webhook_post"
    action_config: dict[str, Any] = Field(default_factory=dict)


class AlertRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    trigger_type: Literal["geofence_entry", "severity_threshold", "entity_type"] | None = None
    rule_filter: dict[str, Any] | None = None
    action_type: Literal["webhook_post", "log"] | None = None
    action_config: dict[str, Any] | None = None


class AlertRuleResponse(BaseModel):
    id: int
    name: str
    enabled: bool
    trigger_type: str
    rule_filter: dict[str, Any] | None
    action_type: str
    action_config: dict[str, Any]
    created_at: datetime
    updated_at: datetime | None


@router.get("", response_model=list[AlertRuleResponse])
async def list_alert_rules(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).order_by(AlertRule.id))
    rows = result.scalars().all()
    return [AlertRuleResponse.model_validate(r, from_attributes=True) for r in rows]


@router.post("", response_model=AlertRuleResponse, status_code=201)
async def create_alert_rule(body: AlertRuleCreate, db: AsyncSession = Depends(get_db)):
    if body.action_type == "webhook_post" and not body.action_config.get("url"):
        raise HTTPException(400, "action_config.url is required for webhook_post")

    now = datetime.now(timezone.utc)
    rule = AlertRule(
        name=body.name.strip(),
        enabled=body.enabled,
        trigger_type=body.trigger_type,
        rule_filter=body.rule_filter or {},
        action_type=body.action_type,
        action_config=body.action_config,
        created_at=now,
        updated_at=now,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return AlertRuleResponse.model_validate(rule, from_attributes=True)


@router.patch("/{rule_id}", response_model=AlertRuleResponse)
async def update_alert_rule(rule_id: int, body: AlertRuleUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "Alert rule not found")

    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(rule, key, value)

    if rule.action_type == "webhook_post" and not (rule.action_config or {}).get("url"):
        raise HTTPException(400, "action_config.url is required for webhook_post")

    rule.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(rule)
    return AlertRuleResponse.model_validate(rule, from_attributes=True)


@router.delete("/{rule_id}", status_code=204)
async def delete_alert_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertRule).where(AlertRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "Alert rule not found")
    await db.delete(rule)
    await db.commit()
