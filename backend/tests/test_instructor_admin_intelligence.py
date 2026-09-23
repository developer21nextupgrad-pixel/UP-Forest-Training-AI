from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.core.config import Settings
from app.services.analytics import InstructorAnalyticsService


def settings():
    return Settings(
        mastery_quiz_weight=0.50,
        mastery_completion_weight=0.25,
        mastery_recency_weight=0.15,
        mastery_activity_weight=0.10,
    )


def svc():
    return InstructorAnalyticsService(None, settings())  # risk() is pure


def test_learning_risk_high_fixture():
    s = svc()
    snapshot = {
        "overall_mastery": 35,
        "coverage": 40,
        "decline_signal": 50,
        "last_activity": datetime.now(timezone.utc) - timedelta(days=35),
        "due_reviews": 3,
    }
    result = s.risk(snapshot)
    assert 0 <= result["score"] <= 100
    assert result["level"] in {"MEDIUM", "HIGH"}
    assert result["reasons"]


def test_healthy_student_is_not_high_risk():
    s = svc()
    snapshot = {
        "overall_mastery": 90,
        "coverage": 95,
        "decline_signal": 10,
        "last_activity": datetime.now(timezone.utc) - timedelta(days=1),
        "due_reviews": 0,
    }
    result = s.risk(snapshot)
    assert result["level"] == "LOW"


def test_missing_mastery_is_explainable():
    result = svc().risk({
        "overall_mastery": None,
        "coverage": 0,
        "decline_signal": 50,
        "last_activity": None,
        "due_reviews": 0,
    })
    assert result["signals"]["mastery"] == 100
    assert any("not enough mastery evidence" in x.lower() for x in result["reasons"])


def test_risk_weight_configuration_fails_fast():
    with pytest.raises(ValueError):
        Settings(
            learning_risk_mastery_weight=0.5,
            learning_risk_coverage_weight=0.5,
            learning_risk_decline_weight=0.2,
            learning_risk_inactivity_weight=0.1,
            learning_risk_overdue_weight=0.1,
        )
