import math
from app.core.config import Settings
from app.services.progress_intelligence import (
    activity_signal_from_count,
    classify_mastery,
    decline_signal_from_scores,
    quiz_signal_from_scores,
    recency_signal,
    review_interval_days,
    review_priority,
)

def test_mastery_formula_fixture():
    s = Settings()
    signals = [80, 60, 70, 50]
    weights = [s.mastery_quiz_weight, s.mastery_completion_weight, s.mastery_recency_weight, s.mastery_activity_weight]
    assert sum(v*w for v,w in zip(signals, weights)) == 70.5

def test_not_started_is_distinct():
    s = Settings()
    assert classify_mastery(None, 0, s) == "NOT_STARTED"
    assert classify_mastery(100, 1, s) == "DEVELOPING"

def test_mastery_thresholds():
    s = Settings()
    assert classify_mastery(39.9, 2, s) == "WEAK"
    assert classify_mastery(40, 2, s) == "NEEDS_REVIEW"
    assert classify_mastery(60, 2, s) == "DEVELOPING"
    assert classify_mastery(80, 2, s) == "MASTERED"

def test_quiz_signal():
    s = Settings()
    assert quiz_signal_from_scores(80, 60, 70, s) == 72
    assert quiz_signal_from_scores(None, 60, 70, s) == round((60*.30+70*.20)/.50,2)

def test_recency_decay():
    s = Settings()
    assert recency_signal(0, s.recency_decay_days) == 100
    assert round(recency_signal(30, s.recency_decay_days), 1) == 36.8
    assert round(recency_signal(60, s.recency_decay_days), 1) == 13.5

def test_activity_is_capped():
    s = Settings()
    assert activity_signal_from_count(20, s) == 50

def test_decline_and_improvement():
    s = Settings()
    assert decline_signal_from_scores(82, 55, s) == 54
    assert decline_signal_from_scores(48, 72, s) == 2

def test_review_priority_and_intervals():
    s = Settings()
    p = review_priority(32, 80, 80, 54, s, "WEAK")
    assert 0 <= p <= 100
    assert review_interval_days(32, s) == 1
    assert review_interval_days(50, s) == 3
    assert review_interval_days(70, s) == 7
    assert review_interval_days(85, s) == 14
    assert review_interval_days(95, s) == 30
