from app.schemas.student import ProgressUpdateRequest, StudentProfileUpdate

def test_progress_validation():
    assert ProgressUpdateRequest(completion_percentage=65, time_spent_seconds=120).completion_percentage == 65
    try:
        ProgressUpdateRequest(completion_percentage=101, time_spent_seconds=1)
        assert False
    except Exception:
        pass

def test_progress_rejects_negative_time():
    try:
        ProgressUpdateRequest(completion_percentage=20, time_spent_seconds=-1)
        assert False
    except Exception:
        pass

def test_profile_update_only_exposes_allowed_fields():
    payload = StudentProfileUpdate(full_name="Student", preferred_language="hi")
    assert payload.model_dump() == {"full_name": "Student", "preferred_language": "hi"}
